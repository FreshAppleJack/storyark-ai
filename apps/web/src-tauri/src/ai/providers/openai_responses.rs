use super::*;
use serde_json::Value;

pub struct AdapterImpl {
    config: ConfigInput,
}
impl AdapterImpl {
    pub fn new(config: ConfigInput) -> Self {
        Self { config }
    }
}
impl Adapter for AdapterImpl {
    fn url(&self) -> Result<String> {
        base_url(&self.config, "responses")
    }
    fn request(
        &self,
        client: &reqwest::Client,
        key: &str,
        context: &str,
    ) -> Result<RequestBuilder> {
        bearer(
            client,
            self.url()?,
            key,
            json!({"model":self.config.model_id,"input":context,"max_output_tokens":self.config.max_output_tokens,"stream":true,"store":false}),
        )
    }
    fn event(&self, name: Option<&str>, data: &str) -> Result<Option<ProviderEvent>> {
        if data == "[DONE]" {
            return Ok(Some(ProviderEvent::Completed {
                usage: TokenUsage::default(),
                finish_reason: FinishReason::Stop,
            }));
        }
        let value: Value = serde_json::from_str(data)
            .map_err(|_| error(AiErrorCode::ProtocolError, "Invalid Responses event"))?;
        if name == Some("error") || value["type"] == "error" || value["type"] == "response.failed" {
            return Err(error(AiErrorCode::ProtocolError, "Responses stream error"));
        }
        match name.or_else(|| value["type"].as_str()) {
            Some("response.output_text.delta") => {
                Ok(text(&value["delta"]).map(ProviderEvent::Delta))
            }
            Some("response.completed") => Ok(Some(ProviderEvent::Completed {
                usage: usage(&value["response"]["usage"]),
                finish_reason: FinishReason::Stop,
            })),
            Some("response.incomplete") => {
                Err(error(AiErrorCode::Truncated, "Responses stream incomplete"))
            }
            _ => Ok(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn adapter() -> AdapterImpl {
        AdapterImpl::new(ConfigInput {
            name: "Test".into(),
            protocol: Protocol::OpenaiResponses,
            base_url: "https://api.example.com/v1".into(),
            model_id: "test-model".into(),
            timeout_ms: 30_000,
            max_output_tokens: 128,
        })
    }

    #[test]
    fn emits_only_output_text_deltas() {
        let adapter = adapter();
        assert!(adapter
            .event(
                Some("response.reasoning_summary_text.delta"),
                r#"{"type":"response.reasoning_summary_text.delta","delta":"hidden"}"#,
            )
            .unwrap()
            .is_none());
        assert!(matches!(
            adapter
                .event(
                    Some("response.output_text.delta"),
                    r#"{"type":"response.output_text.delta","delta":"你好"}"#,
                )
                .unwrap(),
            Some(ProviderEvent::Delta(text)) if text == "你好"
        ));
    }

    #[test]
    fn maps_incomplete_response_to_truncated() {
        let error = adapter()
            .event(
                Some("response.incomplete"),
                r#"{"type":"response.incomplete","response":{}}"#,
            )
            .unwrap_err();
        assert_eq!(error.code, "TRUNCATED");
    }
}
