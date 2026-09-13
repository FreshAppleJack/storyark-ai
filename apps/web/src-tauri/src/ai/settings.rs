use super::config::ConfigInput;
use serde::Deserialize;

// Deliberately neither Debug nor Serialize: keys enter Rust, never leave it.
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub enum CredentialChange {
    Keep,
    Replace { key: String, remember: bool },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveSettings {
    pub id: Option<String>,
    pub expected_config_version: u64,
    pub config: ConfigInput,
    pub credential: CredentialChange,
}
