use super::records::record;
use super::validation::{invalid, ownership, valid_id};
use super::{Database, Result, StorageError};
use crate::ai::generation::GenerationTarget;
use rusqlite::{Connection, OptionalExtension};
use std::collections::HashSet;

fn changed() -> StorageError {
    StorageError::new(
        "CONTEXT_CHANGED",
        "Generation sources changed; reload before retrying",
    )
}

fn aggregate_version(db: &Connection, table: &str, book_id: &str) -> Result<i64> {
    let sql = match table {
        "brainstorm_workspaces" => {
            "SELECT database_version FROM brainstorm_workspaces WHERE book_id=?"
        }
        "planning" => "SELECT database_version FROM planning WHERE book_id=?",
        "graphs" => "SELECT database_version FROM graphs WHERE book_id=?",
        _ => return Err(invalid()),
    };
    Ok(db
        .query_row(sql, [book_id], |row| row.get(0))
        .optional()?
        .unwrap_or(0))
}

fn match_version(actual: i64, expected: u64) -> Result<()> {
    if actual >= 0 && u64::try_from(actual).ok() == Some(expected) {
        Ok(())
    } else {
        Err(changed())
    }
}

impl Database {
    pub fn validate_ai_generation_target(
        &self,
        book_id: &str,
        target: &GenerationTarget,
    ) -> Result<()> {
        valid_id(book_id)?;
        record(&self.connection, "books", book_id)?;
        match target {
            GenerationTarget::Continue {
                chapter_id,
                database_version,
            } => {
                valid_id(chapter_id)?;
                let chapter = record(&self.connection, "chapters", chapter_id)?;
                ownership(&chapter, "bookId", book_id)?;
                if chapter["databaseVersion"].as_i64() != i64::try_from(*database_version).ok() {
                    return Err(changed());
                }
            }
            GenerationTarget::Brainstorm {
                workspace_database_version,
                planning_database_version,
                graph_database_version,
                sources,
            } => {
                if sources.is_empty() {
                    return Err(invalid());
                }
                match_version(
                    aggregate_version(&self.connection, "brainstorm_workspaces", book_id)?,
                    *workspace_database_version,
                )?;
                match_version(
                    aggregate_version(&self.connection, "planning", book_id)?,
                    *planning_database_version,
                )?;
                match_version(
                    aggregate_version(&self.connection, "graphs", book_id)?,
                    *graph_database_version,
                )?;
                let mut chapter_ids = HashSet::new();
                for source in sources {
                    valid_id(&source.chapter_id)?;
                    if !chapter_ids.insert(&source.chapter_id) || source.database_version == 0 {
                        return Err(invalid());
                    }
                    let chapter = record(&self.connection, "chapters", &source.chapter_id)?;
                    ownership(&chapter, "bookId", book_id)?;
                    if chapter["databaseVersion"].as_i64()
                        != i64::try_from(source.database_version).ok()
                    {
                        return Err(changed());
                    }
                }
            }
        }
        Ok(())
    }
}
