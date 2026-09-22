use super::validation::{now, valid_id};
use super::{Database, IndexWork, Result, StorageError};
use crate::rag::{chunking::CHUNK_INDEX_VERSION, embeddings::current_fingerprint};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

pub const DEBOUNCE_MS: i64 = 60_000;
pub const MAX_WAIT_MS: i64 = 300_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveIndexPreferences {
    pub enabled: bool,
    pub expected_database_version: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IndexScheduleScope {
    pub book_id: Option<String>,
}

// This outbox is written inside the author's save transaction. Rollback also
// rolls back scheduling. Repeated status reads do not reset the deadline.
pub(super) fn mark_dirty(db: &Connection, book: &str, source: &str, version: i64) -> Result<()> {
    let time = now()?;
    db.execute("INSERT INTO retrieval_dirty_sources VALUES(?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET source_version=excluded.source_version,last_changed=excluded.last_changed",
        params![source, book, version, time, time])?;
    Ok(())
}

impl Database {
    pub fn index_schedule_status(&mut self, book: Option<&str>) -> Result<Value> {
        if let Some(book) = book {
            valid_id(book)?;
            super::records::record(&self.connection, "books", book)?;
        }
        let (enabled, version): (bool, i64) = self.connection.query_row(
            "SELECT auto_index,database_version FROM retrieval_preferences WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let pending: i64 = self.connection.query_row(
            "SELECT count(*) FROM retrieval_dirty_sources WHERE (?1 IS NULL OR book_id=?1)",
            [book],
            |r| r.get(0),
        )?;
        let updated: Option<i64> = self.connection.query_row("SELECT max(updated_at) FROM retrieval_index_jobs WHERE state='completed' AND (?1 IS NULL OR book_id=?1)", [book], |r| r.get(0))?;
        let error: Option<String> = self.connection.query_row("SELECT last_error FROM retrieval_index_jobs WHERE state='failed' AND (?1 IS NULL OR book_id=?1) ORDER BY updated_at DESC LIMIT 1", [book], |r| r.get(0)).optional()?.flatten();
        Ok(
            json!({"enabled":enabled,"databaseVersion":version,"pendingSources":pending,"lastCompletedAt":updated,"lastError":error}),
        )
    }

    pub fn save_index_preferences(&mut self, input: SaveIndexPreferences) -> Result<Value> {
        let tx = self.connection.transaction()?;
        if tx.execute("UPDATE retrieval_preferences SET auto_index=?,database_version=database_version+1 WHERE id=1 AND database_version=?", params![input.enabled, input.expected_database_version])? != 1 {
            return Err(StorageError::new("VERSION_CONFLICT", "Index preferences changed; reload settings"));
        }
        // Retain dirty entries when disabled. Paused automatic work can resume
        // explicitly on enable, but failed/cancelled work is never auto-retried.
        if !input.enabled {
            tx.execute("UPDATE retrieval_sources SET index_status='stale' WHERE EXISTS (SELECT 1 FROM retrieval_index_jobs j WHERE j.source_id=retrieval_sources.source_id AND j.source_version=retrieval_sources.source_version AND j.automatic=1 AND j.state IN ('queued','indexing'))", [])?;
            tx.execute("UPDATE retrieval_index_jobs SET state='paused',last_error='Automatic indexing disabled' WHERE automatic=1 AND state IN ('queued','indexing')", [])?;
        } else {
            let time = now()?;
            tx.execute("INSERT OR IGNORE INTO retrieval_dirty_sources SELECT source_id,book_id,source_version,?1,?1 FROM retrieval_sources WHERE source_status='active' AND trim(source_text)<>'' AND (index_status<>'ready' OR coalesce(embedding_fingerprint,'')<>?2)", params![time,current_fingerprint()])?;
            tx.execute("UPDATE retrieval_index_jobs SET state='queued',last_error=NULL WHERE automatic=1 AND state='paused' AND last_error='Automatic indexing disabled'", [])?;
        }
        tx.commit()?;
        self.index_schedule_status(None)
    }

    pub(crate) fn automatic_work_available(&mut self) -> Result<bool> {
        let time = now()?;
        Ok(self.connection.query_row("SELECT auto_index=1 AND (EXISTS(SELECT 1 FROM retrieval_dirty_sources WHERE last_changed<=?1 OR first_changed<=?2) OR EXISTS(SELECT 1 FROM retrieval_index_jobs WHERE state='queued')) FROM retrieval_preferences WHERE id=1", params![time-DEBOUNCE_MS,time-MAX_WAIT_MS], |r| r.get(0))?)
    }

    pub(crate) fn queue_due_sources(&mut self, time: i64) -> Result<Vec<String>> {
        let tx = self.connection.transaction()?;
        let enabled: bool = tx.query_row(
            "SELECT auto_index FROM retrieval_preferences WHERE id=1",
            [],
            |r| r.get(0),
        )?;
        if !enabled {
            return Ok(Vec::new());
        }
        let fingerprint = current_fingerprint();
        // No full-book synchronization here: saves already persisted sources,
        // chunks and FTS. Only due outbox entries are considered.
        tx.execute("INSERT INTO retrieval_index_jobs(job_id,book_id,source_id,source_version,index_version,embedding_fingerprint,state,attempts,created_at,updated_at,automatic)
            SELECT lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-8'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))),d.book_id,d.source_id,d.source_version,?1,?2,'queued',0,?3,?3,1
            FROM retrieval_dirty_sources d JOIN retrieval_sources s ON s.source_id=d.source_id JOIN books b ON b.id=d.book_id
            WHERE (d.last_changed<=?4 OR d.first_changed<=?5) AND s.source_status='active' AND b.is_read_only=0
            AND NOT EXISTS(SELECT 1 FROM chapters c JOIN volumes v ON v.id=c.volume_id WHERE c.id=json_extract(s.visibility_scope_json,'$.chapterId') AND (c.is_read_only=1 OR v.is_read_only=1))
            AND s.source_version=d.source_version AND trim(s.source_text)<>''
            AND NOT(s.index_status='ready' AND coalesce(s.index_version,0)=?1 AND coalesce(s.embedding_fingerprint,'')=?2)
            AND NOT EXISTS(SELECT 1 FROM retrieval_index_jobs j WHERE j.source_id=s.source_id AND j.source_version=s.source_version AND j.index_version=?1 AND j.embedding_fingerprint=?2)",
            params![CHUNK_INDEX_VERSION,fingerprint,time,time-DEBOUNCE_MS,time-MAX_WAIT_MS])?;
        tx.execute("UPDATE retrieval_sources SET index_status='queued',index_version=?1,embedding_fingerprint=NULL WHERE EXISTS(SELECT 1 FROM retrieval_index_jobs j WHERE j.source_id=retrieval_sources.source_id AND j.source_version=retrieval_sources.source_version AND j.state='queued')", [CHUNK_INDEX_VERSION])?;
        tx.execute("DELETE FROM retrieval_dirty_sources WHERE (last_changed<=?1 OR first_changed<=?2) AND EXISTS(SELECT 1 FROM retrieval_sources s WHERE s.source_id=retrieval_dirty_sources.source_id AND (s.source_status<>'active' OR s.index_status IN ('ready','queued','indexing','failed')))", params![time-DEBOUNCE_MS,time-MAX_WAIT_MS])?;
        let books = tx
            .prepare("SELECT DISTINCT book_id FROM retrieval_index_jobs WHERE state='queued'")?
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        tx.commit()?;
        Ok(books)
    }

    pub(crate) fn index_work_current(&mut self, work: &IndexWork) -> Result<bool> {
        Ok(work.embedding_fingerprint == current_fingerprint() && self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM retrieval_index_jobs j JOIN retrieval_sources s ON s.source_id=j.source_id WHERE j.job_id=?1 AND j.state='indexing' AND s.book_id=?2 AND s.source_version=?3 AND s.index_version=?4 AND (j.automatic=0 OR (SELECT auto_index FROM retrieval_preferences WHERE id=1)=1))",
            params![work.job_id,work.book_id,work.source_version,work.index_version], |r| r.get(0))?)
    }
}
