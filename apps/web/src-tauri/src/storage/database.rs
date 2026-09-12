use super::Database;
use super::{backup::backup_database, Result, StorageError};
use rusqlite::{Connection, TransactionBehavior};
use std::{path::Path, time::Duration};

const MIGRATION_0001: &str = include_str!("../../migrations/0001_library.sql");
const MIGRATION_0002: &str = include_str!("../../migrations/0002_local_content.sql");
const LATEST_VERSION: i64 = 2;

impl Database {
    pub fn open(directory: &Path) -> Result<Self> {
        std::fs::create_dir_all(directory)?;
        let mut connection = Connection::open(directory.join("storyark.sqlite3"))?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", true)?;
        let version: i64 = connection.pragma_query_value(None, "user_version", |r| r.get(0))?;
        // A consistent backup precedes every upgrade; if it fails, the
        // upgrade never starts and the old database stays untouched.
        if (1..LATEST_VERSION).contains(&version) {
            backup_database(&connection, directory)?;
        }
        let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        match version {
            0 => {
                let count: i64 = tx.query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", [], |r| r.get(0))?;
                if count != 0 {
                    return Err(StorageError::new(
                        "STORAGE_FAILURE",
                        "Unversioned database contains tables; refusing initialization",
                    ));
                }
                tx.execute_batch(MIGRATION_0001)?;
                tx.pragma_update(None, "user_version", 1)?;
                tx.execute_batch(MIGRATION_0002)?;
                tx.pragma_update(None, "user_version", 2)?;
            }
            1 => {
                tx.execute_batch(MIGRATION_0002)?;
                tx.pragma_update(None, "user_version", 2)?;
            }
            v if v == LATEST_VERSION => {}
            _ => {
                return Err(StorageError::new(
                    "STORAGE_FAILURE",
                    "Unsupported database version; use a compatible application",
                ))
            }
        }
        // Catch missing tables/columns even for an allegedly current database.
        tx.prepare("SELECT b.author,v.book_id,c.content_version,c.foreshadowings_json FROM books b,volumes v,chapters c LIMIT 0")?;
        tx.prepare("SELECT ch.aliases_json,g.book_id,gn.character_id,ge.label,p.story_summary,ap.dark_mode,bw.final_content FROM characters ch,graphs g,graph_nodes gn,graph_edges ge,planning p,application_preferences ap,brainstorm_workspaces bw LIMIT 0")?;
        let integrity: String = tx.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
        if integrity != "ok" || tx.prepare("PRAGMA foreign_key_check")?.exists([])? {
            return Err(StorageError::new(
                "STORAGE_FAILURE",
                "Database integrity check failed",
            ));
        }
        tx.commit()?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "FULL")?;
        Ok(Self {
            connection,
            directory: directory.to_owned(),
        })
    }
}
