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
const MIGRATION_0007: &str = include_str!("../../migrations/0007_retrieval_sources.sql");
const MIGRATION_0008: &str = include_str!("../../migrations/0008_retrieval_chunks.sql");
const MIGRATION_0009: &str = include_str!("../../migrations/0009_retrieval_indexing.sql");
const MIGRATION_0010: &str = include_str!("../../migrations/0010_retrieval_audit.sql");
const MIGRATION_0011: &str = include_str!("../../migrations/0011_retrieval_search_task.sql");
const MIGRATION_0012: &str = include_str!("../../migrations/0012_retrieval_scheduler.sql");
const LATEST_VERSION: i64 = 12;
const RETRIEVAL_SEARCH_TASK_REPAIR: &str =
    "ALTER TABLE retrieval_search_events ADD COLUMN task TEXT NOT NULL DEFAULT 'generic' CHECK(length(trim(task)) BETWEEN 1 AND 64);";

fn retrieval_search_events_has_task(transaction: &rusqlite::Transaction<'_>) -> Result<bool> {
    let mut statement = transaction.prepare("PRAGMA table_info(retrieval_search_events)")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        if row.get::<_, String>(1)? == "task" {
            return Ok(true);
        }
    }
    Ok(false)
}

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
            6 => {}
            7 => {}
            8 => {}
            9 => {}
            10 => {}
            11 => {}
            12 => {}
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
        if version < 7 {
            tx.execute_batch(MIGRATION_0007)?;
            tx.pragma_update(None, "user_version", 7)?;
        }
        if version < 8 {
            tx.execute_batch(MIGRATION_0008)?;
            tx.pragma_update(None, "user_version", 8)?;
        }
        if version < 9 {
            tx.execute_batch(MIGRATION_0009)?;
            tx.pragma_update(None, "user_version", 9)?;
        }
        if version < 10 {
            tx.execute_batch(MIGRATION_0010)?;
            tx.pragma_update(None, "user_version", 10)?;
        }
        if version < 11 {
            tx.execute_batch(MIGRATION_0011)?;
            if !retrieval_search_events_has_task(&tx)? {
                tx.execute_batch(RETRIEVAL_SEARCH_TASK_REPAIR)?;
            }
            tx.pragma_update(None, "user_version", 11)?;
        }
        if version < 12 {
            tx.execute_batch(MIGRATION_0012)?;
            tx.pragma_update(None, "user_version", 12)?;
        }
        tx.prepare("SELECT auto_index,database_version FROM retrieval_preferences LIMIT 0")?;
        tx.execute(
            "INSERT OR IGNORE INTO retrieval_preferences(id) VALUES(1)",
            [],
        )?;
        tx.prepare("SELECT credential_mode FROM ai_model_configs LIMIT 0")?;
        tx.prepare("SELECT credential_ref FROM ai_credential_cleanup LIMIT 0")?;
        tx.prepare("SELECT c.config_version,s.default_config_id FROM ai_model_configs c,ai_generation_settings s LIMIT 0")?;
        // Catch missing tables/columns even for an allegedly current database.
        tx.prepare("SELECT b.author,b.cover_color,v.book_id,c.content_version,c.content_state,c.foreshadowings_json FROM books b,volumes v,chapters c LIMIT 0")?;
        tx.prepare("SELECT ch.aliases_json,g.book_id,gn.character_id,ge.label,p.story_summary,ap.dark_mode,bw.final_content FROM characters ch,graphs g,graph_nodes gn,graph_edges ge,planning p,application_preferences ap,brainstorm_workspaces bw LIMIT 0")?;
        tx.prepare("SELECT rs.book_id,rs.source_kind,rs.source_version,rs.visibility_scope_json,rs.index_status FROM retrieval_sources rs LIMIT 0")?;
        tx.prepare("SELECT rc.book_id,rc.source_id,rc.source_version,rc.index_version,rc.locator_json,rc.embedding_blob FROM retrieval_chunks rc LIMIT 0")?;
        tx.prepare("SELECT f.chunk_id,f.book_id,f.source_id,f.source_version,f.index_version FROM retrieval_chunks_fts f LIMIT 0")?;
        tx.prepare("SELECT j.job_id,j.book_id,j.source_id,j.source_version,j.index_version,j.embedding_fingerprint,j.state FROM retrieval_index_jobs j LIMIT 0")?;
        tx.prepare("SELECT r.event_id,r.book_id,r.retrieval_version,r.task,r.status,r.source_versions_json FROM retrieval_search_events r LIMIT 0")?;
        tx.prepare("SELECT g.event_id,g.request_id,g.book_id,g.prompt_version,g.retrieval_version,g.config_id,g.model_id,g.source_versions_json FROM ai_generation_events g LIMIT 0")?;
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
        database.recover_retrieval_index_jobs()?;
        database.cleanup_credentials()?;
        Ok(database)
    }
}
