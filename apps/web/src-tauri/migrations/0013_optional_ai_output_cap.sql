-- Rebuild both related tables with foreign keys enabled. Preserve every saved
-- value, credential reference and default selection within the upgrade transaction.
CREATE TEMP TABLE saved_ai_generation_settings AS SELECT * FROM ai_generation_settings;
DROP TABLE ai_generation_settings;

CREATE TABLE ai_model_configs_new (
    id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
    protocol TEXT NOT NULL CHECK(protocol IN ('openai-responses','openai-chat-completions','anthropic-messages')),
    base_url TEXT NOT NULL CHECK(length(base_url) BETWEEN 1 AND 2048),
    model_id TEXT NOT NULL CHECK(length(trim(model_id)) BETWEEN 1 AND 256),
    timeout_ms INTEGER NOT NULL CHECK(timeout_ms BETWEEN 1000 AND 600000),
    max_output_tokens INTEGER CHECK(max_output_tokens BETWEEN 1 AND 1000000)
        CHECK(protocol != 'anthropic-messages' OR max_output_tokens IS NOT NULL),
    credential_ref TEXT UNIQUE CHECK(credential_ref IS NULL OR length(credential_ref) = 36),
    config_version INTEGER NOT NULL DEFAULT 1 CHECK(config_version > 0),
    created_at INTEGER NOT NULL CHECK(created_at >= 0),
    updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
    credential_mode TEXT NOT NULL DEFAULT 'session' CHECK(credential_mode IN ('session','system'))
) STRICT;
INSERT INTO ai_model_configs_new SELECT * FROM ai_model_configs;
DROP TABLE ai_model_configs;
ALTER TABLE ai_model_configs_new RENAME TO ai_model_configs;

CREATE TABLE ai_generation_settings (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    default_config_id TEXT REFERENCES ai_model_configs(id) ON DELETE RESTRICT,
    database_version INTEGER NOT NULL DEFAULT 1 CHECK(database_version > 0),
    updated_at INTEGER NOT NULL CHECK(updated_at >= 0)
) STRICT;
INSERT INTO ai_generation_settings SELECT * FROM saved_ai_generation_settings;
DROP TABLE saved_ai_generation_settings;
