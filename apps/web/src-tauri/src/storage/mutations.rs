use super::records::{bump, record, rows};
use super::requests::{Delete, Rename, Reorder, SetReadOnly, Target, UpdateBook};
use super::targets::{locate, unlocked_ancestors};
use super::validation::{expected, invalid, now, title, unlocked, valid_id};
use super::{Database, Result, StorageError};
use rusqlite::{params, TransactionBehavior};
use serde_json::{json, Value};

impl Database {
    // Bookshelf management: title and/or lifecycle status in one version-checked
    // write. At least one field is required; author stays creation-time only.
    pub fn update_book(&mut self, input: UpdateBook) -> Result<Value> {
        valid_id(&input.book_id)?;
        if let Some(new_title) = &input.title {
            title(new_title)?;
        }
        if let Some(status) = &input.status {
            if !matches!(status.as_str(), "serializing" | "completed") {
                return Err(invalid());
            }
        }
        if input.title.is_none() && input.status.is_none() {
            return Err(invalid());
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let book = record(&tx, "books", &input.book_id)?;
        unlocked(&book)?;
        expected(&book, input.expected_database_version)?;
        let next_title = input
            .title
            .as_deref()
            .unwrap_or_else(|| book["title"].as_str().unwrap());
        let next_status = input
            .status
            .as_deref()
            .unwrap_or_else(|| book["status"].as_str().unwrap());
        let changed = tx.execute("UPDATE books SET title=?,status=?,database_version=database_version+1,updated_at=max(updated_at,?) WHERE id=? AND database_version=?", params![next_title, next_status, now()?, input.book_id, input.expected_database_version])?;
        if changed != 1 {
            return Err(StorageError::new("VERSION_CONFLICT", "Book changed"));
        }
        let result = record(&tx, "books", &input.book_id)?;
        tx.commit()?;
        Ok(result)
    }
    pub fn rename(&mut self, input: Rename) -> Result<Value> {
        title(&input.title)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let target = locate(&tx, &input.target.target)?;
        unlocked_ancestors(&target)?;
        unlocked(&target.row)?;
        expected(&target.row, input.target.expected_database_version)?;
        let changed = tx.execute(&format!("UPDATE {} SET title=?,database_version=database_version+1,updated_at=max(updated_at,?) WHERE id=? AND database_version=?", target.table), params![input.title, now()?, target.id, input.target.expected_database_version])?;
        if changed != 1 {
            return Err(StorageError::new("VERSION_CONFLICT", "Record changed"));
        }
        if target.table == "chapters" {
            let book_id = target.row["bookId"].as_str().ok_or_else(invalid)?;
            super::retrieval_sources::sync_sources_in_transaction(&tx, book_id)?;
        }
        let result = record(&tx, target.table, &target.id)?;
        tx.commit()?;
        Ok(result)
    }
    pub fn set_read_only(&mut self, input: SetReadOnly) -> Result<Value> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let target = locate(&tx, &input.target.target)?;
        // Ancestor locks block the change, but the record's own lock must not:
        // otherwise a locked chapter could never be unlocked again.
        unlocked_ancestors(&target)?;
        expected(&target.row, input.target.expected_database_version)?;
        let changed = tx.execute(&format!("UPDATE {} SET is_read_only=?,database_version=database_version+1,updated_at=max(updated_at,?) WHERE id=? AND database_version=?", target.table), params![input.is_read_only, now()?, target.id, input.target.expected_database_version])?;
        if changed != 1 {
            return Err(StorageError::new("VERSION_CONFLICT", "Record changed"));
        }
        let book_id = if target.table == "books" {
            target.id.as_str()
        } else {
            target.row["bookId"].as_str().ok_or_else(invalid)?
        };
        super::retrieval_sources::sync_sources_in_transaction(&tx, book_id)?;
        let result = record(&tx, target.table, &target.id)?;
        tx.commit()?;
        Ok(result)
    }
    pub fn reorder(&mut self, input: Reorder) -> Result<Value> {
        self.reorder_records(input, false)
    }
    pub fn reorder_directory(&mut self, input: Reorder) -> Result<Value> {
        self.reorder_records(input, true)
    }
    fn reorder_records(&mut self, input: Reorder, directory_only: bool) -> Result<Value> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let source_book_id = input
            .parent
            .as_ref()
            .and_then(|parent| match &parent.target {
                Target::Book { book_id } | Target::Volume { book_id, .. } => Some(book_id.clone()),
                Target::Chapter { .. } => None,
            });
        // Position has its own compare-and-swap below. A pure reorder must not
        // change content versions or invalidate chapter summaries/embeddings.
        let child_table: &str = match &input.parent {
            None => "books",
            Some(parent) => {
                let located = locate(&tx, &parent.target)?;
                if located.table == "chapters" {
                    return Err(invalid());
                }
                unlocked_ancestors(&located)?;
                unlocked(&located.row)?;
                expected(&located.row, parent.expected_database_version)?;
                if located.table == "books" {
                    "volumes"
                } else {
                    "chapters"
                }
            }
        };
        let siblings = match &input.parent {
            None => rows(&tx, "SELECT * FROM books", &[])?,
            Some(parent) => match &parent.target {
                Target::Book { book_id } => {
                    rows(&tx, "SELECT * FROM volumes WHERE book_id=?", &[book_id])?
                }
                Target::Volume { volume_id, .. } => rows(
                    &tx,
                    "SELECT id FROM chapters WHERE volume_id=?",
                    &[volume_id],
                )?,
                Target::Chapter { .. } => return Err(invalid()),
            },
        };
        if siblings.len() != input.items.len() {
            return Err(invalid());
        }
        let mut seen = std::collections::HashSet::new();
        let mut ordered = Vec::with_capacity(input.items.len());
        for (index, item) in input.items.iter().enumerate() {
            let belongs = match (&input.parent, &item.target.target) {
                (None, Target::Book { .. }) => true,
                (Some(parent), Target::Volume { book_id, .. }) => {
                    matches!(&parent.target, Target::Book { book_id: parent_id } if parent_id == book_id)
                }
                (Some(parent), Target::Chapter { volume_id, .. }) => {
                    matches!(&parent.target, Target::Volume { volume_id: parent_id, .. } if parent_id == volume_id)
                }
                _ => false,
            };
            if !belongs {
                return Err(invalid());
            }
            let located = locate(&tx, &item.target.target)?;
            if !seen.insert(located.id.clone()) {
                return Err(invalid());
            }
            unlocked_ancestors(&located)?;
            unlocked(&located.row)?;
            expected(&located.row, item.target.expected_database_version)?;
            if located.row["position"] != item.expected_position {
                return Err(StorageError::new(
                    "VERSION_CONFLICT",
                    "Order changed; reload before reordering",
                ));
            }
            if item.expected_position != index as i64 {
                let changed = tx.execute(
                    &format!(
                        "UPDATE {} SET position=? WHERE id=? AND database_version=? AND position=?",
                        child_table
                    ),
                    params![
                        index as i64,
                        located.id,
                        item.target.expected_database_version,
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
            ordered.push(if directory_only && child_table == "chapters" {
                super::records::chapter_directory_record(&tx, &located.id)?
            } else {
                record(&tx, child_table, &located.id)?
            });
        }
        if siblings
            .iter()
            .any(|row| !seen.contains(row["id"].as_str().unwrap_or_default()))
        {
            return Err(invalid());
        }
        if let Some(book_id) = source_book_id {
            super::retrieval_sources::sync_order_metadata_in_transaction(&tx, &book_id)?;
        }
        tx.commit()?;
        Ok(Value::Array(ordered))
    }
    pub fn delete(&mut self, input: Delete) -> Result<Value> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let target = locate(&tx, &input.target.target)?;
        let source_book_id = if target.table == "books" {
            None
        } else {
            Some(
                target.row["bookId"]
                    .as_str()
                    .ok_or_else(invalid)?
                    .to_owned(),
            )
        };
        unlocked_ancestors(&target)?;
        unlocked(&target.row)?;
        expected(&target.row, input.target.expected_database_version)?;
        // Deleting advances the parent version so other sessions notice the
        // structural change; the version is required except for root books.
        // Every input is validated before any row is touched.
        let parent = match (target.ancestors.last(), input.expected_parent_version) {
            (Some((table, row)), Some(version)) => {
                expected(row, version)?;
                Some((
                    table,
                    row["id"].as_str().ok_or_else(invalid)?.to_string(),
                    version,
                ))
            }
            (Some(_), None) => return Err(invalid()),
            (None, _) => None,
        };
        if target.table != "books" {
            let book_id = target.row["bookId"].as_str().ok_or_else(invalid)?;
            let ids = if target.table == "chapters" {
                std::collections::HashSet::from([target.id.clone()])
            } else {
                rows(
                    &tx,
                    "SELECT id FROM chapters WHERE volume_id=?",
                    &[&target.id],
                )?
                .iter()
                .map(|row| row["id"].as_str().map(str::to_owned).ok_or_else(invalid))
                .collect::<Result<std::collections::HashSet<_>>>()?
            };
            if !ids.is_empty() {
                super::planning_cleanup::remove_chapters(&tx, book_id, &ids)?;
            }
        }
        let changed = tx.execute(
            &format!(
                "DELETE FROM {} WHERE id=? AND database_version=?",
                target.table
            ),
            params![target.id, input.target.expected_database_version],
        )?;
        if changed != 1 {
            return Err(StorageError::new("VERSION_CONFLICT", "Record changed"));
        }
        let parent = match parent {
            Some((table, id, version)) => {
                bump(&tx, table, &id, version, now()?)?;
                Some(record(&tx, table, &id)?)
            }
            None => None,
        };
        if let Some(book_id) = source_book_id {
            super::retrieval_sources::sync_sources_in_transaction(&tx, &book_id)?;
        }
        tx.commit()?;
        Ok(json!({"deletedId":target.id,"parent":parent}))
    }
}
