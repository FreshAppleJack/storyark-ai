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
        base_url(&self.config, "chat/completions")
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
            json!({"model":self.config.model_id,"messages":[{"role":"user","content":context}],"max_tokens":self.config.max_output_tokens,"stream":true,"stream_options":{"include_usage":true}}),
        )
    }
    fn event(&self, _name: Option<&str>, data: &str) -> Result<Option<ProviderEvent>> {
        if data == "[DONE]" {
            return Ok(Some(ProviderEvent::Completed {
                usage: TokenUsage::default(),
                finish_reason: FinishReason::Stop,
            }));
        }
        let value: Value = serde_json::from_str(data)
            .map_err(|_| error(AiErrorCode::ProtocolError, "Invalid Chat Completions event"))?;
        if value["error"].is_object() {
            return Err(error(
                AiErrorCode::ProtocolError,
                "Chat Completions stream error",
            ));
        }
        // Providers commonly send usage in a final event with an empty choices array.
        if value["choices"].as_array().is_some_and(Vec::is_empty) && value["usage"].is_object() {
            return Ok(Some(ProviderEvent::Completed {
                usage: usage(&value["usage"]),
                finish_reason: FinishReason::Stop,
            }));
        }
        let choice = &value["choices"][0];
        if let Some(text) = text(&choice["delta"]["content"]) {
            return Ok(Some(ProviderEvent::Delta(text)));
        }
        if let Some(reason) = choice["finish_reason"].as_str() {
            let finish = if reason == "length" {
                FinishReason::Length
            } else if reason == "stop" {
                FinishReason::Stop
            } else {
                FinishReason::Provider(reason.to_owned())
            };
            return Ok(Some(ProviderEvent::Completed {
                usage: usage(&value["usage"]),
                finish_reason: finish,
            }));
        }
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn adapter() -> AdapterImpl {
        AdapterImpl::new(ConfigInput {
            name: "Test".into(),
            protocol: Protocol::OpenaiChatCompletions,
            base_url: "https://api.example.com/v1".into(),
            model_id: "test-model".into(),
            timeout_ms: 30_000,
            max_output_tokens: 128,
        })
    }

    #[test]
    fn emits_text_and_ignores_tool_deltas() {
        let adapter = adapter();
        assert!(matches!(
            adapter
                .event(
                    None,
                    r#"{"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"{}"}}]},"finish_reason":null}]}"#
                )
                .unwrap(),
            None
        ));
        assert!(matches!(
            adapter
                .event(
                    None,
                    r#"{"choices":[{"delta":{"content":"你好"},"finish_reason":null}]}"#
                )
                .unwrap(),
            Some(ProviderEvent::Delta(text)) if text == "你好"
        ));
    }

    #[test]
    fn preserves_usage_from_empty_choices_event() {
        let event = adapter()
            .event(
                None,
                r#"{"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}"#,
            )
            .unwrap();
        assert!(matches!(
            event,
            Some(ProviderEvent::Completed { usage, .. })
                if usage.input_tokens == Some(2)
                    && usage.output_tokens == Some(3)
                    && usage.total_tokens == Some(5)
        ));
    }
}
