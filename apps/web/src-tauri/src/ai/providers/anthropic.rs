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
        base_url(&self.config, "messages")
    }
    fn request(
        &self,
        client: &reqwest::Client,
        key: &str,
        context: &str,
    ) -> Result<RequestBuilder> {
        anthropic_headers(
            client,
            self.url()?,
            key,
            json!({"model":self.config.model_id,"max_tokens":self.config.max_output_tokens,"messages":[{"role":"user","content":context}],"stream":true}),
        )
    }
    fn event(&self, name: Option<&str>, data: &str) -> Result<Option<ProviderEvent>> {
        let value: Value = serde_json::from_str(data)
            .map_err(|_| error(AiErrorCode::ProtocolError, "Invalid Messages event"))?;
        if name == Some("error") || value["type"] == "error" {
            return Err(error(AiErrorCode::ProtocolError, "Messages stream error"));
        }
        match name.or_else(|| value["type"].as_str()) {
            Some("message_start") => Ok(Some(ProviderEvent::Usage(usage(
                &value["message"]["usage"],
            )))),
            Some("content_block_delta") if value["delta"]["type"] == "text_delta" => {
                Ok(text(&value["delta"]["text"]).map(ProviderEvent::Delta))
            }
            Some("message_delta") => {
                let reason = value["delta"]["stop_reason"].as_str().unwrap_or("end_turn");
                let finish = if reason == "max_tokens" {
                    FinishReason::Length
                } else if reason == "end_turn" {
                    FinishReason::Stop
                } else {
                    FinishReason::Provider(reason.to_owned())
                };
                Ok(Some(ProviderEvent::Completed {
                    usage: usage(&value["usage"]),
                    finish_reason: finish,
                }))
            }
            Some("message_stop") => Ok(Some(ProviderEvent::Completed {
                usage: TokenUsage::default(),
                finish_reason: FinishReason::Stop,
            })),
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
            protocol: Protocol::AnthropicMessages,
            base_url: "https://api.example.com/v1".into(),
            model_id: "test-model".into(),
            timeout_ms: 30_000,
            max_output_tokens: 128,
        })
    }

    #[test]
    fn ignores_thinking_blocks_and_emits_text_delta() {
        let adapter = adapter();
        assert!(adapter
            .event(
                Some("content_block_delta"),
                r#"{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hidden"}}"#,
            )
            .unwrap()
            .is_none());
        assert!(matches!(
            adapter
                .event(
                    Some("content_block_delta"),
                    r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"你好"}}"#,
                )
                .unwrap(),
            Some(ProviderEvent::Delta(text)) if text == "你好"
        ));
    }

    #[test]
    fn maps_max_tokens_to_truncated() {
        let event = adapter()
            .event(
                Some("message_delta"),
                r#"{"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":128}}"#,
            )
            .unwrap();
        assert!(matches!(
            event,
            Some(ProviderEvent::Completed {
                finish_reason: FinishReason::Length,
                ..
            })
        ));
    }

    #[test]
    fn reads_input_usage_from_message_start() {
        let event = adapter()
            .event(
                Some("message_start"),
                r#"{"type":"message_start","message":{"usage":{"input_tokens":12}}}"#,
            )
            .unwrap();
        assert!(matches!(
            event,
            Some(ProviderEvent::Usage(usage)) if usage.input_tokens == Some(12)
        ));
    }
}
