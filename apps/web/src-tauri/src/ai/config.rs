use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Protocol {
    OpenaiResponses,
    OpenaiChatCompletions,
    AnthropicMessages,
}

/// This DTO deliberately has no API key or credential-reference input.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigInput {
    pub name: String,
    pub protocol: Protocol,
    pub base_url: String,
    pub model_id: String,
    pub timeout_ms: u32,
    pub max_output_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum SaveConfig {
    Create {
        config: ConfigInput,
    },
    Update {
        id: String,
        #[serde(rename = "expectedConfigVersion")]
        expected_config_version: u64,
        config: ConfigInput,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigVersion {
    pub id: String,
    pub expected_config_version: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetDefault {
    pub config: Option<ConfigVersion>,
    pub expected_database_version: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigRecord {
    pub id: String,
    pub config: ConfigInput,
    pub config_version: u64,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigList {
    pub configs: Vec<ConfigRecord>,
    pub default_config_id: Option<String>,
    pub database_version: u64,
}

impl ConfigInput {
    pub fn validate(&self) -> Result<(), super::error::AiErrorCode> {
        use super::error::AiErrorCode::ValidationError;
        for (value, limit) in [(&self.name, 120), (&self.model_id, 256)] {
            if value.trim().is_empty()
                || value.chars().count() > limit
                || value.chars().any(char::is_control)
            {
                return Err(ValidationError);
            }
        }
        if !(1000..=600000).contains(&self.timeout_ms)
            || !(1..=1000000).contains(&self.max_output_tokens)
            || self.base_url.len() > 2048
            || self.base_url.chars().any(char::is_whitespace)
        {
            return Err(ValidationError);
        }
        let url = tauri::Url::parse(&self.base_url).map_err(|_| ValidationError)?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(ValidationError);
        }
        // Plain HTTP is restricted to explicitly configured loopback services.
        if url.scheme() == "http"
            && !matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
        {
            return Err(ValidationError);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rejects_secret_fields_and_unsafe_endpoints() {
        let value = json!({"name":"Local","protocol":"openai-chat-completions",
            "baseUrl":"http://127.0.0.1:1234/v1","modelId":"example",
            "timeoutMs":30000,"maxOutputTokens":1024});
        let mut config: ConfigInput = serde_json::from_value(value.clone()).unwrap();
        assert!(config.validate().is_ok());
        for endpoint in [
            "https://user:password@example.com",
            "https://example.com?key=value",
            "file:///tmp/model",
            "http://example.com",
            "https://example.com/#fragment",
        ] {
            config.base_url = endpoint.into();
            assert!(config.validate().is_err());
        }
        let mut with_secret = value;
        with_secret["apiKey"] = json!("synthetic-value");
        assert!(serde_json::from_value::<ConfigInput>(with_secret).is_err());
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeleteConfig {
    pub config: ConfigVersion,
    pub expected_default_database_version: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TestConnection {
    pub request_id: String,
    pub config: ConfigVersion,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTested {
    pub request_id: String,
    pub config_version: u64,
}
