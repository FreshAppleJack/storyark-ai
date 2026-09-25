use super::{
    credentials::Secret,
    error::AiErrorCode,
    generation::{FinishReason, GenerationPayload, TokenUsage},
    providers::{self, ProviderEvent},
    sse::Parser,
};
use crate::storage::{Result, StorageError};
use futures_util::StreamExt;
use reqwest::StatusCode;
use std::{sync::Arc, time::Duration};
use tokio::time::{timeout, Instant};

const MAX_TOTAL_BYTES: usize = 8 * 1024 * 1024;

pub struct StreamInput {
    pub config: super::config::ConfigInput,
    pub key: Secret,
    pub context: String,
    pub control: Arc<super::tasks::Cancellation>,
}

#[derive(Debug)]
pub struct StreamResult {
    pub text: String,
    pub usage: TokenUsage,
    pub finish_reason: FinishReason,
}

pub async fn run<F>(input: StreamInput, mut emit: F) -> Result<StreamResult>
where
    F: FnMut(GenerationPayload) + Send,
{
    let total_timeout = Duration::from_millis(u64::from(input.config.timeout_ms.min(600_000)));
    let deadline = Instant::now() + total_timeout;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(total_timeout)
        .build()
        .map_err(|_| provider_error(AiErrorCode::Unavailable))?;
    let adapter = providers::make(input.config.clone());
    let request = adapter
        .request(&client, input.key.as_str(), &input.context)
        .map_err(|_| provider_error(AiErrorCode::ValidationError))?;
    let response = tokio::select! {
        _ = input.control.cancelled() => return Err(provider_error(AiErrorCode::Cancelled)),
        result = timeout(remaining(deadline), request.send()) => {
            result.map_err(|_| provider_error(AiErrorCode::Timeout))?
                .map_err(|error| provider_error(if error.is_timeout() { AiErrorCode::Timeout } else { AiErrorCode::Unavailable }))?
        }
    };
    if !response.status().is_success() {
        return Err(http_error(response.status()));
    }
    let mut bytes_stream = response.bytes_stream();
    let mut parser = Parser::new();
    let mut text = String::new();
    let mut usage = TokenUsage::default();
    let mut finish_reason = None;
    let mut total_bytes = 0usize;

    while finish_reason.is_none() {
        let next = timeout(remaining(deadline), bytes_stream.next());
        let chunk = tokio::select! {
            _ = input.control.cancelled() => return Err(provider_error(AiErrorCode::Cancelled)),
            result = next => result.map_err(|_| provider_error(AiErrorCode::Timeout))?
                .transpose()
                .map_err(|_| provider_error(AiErrorCode::ProtocolError))?,
        };
        let Some(chunk) = chunk else { break };
        total_bytes = total_bytes.saturating_add(chunk.len());
        if total_bytes > MAX_TOTAL_BYTES {
            return Err(provider_error(AiErrorCode::ProtocolError));
        }
        for event in parser.push(&chunk)? {
            if finish_reason.is_some() {
                break;
            }
            if let Some(provider_event) = adapter.event(event.name.as_deref(), &event.data)? {
                apply_event(
                    provider_event,
                    &mut text,
                    &mut usage,
                    &mut finish_reason,
                    &mut emit,
                )?;
            }
        }
    }
    if finish_reason.is_none() {
        for event in parser.finish()? {
            if finish_reason.is_some() {
                break;
            }
            if let Some(provider_event) = adapter.event(event.name.as_deref(), &event.data)? {
                apply_event(
                    provider_event,
                    &mut text,
                    &mut usage,
                    &mut finish_reason,
                    &mut emit,
                )?;
            }
        }
    }
    let finish_reason = finish_reason.ok_or_else(|| provider_error(AiErrorCode::ProtocolError))?;
    if matches!(finish_reason, FinishReason::Length) {
        return Err(provider_error(AiErrorCode::Truncated));
    }
    if text.trim().is_empty() {
        return Err(provider_error(AiErrorCode::ProtocolError));
    }
    Ok(StreamResult {
        text,
        usage,
        finish_reason,
    })
}

fn apply_event<F>(
    event: ProviderEvent,
    text: &mut String,
    usage: &mut TokenUsage,
    finish_reason: &mut Option<FinishReason>,
    emit: &mut F,
) -> Result<()>
where
    F: FnMut(GenerationPayload) + Send,
{
    match event {
        ProviderEvent::FinalDelta {
            text: delta,
            usage: next_usage,
            finish_reason: reason,
        } => {
            apply_event(
                ProviderEvent::Delta(delta),
                text,
                usage,
                finish_reason,
                emit,
            )?;
            apply_event(
                ProviderEvent::Completed {
                    usage: next_usage,
                    finish_reason: reason,
                },
                text,
                usage,
                finish_reason,
                emit,
            )?;
        }
        ProviderEvent::Delta(delta) => {
            if text.chars().count().saturating_add(delta.chars().count()) > 2_000_000 {
                return Err(provider_error(AiErrorCode::ProtocolError));
            }
            text.push_str(&delta);
            emit(GenerationPayload::Delta { text: delta });
        }
        ProviderEvent::Usage(next_usage) => merge_usage(usage, next_usage),
        ProviderEvent::Completed {
            usage: next_usage,
            finish_reason: reason,
        } => {
            merge_usage(usage, next_usage);
            *finish_reason = Some(reason);
        }
    }
    Ok(())
}

fn remaining(deadline: Instant) -> Duration {
    deadline
        .saturating_duration_since(Instant::now())
        .max(Duration::from_millis(1))
}

fn merge_usage(target: &mut TokenUsage, next: TokenUsage) {
    if next.input_tokens.is_some() {
        target.input_tokens = next.input_tokens;
    }
    if next.output_tokens.is_some() {
        target.output_tokens = next.output_tokens;
    }
    if next.total_tokens.is_some() {
        target.total_tokens = next.total_tokens;
    }
    if target.total_tokens.is_none() {
        target.total_tokens = target
            .input_tokens
            .zip(target.output_tokens)
            .map(|(input, output)| input + output);
    }
}

fn http_error(status: StatusCode) -> StorageError {
    provider_error(match status {
        StatusCode::BAD_REQUEST | StatusCode::UNPROCESSABLE_ENTITY => AiErrorCode::ValidationError,
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => AiErrorCode::AuthenticationFailed,
        StatusCode::NOT_FOUND => AiErrorCode::ModelNotFound,
        StatusCode::TOO_MANY_REQUESTS => AiErrorCode::RateLimited,
        StatusCode::REQUEST_TIMEOUT | StatusCode::GATEWAY_TIMEOUT => AiErrorCode::Timeout,
        _ => AiErrorCode::ProtocolError,
    })
}

pub fn provider_error(code: AiErrorCode) -> StorageError {
    StorageError::new(
        match code {
            AiErrorCode::ValidationError => "VALIDATION_ERROR",
            AiErrorCode::CredentialUnavailable => "CREDENTIAL_UNAVAILABLE",
            AiErrorCode::AuthenticationFailed => "AUTHENTICATION_FAILED",
            AiErrorCode::ModelNotFound => "MODEL_NOT_FOUND",
            AiErrorCode::RateLimited => "RATE_LIMITED",
            AiErrorCode::Timeout => "TIMEOUT",
            AiErrorCode::Cancelled => "CANCELLED",
            AiErrorCode::Truncated => "TRUNCATED",
            AiErrorCode::Busy => "BUSY",
            AiErrorCode::ContextChanged => "CONTEXT_CHANGED",
            AiErrorCode::Unavailable => "UNAVAILABLE",
            _ => "PROTOCOL_ERROR",
        },
        "AI generation request failed",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::{
        config::{ConfigInput, Protocol},
        credentials::Secret,
        tasks::Cancellation,
    };
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::Arc,
        thread,
        time::Duration as StdDuration,
    };
    #[test]
    fn merges_partial_usage_without_losing_known_values() {
        let mut usage = TokenUsage {
            input_tokens: Some(3),
            output_tokens: None,
            total_tokens: None,
        };
        merge_usage(
            &mut usage,
            TokenUsage {
                input_tokens: None,
                output_tokens: Some(4),
                total_tokens: None,
            },
        );
        assert_eq!(usage.total_tokens, Some(7));
    }

    #[test]
    fn final_chat_delta_preserves_text_and_stop_or_length() {
        let adapter = providers::make(crate::ai::config::ConfigInput {
            name: "Synthetic".into(),
            protocol: Protocol::OpenaiChatCompletions,
            base_url: "http://127.0.0.1:1234".into(),
            model_id: "synthetic".into(),
            timeout_ms: 1000,
            max_output_tokens: 128,
        });
        for (reason, expected) in [
            ("stop", FinishReason::Stop),
            ("length", FinishReason::Length),
        ] {
            let data = serde_json::json!({"choices":[{"delta":{"content":"final text"},"finish_reason":reason}],"usage":{"completion_tokens":3}});
            let event = adapter.event(None, &data.to_string()).unwrap().unwrap();
            let mut text = String::new();
            let mut usage = TokenUsage::default();
            let mut finish = None;
            let mut deltas = Vec::new();
            apply_event(event, &mut text, &mut usage, &mut finish, &mut |event| {
                deltas.push(event)
            })
            .unwrap();
            assert_eq!(text, "final text");
            assert_eq!(finish, Some(expected));
            assert_eq!(usage.output_tokens, Some(3));
            assert_eq!(deltas.len(), 1);
        }
    }

    #[test]
    fn cancellation_interrupts_a_stream_after_a_delta() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 2048];
            let _ = stream.read(&mut request);
            let first =
                "data: {\"choices\":[{\"delta\":{\"content\":\"你\"},\"finish_reason\":null}]}\n\n"
                    .as_bytes();
            let rest = "data: {\"choices\":[{\"delta\":{\"content\":\"好\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n".as_bytes();
            let length = first.len() + rest.len();
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n"
            )
            .unwrap();
            stream.write_all(first).unwrap();
            stream.flush().unwrap();
            thread::sleep(StdDuration::from_millis(150));
            let _ = stream.write_all(rest);
        });

        let cancellation = Arc::new(Cancellation::new());
        let cancel_after_delta = cancellation.clone();
        let input = StreamInput {
            config: ConfigInput {
                name: "Test".into(),
                protocol: Protocol::OpenaiChatCompletions,
                base_url: format!("http://127.0.0.1:{port}"),
                model_id: "test-model".into(),
                timeout_ms: 10_000,
                max_output_tokens: 128,
            },
            key: Secret::new("synthetic-key".into()),
            context: "[Current draft]\nTest".into(),
            control: cancellation,
        };
        let mut deltas = Vec::new();
        let result = tauri::async_runtime::block_on(run(input, |payload| {
            if let GenerationPayload::Delta { text } = payload {
                deltas.push(text);
                cancel_after_delta.cancel();
            }
        }));
        server.join().unwrap();
        assert_eq!(result.unwrap_err().code, "CANCELLED");
        assert_eq!(deltas, vec!["你"]);
    }

    #[test]
    fn dispatches_terminal_events_from_clean_eof_for_all_supported_protocols() {
        let fixtures = [
            (
                Protocol::OpenaiChatCompletions,
                concat!(
                    "data: {\"choices\":[{\"delta\":{\"content\":\"已生成\"},\"finish_reason\":null}]}\n\n",
                    "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}"
                ),
            ),
            (
                Protocol::OpenaiResponses,
                concat!(
                    "event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"已生成\"}\n\n",
                    "event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":2,\"output_tokens\":3}}}"
                ),
            ),
            (
                Protocol::AnthropicMessages,
                concat!(
                    "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"已生成\"}}\n\n",
                    "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":3}}"
                ),
            ),
        ];

        for (protocol, body) in fixtures {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let port = listener.local_addr().unwrap().port();
            let body = body.to_owned();
            let server = thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0_u8; 2048];
                let _ = stream.read(&mut request);
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                )
                .unwrap();
                stream.write_all(body.as_bytes()).unwrap();
            });
            let input = StreamInput {
                config: ConfigInput {
                    name: "Synthetic stream test".into(),
                    protocol,
                    base_url: format!("http://127.0.0.1:{port}"),
                    model_id: "synthetic-model".into(),
                    timeout_ms: 10_000,
                    max_output_tokens: 128,
                },
                key: Secret::new("synthetic-key".into()),
                context: "synthetic chapter text".into(),
                control: Arc::new(Cancellation::new()),
            };
            let result = tauri::async_runtime::block_on(run(input, |_| {}));
            server.join().unwrap();

            let result = result.expect("valid terminal event at EOF should complete");
            assert_eq!(result.text, "已生成");
            assert_eq!(result.finish_reason, FinishReason::Stop);
        }
    }
}
