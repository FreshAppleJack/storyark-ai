use super::{config::ConfigVersion, error::AiError};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceVersion {
    pub chapter_id: String,
    pub database_version: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum GenerationTarget {
    Continue {
        #[serde(rename = "chapterId")]
        chapter_id: String,
        #[serde(rename = "databaseVersion")]
        database_version: u64,
    },
    Brainstorm {
        #[serde(rename = "workspaceDatabaseVersion")]
        workspace_database_version: u64,
        #[serde(rename = "planningDatabaseVersion")]
        planning_database_version: u64,
        sources: Vec<SourceVersion>,
    },
}

/// All versions refer to the source snapshot; this request never saves a draft.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GenerateRequest {
    pub request_id: String,
    pub book_id: String,
    pub session_id: String,
    pub draft_revision: u64,
    pub config: ConfigVersion,
    pub target: GenerationTarget,
    pub context_snapshot_id: String,
    pub output_chars: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CancelRequest {
    pub request_id: String,
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FinishReason {
    Stop,
    Length,
    Provider(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GenerationPayload {
    Started,
    Delta {
        text: String,
    },
    Completed {
        text: String,
        usage: TokenUsage,
        finish_reason: FinishReason,
    },
    Failed {
        error: AiError,
    },
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationEvent {
    pub request_id: String,
    pub session_id: String,
    pub sequence: u64,
    pub payload: GenerationPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrepareContext {
    pub book_id: String,
    pub session_id: String,
    pub draft_revision: u64,
    pub target: GenerationTarget,
    pub draft_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedContext {
    pub context_snapshot_id: String,
    pub target: GenerationTarget,
    pub session_id: String,
    pub draft_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationAccepted {
    pub request_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CancelOutcome {
    Cancelled,
    AlreadyFinished,
    NotFound,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelledRequest {
    pub request_id: String,
    pub outcome: CancelOutcome,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextSection {
    pub kind: ContextKind,
    pub label: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ContextKind {
    CurrentDraft,
    WrittenFact,
    AuthorSetting,
    ManualSummary,
    FuturePlan,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextInput {
    pub book_id: String,
    pub session_id: String,
    pub draft_revision: u64,
    pub max_chars: u32,
    pub sections: Vec<ContextSection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSnapshot {
    pub context_snapshot_id: String,
    pub book_id: String,
    pub session_id: String,
    pub draft_revision: u64,
    pub sections: Vec<ContextSection>,
    pub char_count: u32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn target_and_event_wire_tags_are_stable() {
        let target: GenerationTarget = serde_json::from_value(json!({
            "kind":"continue", "chapterId":"chapter", "databaseVersion":7
        }))
        .unwrap();
        assert!(matches!(
            target,
            GenerationTarget::Continue {
                database_version: 7,
                ..
            }
        ));
        assert!(serde_json::from_value::<GenerationTarget>(json!({
            "kind":"continue", "chapterId":"chapter"
        }))
        .is_err());
        let event = GenerationEvent {
            request_id: "request".into(),
            session_id: "session".into(),
            sequence: 2,
            payload: GenerationPayload::Completed {
                text: "candidate".into(),
                usage: TokenUsage::default(),
                finish_reason: FinishReason::Stop,
            },
        };
        let value = serde_json::to_value(event).unwrap();
        assert_eq!(value["requestId"], "request");
        assert_eq!(value["payload"]["kind"], "completed");
    }
}
