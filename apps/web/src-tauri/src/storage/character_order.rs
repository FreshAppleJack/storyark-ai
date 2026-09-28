use super::records::{record, rows};
use super::validation::{expected, invalid, ownership, unlocked, valid_id};
use super::{Database, Result, StorageError};
use rusqlite::{params, TransactionBehavior};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterOrderItem {
    pub character_id: String,
    pub expected_database_version: i64,
    pub expected_position: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReorderCharacters {
    pub book_id: String,
    pub expected_book_version: i64,
    pub items: Vec<CharacterOrderItem>,
}

impl Database {
    pub fn reorder_characters(&mut self, input: ReorderCharacters) -> Result<Value> {
        valid_id(&input.book_id)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let book = record(&tx, "books", &input.book_id)?;
        unlocked(&book)?;
        expected(&book, input.expected_book_version)?;
        let siblings = rows(
            &tx,
            "SELECT * FROM characters WHERE book_id=?",
            &[&input.book_id],
        )?;
        if siblings.len() != input.items.len() {
            return Err(invalid());
        }
        let mut seen = std::collections::HashSet::new();
        // Validate the complete set, including archived characters, before writing.
        for item in &input.items {
            valid_id(&item.character_id)?;
            if !seen.insert(&item.character_id) {
                return Err(invalid());
            }
            let character = record(&tx, "characters", &item.character_id)?;
            ownership(&character, "bookId", &input.book_id)?;
            expected(&character, item.expected_database_version)?;
            if character["position"] != item.expected_position {
                return Err(StorageError::new(
                    "VERSION_CONFLICT",
                    "Order changed; reload before reordering",
                ));
            }
        }
        for (position, item) in input.items.iter().enumerate() {
            if item.expected_position == position as i64 {
                continue;
            }
            let changed = tx.execute(
                "UPDATE characters SET position=? WHERE id=? AND database_version=? AND position=?",
                params![
                    position as i64,
                    item.character_id,
                    item.expected_database_version,
                    item.expected_position
                ],
            )?;
            if changed != 1 {
                return Err(StorageError::new(
                    "VERSION_CONFLICT",
                    "Order changed; reload before reordering",
                ));
            }
        }
        let result = rows(
            &tx,
            "SELECT * FROM characters WHERE book_id=? ORDER BY position,id",
            &[&input.book_id],
        )?;
        tx.commit()?;
        Ok(Value::Array(result))
    }
}
