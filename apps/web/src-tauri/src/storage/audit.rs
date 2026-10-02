use super::records::record;
use super::validation::{invalid, now, ownership, valid_id};
use super::{Database, Result, StorageError};
use crate::ai::generation::{GenerateRequest, GenerationTarget, SourceVersion};
use rusqlite::{params, TransactionBehavior};
use uuid::Uuid;

pub const PROMPT_VERSION: &str = "ai-tasks-v2";

fn target_source_versions(target: &GenerationTarget) -> Vec<SourceVersion> {
    match target {
        GenerationTarget::Continue {
            chapter_id,
            database_version,
        } => vec![SourceVersion {
            chapter_id: chapter_id.clone(),
            database_version: *database_version,
        }],
        GenerationTarget::ChapterSummary {
            chapter_id,
            database_version,
            ..
        } => vec![SourceVersion {
            chapter_id: chapter_id.clone(),
            database_version: *database_version,
        }],
        GenerationTarget::Brainstorm { sources, .. } => sources.clone(),
    }
}

fn source_versions_json(request: &GenerateRequest) -> Result<String> {
    let versions = request
        .retrieval_trace
        .as_ref()
        .map(|trace| trace.source_versions.clone())
        .filter(|versions| !versions.is_empty())
        .unwrap_or_else(|| target_source_versions(&request.target));
    serde_json::to_string(&versions).map_err(|_| {
        StorageError::new(
            "STORAGE_FAILURE",
            "Generation trace could not be serialized",
        )
    })
}

impl Database {
    pub(crate) fn record_ai_generation_start(
        &mut self,
        request: &GenerateRequest,
        model_id: &str,
    ) -> Result<()> {
        valid_id(&request.request_id)?;
        valid_id(&request.book_id)?;
        valid_id(&request.config.id)?;
        if request.session_id.trim().is_empty() || request.session_id.len() > 4096 {
            return Err(invalid());
        }
        if model_id.trim().is_empty() || model_id.len() > 256 {
            return Err(invalid());
        }
        if let Some(trace) = &request.retrieval_trace {
            if trace.retrieval_version.trim().is_empty()
                || trace.retrieval_version.len() > 128
                || trace.source_versions.is_empty()
            {
                return Err(invalid());
            }
            for source in &trace.source_versions {
                valid_id(&source.chapter_id)?;
                let chapter = record(&self.connection, "chapters", &source.chapter_id)?;
                ownership(&chapter, "bookId", &request.book_id)?;
                if chapter["databaseVersion"].as_i64()
                    != i64::try_from(source.database_version).ok()
                {
                    return Err(StorageError::new(
                        "CONTEXT_CHANGED",
                        "Generation retrieval sources changed; reload before retrying",
                    ));
                }
            }
        }
        let source_versions = source_versions_json(request)?;
        let retrieval_version = request
            .retrieval_trace
            .as_ref()
            .map(|trace| trace.retrieval_version.as_str());
        let time = now()?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute(
            "INSERT INTO ai_generation_events(event_id,request_id,book_id,session_id,prompt_version,retrieval_version,config_id,model_id,source_versions_json,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?)",
            params![
                Uuid::new_v4().to_string(),
                request.request_id.as_str(),
                request.book_id.as_str(),
                request.session_id.as_str(),
                PROMPT_VERSION,
                retrieval_version,
                request.config.id.as_str(),
                model_id,
                source_versions,
                time,
            ],
        )?;
        tx.commit()?;
        Ok(())
    }
}
