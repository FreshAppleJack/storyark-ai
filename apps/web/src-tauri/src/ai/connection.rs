//! Small non-streaming connectivity probe. No manuscript or provider body escapes.
use super::{
    config::{ConfigInput, Protocol},
    credentials::Secret,
};
use crate::storage::{Result, StorageError};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::time::Duration;

pub struct Snapshot {
    pub config: ConfigInput,
    pub key: Secret,
}
fn error(code: &str) -> StorageError {
    StorageError::new(code, "Connection test failed")
}

pub fn endpoint(config: &ConfigInput) -> Result<String> {
    config.validate().map_err(|_| error("VALIDATION_ERROR"))?;
    let mut url = tauri::Url::parse(&config.base_url).map_err(|_| error("VALIDATION_ERROR"))?;
    let path = url.path().trim_end_matches('/');
    let base = if path.is_empty() { "/v1" } else { path };
    let suffix = match config.protocol {
        Protocol::OpenaiResponses => "responses",
        Protocol::OpenaiChatCompletions => "chat/completions",
        Protocol::AnthropicMessages => "messages",
    };
    url.set_path(&format!("{base}/{suffix}"));
    Ok(url.to_string())
}

pub async fn test(snapshot: Snapshot) -> Result<()> {
    let config = snapshot.config;
    let url = endpoint(&config)?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_millis(u64::from(
            config.timeout_ms.min(60000),
        )))
        .build()
        .map_err(|_| error("UNAVAILABLE"))?;
    let prompt = "Reply with OK only.";
    let tokens = config.max_output_tokens.min(256);
    let body = match config.protocol {
        Protocol::OpenaiResponses => {
            json!({"model":config.model_id,"input":prompt,"max_output_tokens":tokens,"store":false})
        }
        _ => {
            json!({"model":config.model_id,"messages":[{"role":"user","content":prompt}],"max_tokens":tokens,"stream":false})
        }
    };
    let mut header = reqwest::header::HeaderValue::from_str(&if config.protocol
        == Protocol::AnthropicMessages
    {
        snapshot.key.to_string()
    } else {
        format!("Bearer {}", snapshot.key.as_str())
    })
    .map_err(|_| error("VALIDATION_ERROR"))?;
    header.set_sensitive(true);
    let request = client.post(url).json(&body);
    let request = if config.protocol == Protocol::AnthropicMessages {
        request
            .header("x-api-key", header)
            .header("anthropic-version", "2023-06-01")
    } else {
        request.header(reqwest::header::AUTHORIZATION, header)
    };
    let response = request.send().await.map_err(|e| {
        error(if e.is_timeout() {
            "TIMEOUT"
        } else {
            "UNAVAILABLE"
        })
    })?;
    if !response.status().is_success() {
        return Err(error(match response.status().as_u16() {
            401 | 403 => "AUTHENTICATION_FAILED",
            404 => "MODEL_NOT_FOUND",
            429 => "RATE_LIMITED",
            408 | 504 => "TIMEOUT",
            _ => "PROTOCOL_ERROR",
        }));
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| error("PROTOCOL_ERROR"))?;
        if bytes.len().saturating_add(chunk.len()) > 262144 {
            return Err(error("PROTOCOL_ERROR"));
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| error("PROTOCOL_ERROR"))?;
    validate_response(&config.protocol, &value)
}

fn validate_response(protocol: &Protocol, value: &Value) -> Result<()> {
    if !value["error"].is_null() {
        return Err(error("PROTOCOL_ERROR"));
    }
    let has_text = |v: &Value| v.as_str().is_some_and(|s| !s.trim().is_empty());
    let valid = match protocol {
        Protocol::OpenaiResponses => {
            if value["status"] == "incomplete" {
                return Err(error("TRUNCATED"));
            }
            value["status"] == "completed"
                && value["output"].as_array().is_some_and(|items| {
                    items.iter().any(|item| {
                        item["content"].as_array().is_some_and(|blocks| {
                            blocks.iter().any(|block| {
                                block["type"] == "output_text" && has_text(&block["text"])
                            })
                        })
                    })
                })
        }
        Protocol::OpenaiChatCompletions => {
            if value["choices"][0]["finish_reason"] == "length" {
                return Err(error("TRUNCATED"));
            }
            value["choices"][0]["finish_reason"] == "stop"
                && has_text(&value["choices"][0]["message"]["content"])
        }
        Protocol::AnthropicMessages => {
            if value["stop_reason"] == "max_tokens" {
                return Err(error("TRUNCATED"));
            }
            value["stop_reason"] == "end_turn"
                && value["content"].as_array().is_some_and(|blocks| {
                    blocks
                        .iter()
                        .any(|block| block["type"] == "text" && has_text(&block["text"]))
                })
        }
    };
    if valid {
        Ok(())
    } else {
        Err(error("PROTOCOL_ERROR"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn response_must_contain_completed_text() {
        assert!(validate_response(
            &Protocol::OpenaiResponses,
            &json!({"status":"completed","output":[]})
        )
        .is_err());
        assert!(validate_response(
            &Protocol::OpenaiChatCompletions,
            &json!({"choices":[{"finish_reason":"stop","message":{"content":"OK"}}]})
        )
        .is_ok());
        assert_eq!(
            validate_response(
                &Protocol::AnthropicMessages,
                &json!({"stop_reason":"max_tokens"})
            )
            .unwrap_err()
            .code,
            "TRUNCATED"
        );
    }
}
