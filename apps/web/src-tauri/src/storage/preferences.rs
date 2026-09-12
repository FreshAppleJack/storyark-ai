use super::validation::{expected, invalid, now, MAX_INTEGER};
use super::{Database, Result, StorageError};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};

// Full-state write: every key the client knows is sent; None persists NULL,
// which means "not set" and lets the frontend fall back to its defaults.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavePreferences {
    pub expected_database_version: i64,
    pub dark_mode: Option<bool>,
    pub editor_margin_px: Option<i64>,
    pub editor_line_height: Option<f64>,
    pub ai_continue_context_chars: Option<i64>,
    pub ai_continue_output_chars: Option<i64>,
    pub auto_highlight: Option<Value>,
    pub session_key: String,
    pub revision: i64,
}

const VALID_ROLES: [&str; 4] = ["protagonist", "antagonist", "supporting", "mob"];

fn validate(input: &SavePreferences) -> Result<()> {
    if input.session_key.is_empty()
        || input.session_key.len() > 4096
        || !(0..=MAX_INTEGER).contains(&input.revision)
    {
        return Err(invalid());
    }
    if let Some(margin) = input.editor_margin_px {
        if !(24..=72).contains(&margin) {
            return Err(invalid());
        }
    }
    if let Some(height) = input.editor_line_height {
        if !height.is_finite() || !(1.2..=1.8).contains(&height) {
            return Err(invalid());
        }
    }
    if let Some(chars) = input.ai_continue_context_chars {
        if !(500..=6000).contains(&chars) {
            return Err(invalid());
        }
    }
    if let Some(chars) = input.ai_continue_output_chars {
        if !(120..=800).contains(&chars) {
            return Err(invalid());
        }
    }
    if let Some(auto_highlight) = &input.auto_highlight {
        let roles = auto_highlight["disabledRoles"]
            .as_array()
            .ok_or_else(invalid)?;
        if roles.len() > VALID_ROLES.len() {
            return Err(invalid());
        }
        for role in roles {
            if !VALID_ROLES.contains(&role.as_str().ok_or_else(invalid)?) {
                return Err(invalid());
            }
        }
    }
    Ok(())
}

fn read(db: &Connection) -> Result<Value> {
    let row = db
        .query_row(
            "SELECT dark_mode,editor_margin_px,editor_line_height,ai_continue_context_chars,ai_continue_output_chars,auto_highlight_json,database_version,updated_at FROM application_preferences WHERE id=1",
            [],
            |row| {
                Ok((
                    row.get::<_, Option<i64>>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                    row.get::<_, Option<f64>>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, i64>(7)?,
                ))
            },
        )
        .optional()?;
    let Some((dark, margin, height, context, output, auto_highlight, version, time)) = row else {
        // Null means "never initialized": the one-time localStorage import may
        // run. It is distinct from an initialized row with NULL fields.
        return Ok(Value::Null);
    };
    let auto_highlight = auto_highlight
        .map(|raw| {
            serde_json::from_str::<Value>(&raw).map_err(|_| {
                StorageError::new("CONTENT_INCOMPATIBLE", "Stored preferences are invalid")
            })
        })
        .transpose()?;
    Ok(json!({
        "databaseVersion": version,
        "darkMode": dark.map(|value| value != 0),
        "editorMarginPx": margin,
        "editorLineHeight": height,
        "aiContinueContextChars": context,
        "aiContinueOutputChars": output,
        "autoHighlight": auto_highlight,
        "updatedAt": time,
    }))
}

impl Database {
    // Application preferences are independent of any book and unaffected by
    // work locks, so reads and writes never touch book rows.
    pub fn read_preferences(&mut self) -> Result<Value> {
        let tx = self.connection.transaction()?;
        let result = read(&tx)?;
        tx.commit()?;
        Ok(result)
    }

    pub fn save_preferences(&mut self, input: SavePreferences) -> Result<Value> {
        validate(&input)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = read(&tx)?;
        if current.is_null() {
            // First write (the import path) must expect version 0; once a row
            // exists, expected 0 is a conflict so a stale importer can never
            // overwrite initialized preferences.
            if input.expected_database_version != 0 {
                return Err(StorageError::new("VERSION_CONFLICT", "Preferences changed"));
            }
        } else if input.expected_database_version == 0 {
            return Err(StorageError {
                code: "VERSION_CONFLICT".into(),
                message: "Preferences were initialized in another session".into(),
                current_database_version: current["databaseVersion"].as_i64(),
            });
        } else {
            expected(&current, input.expected_database_version)?;
        }
        let auto_highlight = input.auto_highlight.as_ref().map(Value::to_string);
        let time = now()?;
        tx.execute(
            "INSERT INTO application_preferences(id,dark_mode,editor_margin_px,editor_line_height,ai_continue_context_chars,ai_continue_output_chars,auto_highlight_json,created_at,updated_at) VALUES (1,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET dark_mode=excluded.dark_mode,editor_margin_px=excluded.editor_margin_px,editor_line_height=excluded.editor_line_height,ai_continue_context_chars=excluded.ai_continue_context_chars,ai_continue_output_chars=excluded.ai_continue_output_chars,auto_highlight_json=excluded.auto_highlight_json,database_version=application_preferences.database_version+1,updated_at=max(application_preferences.updated_at,excluded.updated_at)",
            params![
                input.dark_mode.map(|value| if value { 1 } else { 0 }),
                input.editor_margin_px,
                input.editor_line_height,
                input.ai_continue_context_chars,
                input.ai_continue_output_chars,
                auto_highlight,
                time,
                time
            ],
        )?;
        let saved = read(&tx)?;
        tx.commit()?;
        Ok(json!({"preferences":saved,"sessionKey":input.session_key,"revision":input.revision}))
    }
}
