use super::{
    validation::{now, valid_id, MAX_INTEGER},
    Database, Result, StorageError,
};
use crate::ai::{
    config::{ConfigInput, ConfigVersion, DeleteConfig, SetDefault},
    credentials::normalize,
    settings::{CredentialChange, SaveSettings},
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};

pub(super) fn fail(code: &str) -> StorageError {
    StorageError::new(code, "AI settings operation failed")
}
pub(super) fn row(conn: &Connection, id: &str) -> Result<Value> {
    valid_id(id)?;
    conn.query_row("SELECT name,protocol,base_url,model_id,timeout_ms,max_output_tokens,config_version,created_at,updated_at,credential_ref,credential_mode FROM ai_model_configs WHERE id=?", [id], |r| Ok(json!({
        "id":id,"config":{"name":r.get::<_,String>(0)?,"protocol":r.get::<_,String>(1)?,"baseUrl":r.get::<_,String>(2)?,"modelId":r.get::<_,String>(3)?,"timeoutMs":r.get::<_,i64>(4)?,"maxOutputTokens":r.get::<_,Option<i64>>(5)?},
        "configVersion":r.get::<_,i64>(6)?,"createdAt":r.get::<_,i64>(7)?,"updatedAt":r.get::<_,i64>(8)?,"credentialRef":r.get::<_,Option<String>>(9)?,"credentialMode":r.get::<_,String>(10)?
    }))).optional()?.ok_or_else(|| fail("NOT_FOUND"))
}
pub(super) fn version(value: &Value, expected: u64) -> Result<()> {
    if expected == 0 || expected >= MAX_INTEGER as u64 {
        return Err(fail("VALIDATION_ERROR"));
    }
    if value["configVersion"].as_u64() != Some(expected) {
        return Err(fail("VERSION_CONFLICT"));
    }
    Ok(())
}
fn defaults(conn: &Connection, expected: Option<u64>) -> Result<(Option<String>, u64)> {
    let state = conn
        .query_row(
            "SELECT default_config_id,database_version FROM ai_generation_settings WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get::<_, u64>(1)?)),
        )
        .optional()?
        .unwrap_or((None, 0));
    if let Some(expected) = expected {
        if expected >= MAX_INTEGER as u64 || expected != state.1 {
            return Err(fail("VERSION_CONFLICT"));
        }
    }
    Ok(state)
}

impl Database {
    pub fn ai_list(&mut self) -> Result<Value> {
        self.cleanup_credentials()?;
        let ids = self
            .connection
            .prepare("SELECT id FROM ai_model_configs ORDER BY created_at,id")?
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut configs = Vec::new();
        for id in ids {
            let mut value = row(&self.connection, &id)?;
            let available = value["credentialRef"]
                .as_str()
                .map(|reference| {
                    self.credentials
                        .get(reference, value["credentialMode"].as_str().unwrap())
                        .is_ok()
                })
                .unwrap_or(false);
            value["credentialStatus"] = json!(if !available {
                "unavailable"
            } else if value["credentialMode"] == "session" {
                "session"
            } else {
                "configured"
            });
            value.as_object_mut().unwrap().remove("credentialRef");
            configs.push(value);
        }
        let (default_id, database_version) = defaults(&self.connection, None)?;
        let pending: i64 =
            self.connection
                .query_row("SELECT count(*) FROM ai_credential_cleanup", [], |r| {
                    r.get(0)
                })?;
        Ok(
            json!({"configs":configs,"defaultConfigId":default_id,"databaseVersion":database_version,"cleanupPending":pending > 0}),
        )
    }

    pub fn ai_save(&mut self, input: SaveSettings) -> Result<Value> {
        input
            .config
            .validate()
            .map_err(|_| fail("VALIDATION_ERROR"))?;
        let id = input
            .id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        valid_id(&id)?;
        let new_secret = match input.credential {
            CredentialChange::Keep => None,
            CredentialChange::Replace { key, remember } => Some((
                normalize(key).map_err(|_| fail("VALIDATION_ERROR"))?,
                if remember { "system" } else { "session" },
            )),
        };
        if input.id.is_none() && (input.expected_config_version != 0 || new_secret.is_none()) {
            return Err(fail("VALIDATION_ERROR"));
        }
        let reference = new_secret
            .as_ref()
            .map(|_| uuid::Uuid::new_v4().to_string());
        if let Some((_, mode)) = &new_secret {
            // Commit cleanup intent BEFORE touching a separate credential store.
            self.connection.execute(
                "INSERT INTO ai_credential_cleanup VALUES (?,?)",
                params![reference, mode],
            )?;
        }
        let operation = (|| -> Result<()> {
            let tx = self
                .connection
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            let old = if input.id.is_some() {
                let old = row(&tx, &id)?;
                version(&old, input.expected_config_version)?;
                Some(old)
            } else {
                None
            };
            if new_secret.is_none() {
                let old = old.as_ref().ok_or_else(|| fail("VALIDATION_ERROR"))?;
                // Reusing a key for another destination requires explicit replacement.
                if old["config"]["baseUrl"] != input.config.base_url
                    || old["config"]["protocol"]
                        != serde_json::to_value(&input.config.protocol).unwrap()
                {
                    return Err(fail("CREDENTIAL_REPLACEMENT_REQUIRED"));
                }
            }
            let (credential_ref, mode) = if let Some((secret, mode)) = new_secret {
                let reference = reference.as_ref().unwrap();
                // Another process may have cleaned the intent before this lock.
                if !tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM ai_credential_cleanup WHERE credential_ref=?)",
                    [reference],
                    |r| r.get::<_, bool>(0),
                )? {
                    return Err(fail("STORAGE_FAILURE"));
                }
                self.credentials
                    .set(reference, mode, secret)
                    .map_err(|_| fail("CREDENTIAL_UNAVAILABLE"))?;
                (Some(reference.to_owned()), mode.to_string())
            } else {
                let old = old.as_ref().unwrap();
                (
                    old["credentialRef"].as_str().map(str::to_owned),
                    old["credentialMode"].as_str().unwrap().to_owned(),
                )
            };
            let time = now()?;
            let config = input.config;
            let protocol = serde_json::to_value(config.protocol).unwrap();
            tx.execute("INSERT INTO ai_model_configs(id,name,protocol,base_url,model_id,timeout_ms,max_output_tokens,credential_ref,config_version,created_at,updated_at,credential_mode) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,protocol=excluded.protocol,base_url=excluded.base_url,model_id=excluded.model_id,timeout_ms=excluded.timeout_ms,max_output_tokens=excluded.max_output_tokens,credential_ref=excluded.credential_ref,config_version=excluded.config_version,updated_at=excluded.updated_at,credential_mode=excluded.credential_mode", params![id,config.name.trim(),protocol.as_str().unwrap(),config.base_url,config.model_id.trim(),config.timeout_ms,config.max_output_tokens,credential_ref,input.expected_config_version+1,old.as_ref().and_then(|v|v["createdAt"].as_i64()).unwrap_or(time),time,mode])?;
            if let Some(old) = old {
                if old["credentialRef"].as_str() != credential_ref.as_deref() {
                    if let Some(reference) = old["credentialRef"].as_str() {
                        tx.execute(
                            "INSERT OR IGNORE INTO ai_credential_cleanup VALUES (?,?)",
                            params![reference, old["credentialMode"].as_str().unwrap()],
                        )?;
                    }
                }
            }
            if let Some(reference) = reference {
                tx.execute(
                    "DELETE FROM ai_credential_cleanup WHERE credential_ref=?",
                    [reference],
                )?;
            }
            tx.commit()?;
            Ok(())
        })();
        // Cleanup failure must not turn an already committed save into failure.
        let cleanup_failed = self.cleanup_credentials().is_err();
        operation?;
        Ok(
            json!({"id":id,"configVersion":input.expected_config_version+1,"cleanupPending":cleanup_failed}),
        )
    }

    pub fn ai_default(&mut self, input: SetDefault) -> Result<Value> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (_, previous) = defaults(&tx, Some(input.expected_database_version))?;
        if let Some(config) = &input.config {
            version(&row(&tx, &config.id)?, config.expected_config_version)?;
        }
        tx.execute("INSERT INTO ai_generation_settings VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET default_config_id=excluded.default_config_id,database_version=excluded.database_version,updated_at=excluded.updated_at", params![input.config.map(|c| c.id),previous+1,now()?])?;
        tx.commit()?;
        Ok(json!({"databaseVersion":previous+1}))
    }

    pub fn ai_delete(&mut self, input: DeleteConfig) -> Result<Value> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let old = row(&tx, &input.config.id)?;
        version(&old, input.config.expected_config_version)?;
        let (default, previous) = defaults(&tx, Some(input.expected_default_database_version))?;
        if default.as_deref() == Some(&input.config.id) {
            tx.execute("UPDATE ai_generation_settings SET default_config_id=NULL,database_version=database_version+1,updated_at=? WHERE id=1",[now()?])?;
        }
        if let Some(reference) = old["credentialRef"].as_str() {
            tx.execute(
                "INSERT OR IGNORE INTO ai_credential_cleanup VALUES (?,?)",
                params![reference, old["credentialMode"].as_str().unwrap()],
            )?;
        }
        tx.execute(
            "DELETE FROM ai_model_configs WHERE id=?",
            [&input.config.id],
        )?;
        tx.commit()?;
        let _ = self.cleanup_credentials();
        Ok(json!({"deletedId":input.config.id,"previousDefaultVersion":previous}))
    }

    pub fn ai_snapshot(&mut self, input: ConfigVersion) -> Result<crate::ai::connection::Snapshot> {
        let value = row(&self.connection, &input.id)?;
        version(&value, input.expected_config_version)?;
        let reference = value["credentialRef"]
            .as_str()
            .ok_or_else(|| fail("CREDENTIAL_UNAVAILABLE"))?;
        let key = self
            .credentials
            .get(reference, value["credentialMode"].as_str().unwrap())
            .map_err(|_| fail("CREDENTIAL_UNAVAILABLE"))?;
        let config: ConfigInput = serde_json::from_value(value["config"].clone())
            .map_err(|_| fail("VALIDATION_ERROR"))?;
        config.validate().map_err(|_| fail("VALIDATION_ERROR"))?;
        Ok(crate::ai::connection::Snapshot { config, key })
    }

    pub fn ai_check_version(&self, input: ConfigVersion) -> Result<Value> {
        version(
            &row(&self.connection, &input.id)?,
            input.expected_config_version,
        )?;
        Ok(json!({"configVersion":input.expected_config_version}))
    }
}
