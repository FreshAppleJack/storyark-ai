use super::planning_validation::validate;
use super::records::record;
use super::validation::{expected, invalid, now, unlocked, valid_id, MAX_INTEGER};
use super::{Database, Result, StorageError};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavePlanning {
    pub book_id: String,
    pub expected_database_version: i64,
    pub story_summary: String,
    pub story_background: String,
    pub chapter_summaries: Value,
    pub plot_settings: Value,
    pub session_key: String,
    pub revision: i64,
}

pub(super) fn read(db: &Connection, book_id: &str) -> Result<Value> {
    let row = db.query_row("SELECT story_summary,story_background,chapter_summaries_json,plot_settings_json,database_version,updated_at FROM planning WHERE book_id=?", [book_id], |row| {
        Ok((row.get::<_, String>(0)?,row.get::<_, String>(1)?,row.get::<_, String>(2)?,row.get::<_, String>(3)?,row.get::<_, i64>(4)?,row.get::<_, i64>(5)?))
    }).optional()?;
    match row {
        None => Ok(
            json!({"bookId":book_id,"databaseVersion":0,"storySummary":"","storyBackground":"","chapterSummaries":[],"plotSettings":[]}),
        ),
        Some((summary, background, summaries, plots, version, time)) => {
            let parse = |raw: &str| {
                serde_json::from_str::<Value>(raw).map_err(|_| {
                    StorageError::new("CONTENT_INCOMPATIBLE", "Stored planning is invalid")
                })
            };
            let summaries = parse(&summaries)?;
            let plots = parse(&plots)?;
            validate(db, book_id, &summaries, &plots)?;
            Ok(
                json!({"bookId":book_id,"databaseVersion":version,"storySummary":summary,"storyBackground":background,"chapterSummaries":summaries,"plotSettings":plots,"updatedAt":time}),
            )
        }
    }
}

impl Database {
    pub fn read_planning(&mut self, book_id: &str) -> Result<Value> {
        valid_id(book_id)?;
        let tx = self.connection.transaction()?;
        record(&tx, "books", book_id)?;
        let result = read(&tx, book_id)?;
        tx.commit()?;
        Ok(result)
    }
    pub fn save_planning(&mut self, input: SavePlanning) -> Result<Value> {
        valid_id(&input.book_id)?;
        if input.story_summary.len() > 1_048_576
            || input.story_background.len() > 1_048_576
            || input.session_key.is_empty()
            || input.session_key.len() > 4096
            || !(0..=MAX_INTEGER).contains(&input.revision)
        {
            return Err(invalid());
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        unlocked(&record(&tx, "books", &input.book_id)?)?;
        let current = read(&tx, &input.book_id)?;
        if current["databaseVersion"] == 0 {
            if input.expected_database_version != 0 {
                return Err(StorageError::new("VERSION_CONFLICT", "Planning changed"));
            }
        } else {
            if input.expected_database_version == 0 {
                return Err(StorageError {
                    code: "VERSION_CONFLICT".into(),
                    message: "Planning was created in another session".into(),
                    current_database_version: current["databaseVersion"].as_i64(),
                });
            }
            expected(&current, input.expected_database_version)?;
        }
        validate(
            &tx,
            &input.book_id,
            &input.chapter_summaries,
            &input.plot_settings,
        )?;
        let time = now()?;
        tx.execute("INSERT INTO planning(book_id,story_summary,story_background,chapter_summaries_json,plot_settings_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(book_id) DO UPDATE SET story_summary=excluded.story_summary,story_background=excluded.story_background,chapter_summaries_json=excluded.chapter_summaries_json,plot_settings_json=excluded.plot_settings_json,database_version=planning.database_version+1,updated_at=max(planning.updated_at,excluded.updated_at)",
            params![input.book_id,input.story_summary,input.story_background,input.chapter_summaries.to_string(),input.plot_settings.to_string(),time,time])?;
        let result = read(&tx, &input.book_id)?;
        tx.commit()?;
        Ok(json!({"planning":result,"sessionKey":input.session_key,"revision":input.revision}))
    }
}
