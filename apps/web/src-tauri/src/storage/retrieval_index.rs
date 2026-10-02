use super::records::record;
use super::retrieval_sources::sync_sources_in_transaction;
use super::validation::{now, valid_id};
use super::{Database, Result, StorageError};
use crate::rag::chunking::CHUNK_INDEX_VERSION;
use crate::rag::contracts::{RetrievalIndexJob, RetrievalIndexJobState, RetrievalIndexStatus};
use crate::rag::embeddings::encode_vector;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueueRetrievalIndex {
    pub book_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListRetrievalIndexJobs {
    pub book_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetrievalIndexJobAction {
    pub job_id: String,
}

#[derive(Clone, Debug)]
pub(crate) struct IndexChunkWork {
    pub chunk_id: String,
    pub index_text: String,
}

#[derive(Clone, Debug)]
pub(crate) struct IndexWork {
    pub job_id: String,
    pub book_id: String,
    pub source_id: String,
    pub source_version: i64,
    pub index_version: i64,
    pub embedding_fingerprint: String,
    pub chunks: Vec<IndexChunkWork>,
}

impl IndexWork {
    pub(crate) fn validation_snapshot(&self) -> Self {
        Self {
            chunks: Vec::new(),
            job_id: self.job_id.clone(),
            book_id: self.book_id.clone(),
            source_id: self.source_id.clone(),
            source_version: self.source_version,
            index_version: self.index_version,
            embedding_fingerprint: self.embedding_fingerprint.clone(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum IndexCommitResult {
    Completed,
    Stale,
}

fn index_error(message: &str) -> StorageError {
    StorageError::new("RETRIEVAL_INDEX_FAILURE", message)
}

fn job_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RetrievalIndexJob> {
    let state: String = row.get(6)?;
    Ok(RetrievalIndexJob {
        job_id: row.get(0)?,
        book_id: row.get(1)?,
        source_id: row.get(2)?,
        source_version: row.get(3)?,
        index_version: row.get(4)?,
        embedding_fingerprint: row.get(5)?,
        state: RetrievalIndexJobState::parse(&state).ok_or_else(|| {
            rusqlite::Error::FromSqlConversionFailure(
                6,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "unknown retrieval index job state",
                )),
            )
        })?,
        attempts: row.get(7)?,
        last_error: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn read_jobs(db: &Connection, book_id: &str) -> Result<Vec<RetrievalIndexJob>> {
    let mut statement = db.prepare(
        "SELECT job_id,book_id,source_id,source_version,index_version,embedding_fingerprint,state,attempts,last_error,created_at,updated_at
         FROM retrieval_index_jobs WHERE book_id=? ORDER BY updated_at DESC,job_id",
    )?;
    let rows = statement.query_map([book_id], job_from_row)?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

fn queued_job(
    db: &Connection,
    source_id: &str,
    source_version: i64,
    fingerprint: &str,
) -> Result<Option<(String, String)>> {
    db.query_row(
        "SELECT job_id,state FROM retrieval_index_jobs
         WHERE source_id=? AND source_version=? AND index_version=? AND embedding_fingerprint=?",
        params![source_id, source_version, CHUNK_INDEX_VERSION, fingerprint],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .map_err(Into::into)
}

impl Database {
    pub(crate) fn recover_retrieval_index_jobs(&mut self) -> Result<()> {
        let time = now()?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute(
            "UPDATE retrieval_index_jobs SET state='queued',updated_at=? WHERE state='indexing'",
            [time],
        )?;
        tx.execute(
            "UPDATE retrieval_sources SET index_status='queued'
             WHERE index_status='indexing' AND EXISTS
             (SELECT 1 FROM retrieval_index_jobs j
              WHERE j.state='queued' AND j.source_id=retrieval_sources.source_id
                AND j.source_version=retrieval_sources.source_version)",
            [],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn queue_retrieval_index(
        &mut self,
        input: QueueRetrievalIndex,
        embedding_fingerprint: &str,
    ) -> Result<Value> {
        valid_id(&input.book_id)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        record(&tx, "books", &input.book_id)?;
        sync_sources_in_transaction(&tx, &input.book_id)?;
        let time = now()?;
        let mut source_statement = tx.prepare(
            "SELECT source_id,source_version,source_status,index_status,index_version,embedding_fingerprint
             FROM retrieval_sources WHERE book_id=? ORDER BY source_id",
        )?;
        let sources = source_statement
            .query_map([input.book_id.as_str()], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        drop(source_statement);
        let mut queued = Vec::new();
        for (source_id, source_version, source_status, index_status, index_version, fingerprint) in
            sources
        {
            if source_status != "active"
                || (index_status == RetrievalIndexStatus::Ready.as_str()
                    && index_version == Some(CHUNK_INDEX_VERSION)
                    && fingerprint.as_deref() == Some(embedding_fingerprint))
            {
                continue;
            }
            let job_id = match queued_job(&tx, &source_id, source_version, embedding_fingerprint)? {
                Some((job_id, state)) if state == "queued" || state == "indexing" => job_id,
                Some((job_id, _)) => {
                    tx.execute(
                        "UPDATE retrieval_index_jobs SET state='queued',last_error=NULL,updated_at=? WHERE job_id=?",
                        params![time, job_id],
                    )?;
                    job_id
                }
                None => {
                    let job_id = Uuid::new_v4().to_string();
                    tx.execute(
                        "INSERT INTO retrieval_index_jobs(job_id,book_id,source_id,source_version,index_version,embedding_fingerprint,state,attempts,last_error,created_at,updated_at)
                         VALUES (?,?,?,?,?,?,'queued',0,NULL,?,?)",
                        params![
                            job_id,
                            input.book_id,
                            source_id,
                            source_version,
                            CHUNK_INDEX_VERSION,
                            embedding_fingerprint,
                            time,
                            time,
                        ],
                    )?;
                    job_id
                }
            };
            tx.execute(
                "UPDATE retrieval_sources SET index_status='queued',index_version=?,embedding_fingerprint=NULL WHERE source_id=?",
                params![CHUNK_INDEX_VERSION, source_id],
            )?;
            queued.push(job_id);
            tx.execute(
                "UPDATE retrieval_index_jobs SET automatic=0 WHERE job_id=?",
                [queued.last().unwrap()],
            )?;
        }
        let jobs = read_jobs(&tx, &input.book_id)?
            .into_iter()
            .filter(|job| queued.iter().any(|id| id == &job.job_id))
            .collect::<Vec<_>>();
        tx.commit()?;
        Ok(json!(jobs))
    }

    pub fn list_retrieval_index_jobs(&mut self, input: ListRetrievalIndexJobs) -> Result<Value> {
        valid_id(&input.book_id)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        record(&tx, "books", &input.book_id)?;
        let jobs = read_jobs(&tx, &input.book_id)?;
        tx.commit()?;
        Ok(json!(jobs))
    }

    pub(crate) fn claim_next_retrieval_index_job(
        &mut self,
        book_id: &str,
    ) -> Result<Option<IndexWork>> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute("UPDATE retrieval_index_jobs SET state='cancelled',last_error='Source superseded before indexing' WHERE book_id=? AND state='queued' AND NOT EXISTS(SELECT 1 FROM retrieval_sources s WHERE s.source_id=retrieval_index_jobs.source_id AND s.source_version=retrieval_index_jobs.source_version AND s.index_version=retrieval_index_jobs.index_version)", [book_id])?;
        let job = tx
            .query_row(
                "SELECT job_id,book_id,source_id,source_version,index_version,embedding_fingerprint
                 FROM retrieval_index_jobs j WHERE book_id=? AND state='queued'
                 AND (automatic=0 OR (SELECT auto_index FROM retrieval_preferences WHERE id=1)=1)
                 AND EXISTS(SELECT 1 FROM retrieval_sources s WHERE s.source_id=j.source_id AND s.source_version=j.source_version AND s.index_version=j.index_version)
                 ORDER BY updated_at,job_id LIMIT 1",
                [book_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, String>(5)?,
                    ))
                },
            )
            .optional()?;
        let Some((job_id, book_id, source_id, source_version, index_version, fingerprint)) = job
        else {
            tx.commit()?;
            return Ok(None);
        };
        let time = now()?;
        tx.execute(
            "UPDATE retrieval_index_jobs SET state='indexing',attempts=attempts+1,updated_at=? WHERE job_id=? AND state='queued'",
            params![time, job_id],
        )?;
        tx.execute(
            "UPDATE retrieval_sources SET index_status='indexing' WHERE source_id=? AND source_version=?",
            params![source_id, source_version],
        )?;
        let mut chunks_statement = tx.prepare(
            "SELECT chunk_id,index_text FROM retrieval_chunks
             WHERE source_id=? AND source_version=? AND index_version=? ORDER BY ordinal,chunk_id",
        )?;
        let chunks = chunks_statement
            .query_map(params![source_id, source_version, index_version], |row| {
                Ok(IndexChunkWork {
                    chunk_id: row.get(0)?,
                    index_text: row.get(1)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        drop(chunks_statement);
        tx.commit()?;
        Ok(Some(IndexWork {
            job_id,
            book_id,
            source_id,
            source_version,
            index_version,
            embedding_fingerprint: fingerprint,
            chunks,
        }))
    }

    pub(crate) fn commit_retrieval_index_job(
        &mut self,
        work: &IndexWork,
        embeddings: &[Vec<f32>],
    ) -> Result<IndexCommitResult> {
        if embeddings.len() != work.chunks.len() {
            return Err(index_error("Embedding result count does not match chunks"));
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = tx
            .query_row(
                "SELECT j.state,s.book_id,s.source_version,s.index_version,s.embedding_fingerprint
                 FROM retrieval_index_jobs j JOIN retrieval_sources s
                   ON s.source_id=j.source_id AND s.book_id=j.book_id
                 WHERE j.job_id=? AND j.source_id=?",
                params![work.job_id, work.source_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                },
            )
            .optional()?;
        let Some((state, book_id, source_version, index_version, fingerprint)) = current else {
            tx.commit()?;
            return Ok(IndexCommitResult::Stale);
        };
        let superseded = tx.query_row(
            "SELECT EXISTS(
                SELECT 1 FROM retrieval_index_jobs
                WHERE source_id=? AND source_version=? AND state='queued'
                  AND embedding_fingerprint<>? AND job_id<>?
            )",
            params![
                work.source_id,
                work.source_version,
                work.embedding_fingerprint,
                work.job_id
            ],
            |row| row.get::<_, i64>(0),
        )? != 0;
        if state != "indexing"
            || book_id != work.book_id
            || source_version != work.source_version
            || index_version != Some(work.index_version)
            || superseded
            || fingerprint
                .as_deref()
                .is_some_and(|value| value != work.embedding_fingerprint)
        {
            let time = now()?;
            tx.execute(
                "UPDATE retrieval_index_jobs SET state='failed',last_error='Index result discarded because its source version changed',updated_at=? WHERE job_id=? AND state='indexing'",
                params![time, work.job_id],
            )?;
            tx.commit()?;
            return Ok(IndexCommitResult::Stale);
        }
        for (chunk, embedding) in work.chunks.iter().zip(embeddings) {
            let blob =
                encode_vector(embedding).map_err(|_| index_error("Invalid embedding vector"))?;
            let changed = tx.execute(
                "UPDATE retrieval_chunks SET embedding_blob=? WHERE chunk_id=? AND book_id=? AND source_version=? AND index_version=?",
                params![blob, chunk.chunk_id, work.book_id, work.source_version, work.index_version],
            )?;
            if changed != 1 {
                return Ok(IndexCommitResult::Stale);
            }
        }
        let time = now()?;
        tx.execute(
            "UPDATE retrieval_sources SET index_status='ready',index_version=?,embedding_fingerprint=? WHERE source_id=? AND book_id=? AND source_version=?",
            params![work.index_version, work.embedding_fingerprint, work.source_id, work.book_id, work.source_version],
        )?;
        tx.execute(
            "DELETE FROM retrieval_dirty_sources WHERE source_id=? AND source_version=?",
            params![work.source_id, work.source_version],
        )?;
        tx.execute(
            "UPDATE retrieval_index_jobs SET state='completed',last_error=NULL,updated_at=? WHERE job_id=? AND state='indexing'",
            params![time, work.job_id],
        )?;
        tx.commit()?;
        Ok(IndexCommitResult::Completed)
    }

    pub(crate) fn fail_retrieval_index_job(&mut self, job_id: &str, message: &str) -> Result<()> {
        let time = now()?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute(
            "UPDATE retrieval_index_jobs SET state='failed',last_error=?,updated_at=? WHERE job_id=? AND state='indexing'",
            params![message, time, job_id],
        )?;
        tx.execute(
            "UPDATE retrieval_sources SET index_status='failed'
             WHERE source_id=(SELECT source_id FROM retrieval_index_jobs WHERE job_id=?)
               AND source_version=(SELECT source_version FROM retrieval_index_jobs WHERE job_id=?)
               AND index_status='indexing'",
            params![job_id, job_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn pause_retrieval_index_job(&mut self, input: RetrievalIndexJobAction) -> Result<Value> {
        self.update_retrieval_index_job(&input.job_id, "paused", "Indexing paused")
    }

    pub fn cancel_retrieval_index_job(&mut self, input: RetrievalIndexJobAction) -> Result<Value> {
        self.update_retrieval_index_job(&input.job_id, "cancelled", "Indexing cancelled")
    }

    pub fn retry_retrieval_index_job(&mut self, input: RetrievalIndexJobAction) -> Result<Value> {
        self.update_retrieval_index_job(&input.job_id, "queued", "")
    }

    fn update_retrieval_index_job(
        &mut self,
        job_id: &str,
        state: &str,
        message: &str,
    ) -> Result<Value> {
        valid_id(job_id)?;
        let time = now()?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current: Option<(String, String)> = tx
            .query_row(
                "SELECT state,source_id FROM retrieval_index_jobs WHERE job_id=?",
                [job_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let Some((old_state, source_id)) = current else {
            return Err(StorageError::new(
                "NOT_FOUND",
                "Retrieval index job not found",
            ));
        };
        let allowed = match state {
            "paused" => old_state == "queued" || old_state == "indexing",
            "cancelled" => {
                old_state == "queued" || old_state == "paused" || old_state == "indexing"
            }
            "queued" => old_state == "failed" || old_state == "cancelled" || old_state == "paused",
            _ => false,
        };
        if !allowed {
            return Err(StorageError::new(
                "INVALID_STATE",
                "Retrieval index job cannot take this action",
            ));
        }
        tx.execute(
            "UPDATE retrieval_index_jobs SET state=?,last_error=?,updated_at=? WHERE job_id=?",
            params![
                state,
                (!message.is_empty()).then_some(message),
                time,
                job_id
            ],
        )?;
        let source_status = if state == "queued" { "queued" } else { "stale" };
        if state == "queued" {
            tx.execute(
                "UPDATE retrieval_index_jobs SET automatic=0 WHERE job_id=?",
                [job_id],
            )?;
        }
        tx.execute(
            "UPDATE retrieval_sources SET index_status=? WHERE source_id=?
             AND source_version=(SELECT source_version FROM retrieval_index_jobs WHERE job_id=?)",
            params![source_status, source_id, job_id],
        )?;
        let job = tx
            .query_row(
                "SELECT job_id,book_id,source_id,source_version,index_version,embedding_fingerprint,state,attempts,last_error,created_at,updated_at FROM retrieval_index_jobs WHERE job_id=?",
                [job_id],
                job_from_row,
            )?;
        tx.commit()?;
        Ok(json!(job))
    }
}
