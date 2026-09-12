use super::records::record;
use super::validation::{expected, invalid, now, ownership, unlocked, valid_id, MAX_INTEGER};
use super::{Database, Result, StorageError};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveBrainstorm {
    pub book_id: String,
    pub expected_database_version: i64,
    pub selected_chapter_ids: Value,
    pub context_snapshot: Value,
    pub generated_options: Value,
    pub selected_option_id: Option<String>,
    pub final_content: String,
    pub session_key: String,
    pub revision: i64,
}

fn validate(db: &Connection, book_id: &str, input: &SaveBrainstorm) -> Result<()> {
    if input.session_key.is_empty()
        || input.session_key.len() > 4096
        || !(0..=MAX_INTEGER).contains(&input.revision)
        || input.final_content.len() > 1_048_576
    {
        return Err(invalid());
    }
    // Live selection: every chapter must belong to this book, checked inside
    // the write transaction.
    let selected = input.selected_chapter_ids.as_array().ok_or_else(invalid)?;
    if selected.len() > 100_000 {
        return Err(invalid());
    }
    let mut seen = HashSet::new();
    for id in selected {
        let id = id.as_str().ok_or_else(invalid)?;
        valid_id(id)?;
        if !seen.insert(id) {
            return Err(invalid());
        }
        ownership(&record(db, "chapters", id)?, "bookId", book_id)?;
    }
    // Historical snapshots are opaque, but must stay an object of bounded size.
    if !input.context_snapshot.is_object() || input.context_snapshot.to_string().len() > 4_194_304 {
        return Err(invalid());
    }
    let options = input.generated_options.as_array().ok_or_else(invalid)?;
    if options.len() > 100_000 {
        return Err(invalid());
    }
    let mut option_ids = HashSet::new();
    for option in options {
        let id = option["id"].as_str().ok_or_else(invalid)?;
        if id.is_empty() || id.len() > 4096 || !option_ids.insert(id) {
            return Err(invalid());
        }
        for field in [
            "title",
            "conflict",
            "motivation",
            "consequences",
            "development",
        ] {
            if option[field]
                .as_str()
                .map_or(true, |text| text.len() > 1_048_576)
            {
                return Err(invalid());
            }
        }
    }
    if let Some(selected) = &input.selected_option_id {
        if !option_ids.contains(selected.as_str()) {
            return Err(invalid());
        }
    }
    Ok(())
}

fn read(db: &Connection, book_id: &str) -> Result<Value> {
    let row = db
        .query_row(
            "SELECT selected_chapter_ids_json,context_snapshot_json,generated_options_json,selected_option_id,final_content,database_version,updated_at FROM brainstorm_workspaces WHERE book_id=?",
            [book_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                ))
            },
        )
        .optional()?;
    let Some((selected, snapshot, options, selected_option, final_content, version, time)) = row
    else {
        // An empty aggregate with version 0 only when the row genuinely does
        // not exist; first save expects 0. Errors stay errors.
        return Ok(json!({
            "bookId": book_id, "databaseVersion": 0, "selectedChapterIds": [],
            "contextSnapshot": {}, "generatedOptions": [], "selectedOptionId": null,
            "finalContent": "",
        }));
    };
    let parse = |raw: &str| {
        serde_json::from_str::<Value>(raw).map_err(|_| {
            StorageError::new(
                "CONTENT_INCOMPATIBLE",
                "Stored brainstorm workspace is invalid",
            )
        })
    };
    Ok(json!({
        "bookId": book_id,
        "databaseVersion": version,
        "selectedChapterIds": parse(&selected)?,
        "contextSnapshot": parse(&snapshot)?,
        "generatedOptions": parse(&options)?,
        "selectedOptionId": selected_option,
        "finalContent": final_content,
        "updatedAt": time,
    }))
}

impl Database {
    pub fn read_brainstorm(&mut self, book_id: &str) -> Result<Value> {
        valid_id(book_id)?;
        let tx = self.connection.transaction()?;
        record(&tx, "books", book_id)?;
        let result = read(&tx, book_id)?;
        tx.commit()?;
        Ok(result)
    }

    pub fn save_brainstorm(&mut self, input: SaveBrainstorm) -> Result<Value> {
        valid_id(&input.book_id)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        unlocked(&record(&tx, "books", &input.book_id)?)?;
        let current = read(&tx, &input.book_id)?;
        if current["databaseVersion"] == 0 {
            if input.expected_database_version != 0 {
                return Err(StorageError::new(
                    "VERSION_CONFLICT",
                    "Brainstorm workspace changed",
                ));
            }
        } else if input.expected_database_version == 0 {
            return Err(StorageError {
                code: "VERSION_CONFLICT".into(),
                message: "Brainstorm workspace was created in another session".into(),
                current_database_version: current["databaseVersion"].as_i64(),
            });
        } else {
            expected(&current, input.expected_database_version)?;
        }
        validate(&tx, &input.book_id, &input)?;
        let time = now()?;
        tx.execute(
            "INSERT INTO brainstorm_workspaces(book_id,selected_chapter_ids_json,context_snapshot_json,generated_options_json,selected_option_id,final_content,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(book_id) DO UPDATE SET selected_chapter_ids_json=excluded.selected_chapter_ids_json,context_snapshot_json=excluded.context_snapshot_json,generated_options_json=excluded.generated_options_json,selected_option_id=excluded.selected_option_id,final_content=excluded.final_content,database_version=brainstorm_workspaces.database_version+1,updated_at=max(brainstorm_workspaces.updated_at,excluded.updated_at)",
            params![
                input.book_id,
                input.selected_chapter_ids.to_string(),
                input.context_snapshot.to_string(),
                input.generated_options.to_string(),
                input.selected_option_id,
                input.final_content,
                time,
                time
            ],
        )?;
        let saved = read(&tx, &input.book_id)?;
        tx.commit()?;
        Ok(json!({"workspace":saved,"sessionKey":input.session_key,"revision":input.revision}))
    }
}
