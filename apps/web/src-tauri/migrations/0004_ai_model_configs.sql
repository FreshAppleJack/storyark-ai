-- Non-sensitive generation configuration only. Credentials stay outside SQLite.
CREATE TABLE ai_model_configs (
    id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
    protocol TEXT NOT NULL CHECK(protocol IN ('openai-responses','openai-chat-completions','anthropic-messages')),
    base_url TEXT NOT NULL CHECK(length(base_url) BETWEEN 1 AND 2048),
    model_id TEXT NOT NULL CHECK(length(trim(model_id)) BETWEEN 1 AND 256),
    timeout_ms INTEGER NOT NULL CHECK(timeout_ms BETWEEN 1000 AND 600000),
    max_output_tokens INTEGER NOT NULL CHECK(max_output_tokens BETWEEN 1 AND 1000000),
    credential_ref TEXT UNIQUE CHECK(credential_ref IS NULL OR length(credential_ref) = 36),
    config_version INTEGER NOT NULL DEFAULT 1 CHECK(config_version > 0),
    created_at INTEGER NOT NULL CHECK(created_at >= 0),
    updated_at INTEGER NOT NULL CHECK(updated_at >= created_at)
) STRICT;

-- No seeded row: an absent singleton means no default has been chosen.
-- RESTRICT requires the delete command to clear the default in its transaction.
CREATE TABLE ai_generation_settings (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    default_config_id TEXT REFERENCES ai_model_configs(id) ON DELETE RESTRICT,
    database_version INTEGER NOT NULL DEFAULT 1 CHECK(database_version > 0),
    updated_at INTEGER NOT NULL CHECK(updated_at >= 0)
) STRICT;
