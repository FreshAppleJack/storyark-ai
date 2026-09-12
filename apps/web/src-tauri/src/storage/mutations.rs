use super::records::{bump, record, rows};
use super::requests::{Delete, Rename, Reorder, SetReadOnly, Target};
use super::targets::{locate, unlocked_ancestors};
use super::validation::{expected, invalid, now, title, unlocked};
use super::{Database, Result, StorageError};
use rusqlite::{params, TransactionBehavior};
use serde_json::{json, Value};

impl Database {
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
        let result = record(&tx, target.table, &target.id)?;
        tx.commit()?;
        Ok(result)
    }
    pub fn reorder(&mut self, input: Reorder) -> Result<Value> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        // A reorder never bumps the parent version: position is a child-row
        // property, and callers update children from the returned records.
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
                    "SELECT * FROM chapters WHERE volume_id=?",
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
            let belongs = match (&input.parent, &item.target) {
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
            let located = locate(&tx, &item.target)?;
            if !seen.insert(located.id.clone()) {
                return Err(invalid());
            }
            unlocked_ancestors(&located)?;
            unlocked(&located.row)?;
            expected(&located.row, item.expected_database_version)?;
            let changed = tx.execute(&format!("UPDATE {} SET position=?,database_version=database_version+1,updated_at=max(updated_at,?) WHERE id=? AND database_version=?", child_table), params![index as i64, now()?, located.id, item.expected_database_version])?;
            if changed != 1 {
                return Err(StorageError::new("VERSION_CONFLICT", "Record changed"));
            }
            ordered.push(record(&tx, child_table, &located.id)?);
        }
        if siblings
            .iter()
            .any(|row| !seen.contains(row["id"].as_str().unwrap_or_default()))
        {
            return Err(invalid());
        }
        tx.commit()?;
        Ok(Value::Array(ordered))
    }
    pub fn delete(&mut self, input: Delete) -> Result<Value> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let target = locate(&tx, &input.target.target)?;
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
        tx.commit()?;
        Ok(json!({"deletedId":target.id,"parent":parent}))
    }
}
