use super::records::record;
use super::validation::{expected, invalid, now, ownership, unlocked, valid_id};
use super::{Database, Result, StorageError};
use rusqlite::{params, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateNote {
    pub book_id: String,
    pub chapter_id: String,
    pub note_id: String,
    pub expected_database_version: i64,
    pub note: Option<String>,
    pub is_recovered: Option<bool>,
}

impl Database {
    pub fn update_note(&mut self, input: UpdateNote) -> Result<Value> {
        valid_id(&input.book_id)?;
        valid_id(&input.chapter_id)?;
        if input.note_id.is_empty()
            || input.note_id.len() > 4096
            || (input.note.is_none() && input.is_recovered.is_none())
            || input
                .note
                .as_ref()
                .is_some_and(|value| value.len() > 1_048_576)
        {
            return Err(invalid());
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let chapter = record(&tx, "chapters", &input.chapter_id)?;
        ownership(&chapter, "bookId", &input.book_id)?;
        unlocked(&record(&tx, "books", &input.book_id)?)?;
        unlocked(&record(
            &tx,
            "volumes",
            chapter["volumeId"].as_str().ok_or_else(invalid)?,
        )?)?;
        unlocked(&chapter)?;
        expected(&chapter, input.expected_database_version)?;
        let mut notes = chapter["foreshadowings"].clone();
        super::content::notes(notes.as_array().ok_or_else(invalid)?)?;
        let matches: Vec<_> = notes
            .as_array_mut()
            .ok_or_else(invalid)?
            .iter_mut()
            .filter(|note| note["id"] == input.note_id)
            .collect();
        if matches.is_empty() {
            return Err(StorageError::new(
                "NOT_FOUND",
                "Foreshadowing note not found",
            ));
        }
        if matches.len() != 1 {
            return Err(StorageError::new(
                "CONTENT_INCOMPATIBLE",
                "Duplicate note IDs inside this chapter cannot be edited safely",
            ));
        }
        let note = matches.into_iter().next().ok_or_else(invalid)?;
        if let Some(text) = input.note {
            note["note"] = json!(text);
        }
        if let Some(recovered) = input.is_recovered {
            note["isRecovered"] = json!(recovered);
        }
        note["updatedAt"] = json!(now()?.max(note["updatedAt"].as_i64().ok_or_else(invalid)?));
        let changed = tx.execute("UPDATE chapters SET foreshadowings_json=?,database_version=database_version+1,updated_at=max(updated_at,?) WHERE id=? AND database_version=?",
            params![notes.to_string(),now()?,input.chapter_id,input.expected_database_version])?;
        if changed != 1 {
            return Err(StorageError::new("VERSION_CONFLICT", "Chapter changed"));
        }
        let result = record(&tx, "chapters", &input.chapter_id)?;
        tx.commit()?;
        Ok(result)
    }
}
