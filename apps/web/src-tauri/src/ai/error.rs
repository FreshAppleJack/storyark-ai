use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AiErrorCode {
    ValidationError,
    CredentialUnavailable,
    CredentialReplacementRequired,
    AuthenticationFailed,
    ModelNotFound,
    RateLimited,
    Timeout,
    Cancelled,
    ProtocolError,
    Truncated,
    StorageFailure,
    NotFound,
    VersionConflict,
    ContextChanged,
    Locked,
    Unavailable,
    Busy,
}

/// Closed error payload: no provider body, URL, key, or arbitrary message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiError {
    pub code: AiErrorCode,
    pub request_id: Option<String>,
    pub retry_after_ms: Option<u64>,
}
