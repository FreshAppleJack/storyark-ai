use super::backup::backup_database;
use super::records::record;
use super::{Database, Result, StorageError};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

mod mapping;
mod persistence;
mod validation;

use mapping::{build_id_map, copy_work};
use persistence::{find_book, import_stats, insert_work, next_copy_title, stats_for_db};
use validation::*;

const EXCHANGE_SCHEMA_VERSION: i64 = 1;
const EXCHANGE_CONTENT_VERSION: i64 = 1;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrepareWorkImport {
    pub work: Value,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportMode {
    Import,
    Replace,
    Copy,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportWork {
    pub work: Value,
    pub mode: ImportMode,
    pub expected_target_database_version: Option<i64>,
    #[serde(default)]
    pub request_id: Option<String>,
}

#[derive(Default)]
struct ImportCounts {
    volumes: usize,
    chapters: usize,
    characters: usize,
    graph_nodes: usize,
    graph_edges: usize,
    foreshadowings: usize,
    planning_summaries: usize,
    plot_settings: usize,
    brainstorm_workspaces: usize,
    brainstorm_options: usize,
    assets: usize,
}

#[derive(Default)]
struct IdMap {
    book: HashMap<String, String>,
    volumes: HashMap<String, String>,
    chapters: HashMap<String, String>,
    characters: HashMap<String, String>,
    node_keys: HashMap<String, String>,
    edges: HashMap<String, String>,
    notes: HashMap<(String, String), String>,
    plots: HashMap<String, String>,
    options: HashMap<String, String>,
}

impl Database {
    pub fn prepare_work_import(&mut self, work: Value) -> Result<Value> {
        let counts = validate_work(&work)?;
        let book_id = uuid_field(required(&work, "book")?, "id")?;
        let title = string(required(&work, "book")?, "title")?;
        let tx = self.connection.transaction()?;
        let target = find_book(&tx, &book_id)?;
        let same_title_different_id: bool = tx
            .query_row(
                "SELECT 1 FROM books WHERE title=? AND id<>? LIMIT 1",
                params![title, book_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .is_some();
        let copy_title = next_copy_title(&tx, &title)?;
        let target_details = match target.as_ref() {
            Some(book) => Some(json!({
                "bookId": book["id"],
                "title": book["title"],
                "databaseVersion": book["databaseVersion"],
                "updatedAt": book["updatedAt"],
                "stats": stats_for_db(&tx, &book_id)?,
            })),
            None => None,
        };
        let result = json!({
            "status": if target.is_some() { "conflict" } else { "ready" },
            "bookId": book_id,
            "title": title,
            "importVersion": required(&work, "book")?["databaseVersion"],
            "importUpdatedAt": required(&work, "book")?["updatedAt"],
            "importStats": import_stats(&counts),
            "target": target_details,
            "nameConflict": same_title_different_id,
            "copyTitle": copy_title,
        });
        tx.commit()?;
        Ok(result)
    }

    #[cfg(test)]
    pub fn import_work(&mut self, input: ImportWork) -> Result<Value> {
        self.import_work_with_cancel(input, || false)
    }

    pub fn import_work_with_cancel<F>(
        &mut self,
        input: ImportWork,
        is_cancelled: F,
    ) -> Result<Value>
    where
        F: Fn() -> bool,
    {
        if is_cancelled() {
            return Err(StorageError::new(
                "CANCELLED",
                "Import cancelled; no changes were made",
            ));
        }
        let counts = validate_work(&input.work)?;
        if is_cancelled() {
            return Err(StorageError::new(
                "CANCELLED",
                "Import cancelled; no changes were made",
            ));
        }
        let source_book_id = uuid_field(required(&input.work, "book")?, "id")?;
        let source_title = string(required(&input.work, "book")?, "title")?;
        let (work, backup_file_name, mode) = match input.mode {
            ImportMode::Import => {
                if find_book(&self.connection, &source_book_id)?.is_some() {
                    return Err(StorageError::new(
                        "IMPORT_CONFLICT",
                        "The target work already exists; choose replace or create copy",
                    ));
                }
                (input.work, None, ImportMode::Import)
            }
            ImportMode::Replace => {
                let target = find_book(&self.connection, &source_book_id)?.ok_or_else(|| {
                    StorageError::new("IMPORT_CONFLICT", "The target work no longer exists")
                })?;
                let target_version = target["databaseVersion"]
                    .as_i64()
                    .ok_or_else(|| import_invalid("The target database version is invalid"))?;
                if input.expected_target_database_version != Some(target_version) {
                    return Err(StorageError {
                        code: "VERSION_CONFLICT".into(),
                        message: "The target work changed; reload the import decision before replacing it".into(),
                        current_database_version: Some(target_version),
                    });
                }
                if target["isReadOnly"] == true {
                    return Err(StorageError::new("READ_ONLY", "The target work is locked"));
                }
                let backup = backup_database(&self.connection, &self.directory).map_err(|_| {
                    StorageError::new(
                        "BACKUP_FAILED",
                        "A verified recovery backup could not be created; no changes were made",
                    )
                })?;
                (input.work, Some(backup), ImportMode::Replace)
            }
            ImportMode::Copy => {
                let title = next_copy_title(&self.connection, &source_title)?;
                let map = build_id_map(&input.work)?;
                (
                    copy_work(&input.work, &map, &title)?,
                    None,
                    ImportMode::Copy,
                )
            }
        };
        if is_cancelled() {
            return Err(StorageError::new(
                "CANCELLED",
                "Import cancelled; no changes were made",
            ));
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if matches!(mode, ImportMode::Replace) {
            let current = find_book(&tx, &source_book_id)?.ok_or_else(|| {
                StorageError::new("IMPORT_CONFLICT", "The target work no longer exists")
            })?;
            if input.expected_target_database_version != current["databaseVersion"].as_i64() {
                return Err(StorageError {
                    code: "VERSION_CONFLICT".into(),
                    message:
                        "The target work changed while the recovery boundary was being prepared"
                            .into(),
                    current_database_version: current["databaseVersion"].as_i64(),
                });
            }
            if current["isReadOnly"] == true {
                return Err(StorageError::new("READ_ONLY", "The target work is locked"));
            }
            if is_cancelled() {
                return Err(StorageError::new(
                    "CANCELLED",
                    "Import cancelled; no changes were made",
                ));
            }
            tx.execute("DELETE FROM books WHERE id=?", [source_book_id.as_str()])?;
        }
        let imported_book_id = insert_work(&tx, &work, matches!(mode, ImportMode::Copy))?;
        if is_cancelled() {
            return Err(StorageError::new(
                "CANCELLED",
                "Import cancelled; no changes were made",
            ));
        }
        let imported_book = record(&tx, "books", &imported_book_id)?;
        super::retrieval_sources::sync_sources_in_transaction(&tx, &imported_book_id)?;
        tx.commit()?;
        Ok(json!({
            "mode": match mode { ImportMode::Import => "import", ImportMode::Replace => "replace", ImportMode::Copy => "copy" },
            "bookId": imported_book_id,
            "book": imported_book,
            "stats": import_stats(&counts),
            "backupFileName": backup_file_name,
            "derivedIndexStatus": "pending",
        }))
    }
}
