use super::records::record;
use super::validation::{invalid, ownership, unlocked, valid_id};
use super::{Database, Result, StorageError};
use crate::ai::generation::ValidateAiAdoption;
use rusqlite::{OptionalExtension, TransactionBehavior};
use serde_json::json;
use std::collections::HashSet;

fn changed() -> StorageError {
    StorageError::new(
        "CONTEXT_CHANGED",
        "The manuscript or a retrieved source changed. Keep the candidate and regenerate before adopting.",
    )
}

impl Database {
    /// Revalidate persisted manuscript locks/version and every retrieved
    /// source in one SQLite snapshot immediately before candidate adoption.
    pub fn validate_ai_adoption(&mut self, input: ValidateAiAdoption) -> Result<serde_json::Value> {
        valid_id(&input.book_id)?;
        valid_id(&input.chapter_id)?;
        if input.retrieval_source_versions.len() > 200 {
            return Err(invalid());
        }

        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Deferred)?;
        let book = record(&tx, "books", &input.book_id)?;
        let chapter = record(&tx, "chapters", &input.chapter_id)?;
        ownership(&chapter, "bookId", &input.book_id)?;
        let volume_id = chapter["volumeId"].as_str().ok_or_else(invalid)?;
        let volume = record(&tx, "volumes", volume_id)?;
        ownership(&volume, "bookId", &input.book_id)?;
        ownership(&chapter, "volumeId", volume_id)?;
        unlocked(&book)?;
        unlocked(&volume)?;
        unlocked(&chapter)?;
        let expected_version = i64::try_from(input.database_version).map_err(|_| invalid())?;
        if expected_version <= 0 || chapter["databaseVersion"].as_i64() != Some(expected_version) {
            return Err(changed());
        }

        let mut seen = HashSet::new();
        for source in &input.retrieval_source_versions {
            if source.source_id.trim().is_empty()
                || source.source_id.len() > 512
                || source.source_version <= 0
                || source.index_version <= 0
                || !seen.insert(source.source_id.as_str())
            {
                return Err(invalid());
            }
            if let Some(chapter_id) = &source.chapter_id {
                valid_id(chapter_id)?;
                let referenced_chapter = record(&tx, "chapters", chapter_id)?;
                if referenced_chapter["bookId"] != input.book_id {
                    return Err(changed());
                }
            }
            let current = tx
                .query_row(
                    "SELECT book_id,source_version,source_status,source_kind,entity_id FROM retrieval_sources WHERE source_id=?",
                    [&source.source_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                        ))
                    },
                )
                .optional()?;
            let Some((source_book_id, source_version, source_status, source_kind, entity_id)) =
                current
            else {
                return Err(changed());
            };
            if source_book_id != input.book_id
                || source_version != source.source_version
                || source_status != "active"
                || source.source_id != format!("{source_book_id}:{source_kind}:{entity_id}")
            {
                return Err(changed());
            }
        }

        tx.commit()?;
        Ok(json!({"validated": true}))
    }
}
