use super::{
    config::{ConfigInput, Protocol},
    error::AiErrorCode,
    generation::{FinishReason, TokenUsage},
};
use crate::storage::{Result, StorageError};
use reqwest::{
    header::{HeaderMap, HeaderValue, AUTHORIZATION},
    RequestBuilder,
};
use serde_json::{json, Value};

pub mod anthropic;
pub mod openai_chat;
pub mod openai_responses;

#[derive(Debug, Clone)]
pub enum ProviderEvent {
    Delta(String),
    FinalDelta {
        text: String,
        usage: TokenUsage,
        finish_reason: FinishReason,
    },
    Usage(TokenUsage),
    Completed {
        usage: TokenUsage,
        finish_reason: FinishReason,
    },
}

pub trait Adapter: Send + Sync {
    fn url(&self) -> Result<String>;
    fn request(&self, client: &reqwest::Client, key: &str, context: &str)
        -> Result<RequestBuilder>;
    fn event(&self, name: Option<&str>, data: &str) -> Result<Option<ProviderEvent>>;
}

pub fn make(config: ConfigInput) -> Box<dyn Adapter> {
    match config.protocol {
        Protocol::OpenaiResponses => Box::new(openai_responses::AdapterImpl::new(config)),
        Protocol::OpenaiChatCompletions => Box::new(openai_chat::AdapterImpl::new(config)),
        Protocol::AnthropicMessages => Box::new(anthropic::AdapterImpl::new(config)),
    }
}

pub fn base_url(config: &ConfigInput, suffix: &str) -> Result<String> {
    config
        .validate()
        .map_err(|_| error(AiErrorCode::ValidationError, "Invalid AI configuration"))?;
    let mut url = tauri::Url::parse(&config.base_url)
        .map_err(|_| error(AiErrorCode::ValidationError, "Invalid AI URL"))?;
    let path = url.path().trim_end_matches('/');
    let path = if path.is_empty() { "/v1" } else { path };
    url.set_path(&format!("{path}/{suffix}"));
    Ok(url.to_string())
}

pub fn bearer(
    client: &reqwest::Client,
    url: String,
    key: &str,
    body: Value,
) -> Result<RequestBuilder> {
    let mut value = HeaderValue::from_str(&format!("Bearer {key}"))
        .map_err(|_| error(AiErrorCode::ValidationError, "Invalid credential"))?;
    value.set_sensitive(true);
    let mut headers = HeaderMap::new();
    headers.insert(AUTHORIZATION, value);
    headers.insert("accept", HeaderValue::from_static("text/event-stream"));
    Ok(client.post(url).headers(headers).json(&body))
}

pub fn anthropic_headers(
    client: &reqwest::Client,
    url: String,
    key: &str,
    body: Value,
) -> Result<RequestBuilder> {
    let mut value = HeaderValue::from_str(key)
        .map_err(|_| error(AiErrorCode::ValidationError, "Invalid credential"))?;
    value.set_sensitive(true);
    let mut headers = HeaderMap::new();
    headers.insert("x-api-key", value);
    headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
    headers.insert("accept", HeaderValue::from_static("text/event-stream"));
    Ok(client.post(url).headers(headers).json(&body))
}

pub fn text(value: &Value) -> Option<String> {
    value
        .as_str()
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
}
pub fn usage(value: &Value) -> TokenUsage {
    TokenUsage {
        input_tokens: value["input_tokens"]
            .as_u64()
            .or_else(|| value["prompt_tokens"].as_u64()),
        output_tokens: value["output_tokens"]
            .as_u64()
            .or_else(|| value["completion_tokens"].as_u64()),
        total_tokens: value["total_tokens"].as_u64(),
    }
}
pub fn error(code: AiErrorCode, _message: &str) -> StorageError {
    StorageError::new(
        match code {
            AiErrorCode::ValidationError => "VALIDATION_ERROR",
            AiErrorCode::AuthenticationFailed => "AUTHENTICATION_FAILED",
            AiErrorCode::ModelNotFound => "MODEL_NOT_FOUND",
            AiErrorCode::RateLimited => "RATE_LIMITED",
            AiErrorCode::Timeout => "TIMEOUT",
            AiErrorCode::Cancelled => "CANCELLED",
            AiErrorCode::Truncated => "TRUNCATED",
            AiErrorCode::Busy => "BUSY",
            AiErrorCode::ContextChanged => "CONTEXT_CHANGED",
            _ => "PROTOCOL_ERROR",
        },
        "AI provider request failed",
    )
}
