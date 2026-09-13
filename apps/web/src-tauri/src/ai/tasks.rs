use super::{
    error::AiErrorCode,
    generation::{ContextInput, ContextKind, ContextSnapshot, GenerateRequest, GenerationPayload},
    stream::{self, StreamInput},
};
use crate::storage::{Result, StorageError};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tokio::sync::{Notify, Semaphore};

const MAX_CONTEXT_CHARS: u32 = 64_000;
const MAX_CONTEXT_SECTIONS: usize = 64;

pub struct Cancellation {
    cancelled: AtomicBool,
    notify: Notify,
}
impl Cancellation {
    pub fn new() -> Self {
        Self {
            cancelled: AtomicBool::new(false),
            notify: Notify::new(),
        }
    }
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        // A stored permit closes the check-to-wait race when cancellation wins
        // just before the async waiter is polled.
        self.notify.notify_one();
    }
    pub async fn cancelled(&self) {
        if self.cancelled.load(Ordering::Acquire) {
            return;
        }
        self.notify.notified().await;
    }
}

struct ContextEntry {
    snapshot: ContextSnapshot,
    created: Instant,
}
struct TaskEntry {
    session_id: String,
    cancellation: Arc<Cancellation>,
}
struct Inner {
    contexts: Mutex<HashMap<String, ContextEntry>>,
    tasks: Mutex<HashMap<String, TaskEntry>>,
    permits: Arc<Semaphore>,
}
#[derive(Clone)]
pub struct AiRuntime(Arc<Inner>);
impl Default for AiRuntime {
    fn default() -> Self {
        Self(Arc::new(Inner {
            contexts: Mutex::new(HashMap::new()),
            tasks: Mutex::new(HashMap::new()),
            permits: Arc::new(Semaphore::new(2)),
        }))
    }
}

impl AiRuntime {
    pub fn prepare(&self, input: ContextInput) -> Result<ContextSnapshot> {
        validate_context(&input)?;
        let mut contexts = self.0.contexts.lock().map_err(|_| failure())?;
        let now = Instant::now();
        contexts
            .retain(|_, entry| now.duration_since(entry.created) < Duration::from_secs(30 * 60));
        let id = uuid::Uuid::new_v4().to_string();
        let char_count = input
            .sections
            .iter()
            .map(|section| section.text.chars().count())
            .sum::<usize>() as u32;
        let snapshot = ContextSnapshot {
            context_snapshot_id: id.clone(),
            book_id: input.book_id,
            session_id: input.session_id,
            draft_revision: input.draft_revision,
            sections: input.sections,
            char_count,
        };
        contexts.insert(
            id,
            ContextEntry {
                snapshot: snapshot.clone(),
                created: now,
            },
        );
        Ok(snapshot)
    }

    pub fn take_context(&self, id: &str, request: &GenerateRequest) -> Result<ContextSnapshot> {
        let mut contexts = self.0.contexts.lock().map_err(|_| failure())?;
        let entry = contexts
            .remove(id)
            .ok_or_else(|| failure_code("CONTEXT_CHANGED"))?;
        if entry.snapshot.book_id != request.book_id
            || entry.snapshot.session_id != request.session_id
            || entry.snapshot.draft_revision != request.draft_revision
        {
            return Err(failure_code("CONTEXT_CHANGED"));
        }
        Ok(entry.snapshot)
    }

    pub fn register(&self, request_id: &str, session_id: &str) -> Result<Arc<Cancellation>> {
        if uuid::Uuid::parse_str(request_id).is_err() || session_id.trim().is_empty() {
            return Err(failure_code("VALIDATION_ERROR"));
        }
        let mut tasks = self.0.tasks.lock().map_err(|_| failure())?;
        if tasks.contains_key(request_id) {
            return Err(failure_code("BUSY"));
        }
        let cancellation = Arc::new(Cancellation::new());
        tasks.insert(
            request_id.into(),
            TaskEntry {
                session_id: session_id.into(),
                cancellation: cancellation.clone(),
            },
        );
        Ok(cancellation)
    }

    pub fn cancel(&self, request_id: &str, session_id: &str) -> Result<String> {
        let tasks = self.0.tasks.lock().map_err(|_| failure())?;
        let Some(task) = tasks.get(request_id) else {
            return Ok("notFound".into());
        };
        if task.session_id != session_id {
            return Err(failure_code("CONTEXT_CHANGED"));
        }
        task.cancellation.cancel();
        Ok("cancelled".into())
    }

    pub fn finish(&self, request_id: &str) {
        if let Ok(mut tasks) = self.0.tasks.lock() {
            tasks.remove(request_id);
        }
    }
    pub fn permit(&self) -> Result<tokio::sync::OwnedSemaphorePermit> {
        self.0
            .permits
            .clone()
            .try_acquire_owned()
            .map_err(|_| failure_code("BUSY"))
    }

    pub fn start(
        &self,
        request: GenerateRequest,
        stream_input: StreamInput,
        sink: EventSink,
    ) -> Result<()> {
        let runtime = self.clone();
        let request_id = request.request_id.clone();
        tauri::async_runtime::spawn(async move {
            let result = async {
                let _permit = runtime.permit()?;
                let stream_sink = sink.clone();
                stream::run(stream_input, move |payload| (stream_sink)(payload)).await
            }
            .await;
            match result {
                Ok(value) => (sink)(GenerationPayload::Completed {
                    text: value.text,
                    usage: value.usage,
                    finish_reason: value.finish_reason,
                }),
                Err(error) => (sink)(if error.code == "CANCELLED" {
                    GenerationPayload::Cancelled
                } else {
                    GenerationPayload::Failed {
                        error: super::error::AiError {
                            code: error_code(&error.code),
                            request_id: Some(request.request_id.clone()),
                            retry_after_ms: None,
                        },
                    }
                }),
            }
            runtime.finish(&request_id);
        });
        Ok(())
    }
}

pub type EventSink = Arc<dyn Fn(GenerationPayload) + Send + Sync + 'static>;

fn validate_context(input: &ContextInput) -> Result<()> {
    if uuid::Uuid::parse_str(&input.book_id).is_err()
        || input.session_id.trim().is_empty()
        || input.max_chars == 0
        || input.max_chars > MAX_CONTEXT_CHARS
        || input.sections.len() > MAX_CONTEXT_SECTIONS
    {
        return Err(failure_code("VALIDATION_ERROR"));
    }
    let mut total = 0usize;
    for section in &input.sections {
        if section.label.trim().is_empty()
            || section.label.chars().count() > 120
            || section
                .text
                .chars()
                .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
        {
            return Err(failure_code("VALIDATION_ERROR"));
        }
        if section.text.chars().count() > MAX_CONTEXT_CHARS as usize {
            return Err(failure_code("VALIDATION_ERROR"));
        }
        total = total.saturating_add(section.text.chars().count());
    }
    if total > input.max_chars as usize {
        return Err(failure_code("VALIDATION_ERROR"));
    }
    Ok(())
}

pub fn format_context(snapshot: &ContextSnapshot) -> String {
    snapshot
        .sections
        .iter()
        .map(|section| format!("[{}]\n{}", kind_label(&section.kind), section.text))
        .collect::<Vec<_>>()
        .join("\n\n")
}
fn kind_label(kind: &ContextKind) -> &'static str {
    match kind {
        ContextKind::CurrentDraft => "Current draft",
        ContextKind::WrittenFact => "Written facts",
        ContextKind::AuthorSetting => "Author settings",
        ContextKind::ManualSummary => "Manual summaries",
        ContextKind::FuturePlan => "Future plans",
    }
}
fn failure() -> StorageError {
    failure_code("STORAGE_FAILURE")
}
fn failure_code(code: &str) -> StorageError {
    StorageError::new(code, "AI task could not be started")
}
fn error_code(code: &str) -> AiErrorCode {
    match code {
        "CANCELLED" => AiErrorCode::Cancelled,
        "TIMEOUT" => AiErrorCode::Timeout,
        "RATE_LIMITED" => AiErrorCode::RateLimited,
        "AUTHENTICATION_FAILED" => AiErrorCode::AuthenticationFailed,
        "MODEL_NOT_FOUND" => AiErrorCode::ModelNotFound,
        "TRUNCATED" => AiErrorCode::Truncated,
        "BUSY" => AiErrorCode::Busy,
        "CONTEXT_CHANGED" => AiErrorCode::ContextChanged,
        "UNAVAILABLE" => AiErrorCode::Unavailable,
        "CREDENTIAL_UNAVAILABLE" => AiErrorCode::CredentialUnavailable,
        "VALIDATION_ERROR" => AiErrorCode::ValidationError,
        _ => AiErrorCode::ProtocolError,
    }
}

pub fn accepted(id: &str) -> Value {
    json!({"requestId":id})
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::generation::{ContextSection, GenerationTarget};

    fn section(kind: ContextKind, text: &str) -> ContextSection {
        ContextSection {
            kind,
            label: "fixture".into(),
            text: text.into(),
        }
    }

    #[test]
    fn snapshots_keep_section_kinds_and_unicode_character_budget() {
        let runtime = AiRuntime::default();
        let snapshot = runtime
            .prepare(ContextInput {
                book_id: uuid::Uuid::new_v4().to_string(),
                session_id: "session".into(),
                draft_revision: 3,
                max_chars: 10,
                sections: vec![
                    section(ContextKind::CurrentDraft, "你好"),
                    section(ContextKind::AuthorSetting, "规则"),
                ],
            })
            .unwrap();
        assert_eq!(snapshot.char_count, 4);
        assert_eq!(
            format_context(&snapshot),
            "[Current draft]\n你好\n\n[Author settings]\n规则"
        );
    }

    #[test]
    fn rejects_disallowed_controls_and_consumes_snapshot_once() {
        let runtime = AiRuntime::default();
        let book_id = uuid::Uuid::new_v4().to_string();
        let invalid = runtime.prepare(ContextInput {
            book_id: book_id.clone(),
            session_id: "session".into(),
            draft_revision: 1,
            max_chars: 10,
            sections: vec![section(ContextKind::WrittenFact, "bad\u{0000}text")],
        });
        assert_eq!(invalid.unwrap_err().code, "VALIDATION_ERROR");

        let snapshot = runtime
            .prepare(ContextInput {
                book_id: book_id.clone(),
                session_id: "session".into(),
                draft_revision: 1,
                max_chars: 10,
                sections: vec![],
            })
            .unwrap();
        let request = GenerateRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            book_id,
            session_id: "session".into(),
            draft_revision: 1,
            config: crate::ai::config::ConfigVersion {
                id: uuid::Uuid::new_v4().to_string(),
                expected_config_version: 1,
            },
            target: GenerationTarget::Continue {
                chapter_id: "chapter".into(),
                database_version: 1,
            },
            context_snapshot_id: snapshot.context_snapshot_id.clone(),
        };
        assert!(runtime
            .take_context(&snapshot.context_snapshot_id, &request)
            .is_ok());
        assert_eq!(
            runtime
                .take_context(&snapshot.context_snapshot_id, &request)
                .unwrap_err()
                .code,
            "CONTEXT_CHANGED"
        );
    }
}
