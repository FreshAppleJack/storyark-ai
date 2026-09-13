-- References and cleanup intent only; never credential material.
ALTER TABLE ai_model_configs ADD COLUMN credential_mode TEXT NOT NULL DEFAULT 'session'
    CHECK(credential_mode IN ('session','system'));
CREATE TABLE ai_credential_cleanup (
    credential_ref TEXT PRIMARY KEY NOT NULL CHECK(length(credential_ref)=36),
    credential_mode TEXT NOT NULL CHECK(credential_mode IN ('session','system'))
) STRICT;
