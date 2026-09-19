use super::Database;
use super::{backup::backup_database, Result, StorageError};
use rusqlite::{Connection, TransactionBehavior};
use std::{path::Path, time::Duration};

const MIGRATION_0001: &str = include_str!("../../migrations/0001_library.sql");
const MIGRATION_0002: &str = include_str!("../../migrations/0002_local_content.sql");
const MIGRATION_0003: &str = include_str!("../../migrations/0003_book_cover.sql");
const MIGRATION_0004: &str = include_str!("../../migrations/0004_ai_model_configs.sql");
const MIGRATION_0005: &str = include_str!("../../migrations/0005_ai_credentials.sql");
const MIGRATION_0006: &str = include_str!("../../migrations/0006_content_state.sql");
const LATEST_VERSION: i64 = 6;

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
                tx.execute_batch(MIGRATION_0003)?;
                tx.pragma_update(None, "user_version", 3)?;
            }
            1 => {
                tx.execute_batch(MIGRATION_0002)?;
                tx.pragma_update(None, "user_version", 2)?;
                tx.execute_batch(MIGRATION_0003)?;
                tx.pragma_update(None, "user_version", 3)?;
            }
            2 => {
                tx.execute_batch(MIGRATION_0003)?;
                tx.pragma_update(None, "user_version", 3)?;
            }
            3 => {}
            4 => {}
            5 => {}
            v if v == LATEST_VERSION => {}
            _ => {
                return Err(StorageError::new(
                    "STORAGE_FAILURE",
                    "Unsupported database version; use a compatible application",
                ))
            }
        }
        if version < 4 {
            tx.execute_batch(MIGRATION_0004)?;
            tx.pragma_update(None, "user_version", 4)?;
        }
        if version < 5 {
            tx.execute_batch(MIGRATION_0005)?;
            tx.pragma_update(None, "user_version", 5)?;
        }
        if version < 6 {
            tx.execute_batch(MIGRATION_0006)?;
            tx.pragma_update(None, "user_version", 6)?;
        }
        tx.prepare("SELECT credential_mode FROM ai_model_configs LIMIT 0")?;
        tx.prepare("SELECT credential_ref FROM ai_credential_cleanup LIMIT 0")?;
        tx.prepare("SELECT c.config_version,s.default_config_id FROM ai_model_configs c,ai_generation_settings s LIMIT 0")?;
        // Catch missing tables/columns even for an allegedly current database.
        tx.prepare("SELECT b.author,b.cover_color,v.book_id,c.content_version,c.content_state,c.foreshadowings_json FROM books b,volumes v,chapters c LIMIT 0")?;
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
        let mut database = Self {
            connection,
            directory: directory.to_owned(),
            credentials: Default::default(),
        };
        database.cleanup_credentials()?;
        Ok(database)
    }
}
