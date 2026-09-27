use super::retrieval_sources::{
    read_chunks, read_sources, resolve_scope, sync_sources_in_transaction,
};
use super::validation::{invalid, now, valid_id};
use super::{Database, Result, StorageError};
use crate::rag::chunking::{stable_text_hash, CHUNK_INDEX_VERSION};
use crate::rag::contracts::{
    RetrievalChunk, RetrievalFreshness, RetrievalIndexStatus, RetrievalRecallMethod,
    RetrievalScope, RetrievalSearchHit, RetrievalSearchMode, RetrievalSearchRequest,
    RetrievalSearchResponse, RetrievalSearchStatus, RetrievalSearchTrace, RetrievalSource,
    RetrievalSourceKind, RetrievalSourceStatus, RetrievalSourceVersionRecord,
    RetrievalTaskStrategy, RETRIEVAL_VERSION,
};
use crate::rag::embeddings::{decode_vector, dot};
use crate::rag::lexical::fts_query;
use crate::rag::search::{
    add_recall_method, assemble_context, rrf_score, ContextItem, DEFAULT_ADJACENT_CHUNKS,
    MAX_CONTEXT_CHAR_BUDGET, MAX_CONTEXT_TOKEN_BUDGET, MIN_SEMANTIC_SCORE,
};
use crate::rag::sources::normalize_index_text;
use rusqlite::{params, Connection, TransactionBehavior};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

const MAX_SEARCH_LIMIT: usize = 50;
const MAX_RECALL_LIMIT: usize = 200;

#[derive(Clone, Debug)]
struct RankedRecall {
    chunk_id: String,
    score: f32,
    rank: usize,
}

#[derive(Clone, Debug)]
struct Candidate {
    chunk: RetrievalChunk,
    source: RetrievalSource,
    lexical_rank: Option<usize>,
    semantic_rank: Option<usize>,
    lexical_score: Option<f32>,
    semantic_score: Option<f32>,
    score: f32,
    methods: Vec<RetrievalRecallMethod>,
}

fn search_error(message: &str) -> StorageError {
    StorageError::new("RETRIEVAL_SEARCH_FAILURE", message)
}

fn validate_task_scope(task: &RetrievalTaskStrategy, scope: &RetrievalScope) -> Result<()> {
    if *task != RetrievalTaskStrategy::ChapterSummary {
        return Ok(());
    }
    if scope.allowed_chapter_ids.len() != 1
        || scope.include_future_plan
        || scope.include_generated
        || scope.include_stale
        || scope.before_chapter_order.is_some()
        || scope.before_anchor.is_some()
        || scope.time_range.is_some()
        || scope.allowed_source_kinds.is_empty()
        || scope.allowed_source_kinds.iter().any(|kind| {
            !matches!(
                kind,
                RetrievalSourceKind::ConfirmedSetting | RetrievalSourceKind::Character
            )
        })
    {
        return Err(invalid());
    }
    valid_id(&scope.allowed_chapter_ids[0])?;
    Ok(())
}

fn hit_id(chunk_id: &str) -> String {
    format!("hit:{chunk_id}")
}

fn is_excluded(chunk_id: &str, excluded: &HashSet<String>) -> bool {
    excluded.contains(chunk_id) || excluded.contains(&hit_id(chunk_id))
}

fn source_freshness(source: &RetrievalSource) -> RetrievalFreshness {
    if source.source_kind == RetrievalSourceKind::FuturePlan {
        RetrievalFreshness::FuturePlan
    } else {
        match source.source_status {
            RetrievalSourceStatus::Active => RetrievalFreshness::Fresh,
            RetrievalSourceStatus::Stale => RetrievalFreshness::Stale,
            RetrievalSourceStatus::Pending | RetrievalSourceStatus::Discarded => {
                RetrievalFreshness::Pending
            }
        }
    }
}

fn chapter_id(source: &RetrievalSource) -> Option<String> {
    match &source.visibility_scope {
        crate::rag::contracts::RetrievalVisibilityScope::Chapter { chapter_id, .. } => {
            Some(chapter_id.clone())
        }
        _ => None,
    }
}

fn alias_recall(source: &RetrievalSource, chunk: &RetrievalChunk, query: &str) -> bool {
    let query = normalize_index_text(query);
    if query.is_empty() {
        return false;
    }
    let source_text = normalize_index_text(&chunk.source_text);
    let index_text = normalize_index_text(&chunk.index_text);
    let metadata_alias = source
        .entity_metadata
        .get("aliases")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(normalize_index_text)
        .any(|alias| !alias.is_empty() && (alias.contains(&query) || query.contains(&alias)));
    metadata_alias || (index_text.contains(&query) && !source_text.contains(&query))
}

fn candidate_score(
    mode: &RetrievalSearchMode,
    lexical_rank: Option<usize>,
    semantic_rank: Option<usize>,
    semantic_score: Option<f32>,
) -> f32 {
    match mode {
        RetrievalSearchMode::Lexical => lexical_rank
            .map(|rank| 1.0 / (1.0 + rank as f32))
            .unwrap_or(0.0),
        RetrievalSearchMode::Semantic => semantic_score.unwrap_or(0.0),
        RetrievalSearchMode::Hybrid => rrf_score(lexical_rank, semantic_rank),
    }
}

fn lexical_recall(
    db: &Connection,
    book_id: &str,
    query: &str,
    chunks: &HashMap<String, RetrievalChunk>,
    limit: usize,
) -> Result<Vec<RankedRecall>> {
    let Some(query) = fts_query(query) else {
        return Ok(Vec::new());
    };
    let mut statement = db.prepare(
        "SELECT f.chunk_id,bm25(retrieval_chunks_fts)
         FROM retrieval_chunks_fts f
         WHERE f.book_id=? AND retrieval_chunks_fts MATCH ?
         ORDER BY bm25(retrieval_chunks_fts),f.chunk_id",
    )?;
    let rows = statement.query_map(params![book_id, query], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
    })?;
    let mut recalls = Vec::with_capacity(limit);
    for row in rows {
        let (chunk_id, rank) = row?;
        if !chunks.contains_key(&chunk_id) {
            continue;
        }
        recalls.push(RankedRecall {
            chunk_id,
            score: 1.0 / (1.0 + (-rank).max(0.0) as f32),
            rank: recalls.len() + 1,
        });
        if recalls.len() >= limit {
            break;
        }
    }
    Ok(recalls)
}

fn semantic_recall(
    db: &Connection,
    book_id: &str,
    query: &[f32],
    chunks: &HashMap<String, RetrievalChunk>,
    fingerprint: &str,
    limit: usize,
) -> Result<Vec<RankedRecall>> {
    let mut statement = db.prepare(
        "SELECT c.chunk_id,c.embedding_blob
         FROM retrieval_chunks c JOIN retrieval_sources s ON s.source_id=c.source_id AND s.book_id=c.book_id
         WHERE c.book_id=? AND c.source_version=s.source_version AND c.index_version=?
           AND s.index_status='ready' AND s.embedding_fingerprint=? AND c.embedding_blob IS NOT NULL",
    )?;
    let rows = statement.query_map(params![book_id, CHUNK_INDEX_VERSION, fingerprint], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
    })?;
    let mut recalls = Vec::new();
    for row in rows {
        let (chunk_id, blob) = row?;
        if !chunks.contains_key(&chunk_id) {
            continue;
        }
        let vector =
            decode_vector(&blob).map_err(|_| search_error("Stored embedding vector is invalid"))?;
        recalls.push(RankedRecall {
            chunk_id,
            score: dot(query, &vector),
            rank: 0,
        });
    }
    recalls.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| left.chunk_id.cmp(&right.chunk_id))
    });
    recalls.retain(|recall| recall.score >= MIN_SEMANTIC_SCORE);
    recalls.truncate(limit);
    for (index, recall) in recalls.iter_mut().enumerate() {
        recall.rank = index + 1;
    }
    Ok(recalls)
}

fn semantic_index_ready(
    chunks: &HashMap<String, RetrievalChunk>,
    sources: &HashMap<String, RetrievalSource>,
    fingerprint: Option<&str>,
) -> bool {
    let Some(fingerprint) = fingerprint else {
        return false;
    };
    chunks.values().any(|chunk| {
        sources.get(&chunk.source_id).is_some_and(|source| {
            source.index_status == RetrievalIndexStatus::Ready
                && source.source_version == chunk.source_version
                && source.index_version == Some(CHUNK_INDEX_VERSION)
                && source.embedding_fingerprint.as_deref() == Some(fingerprint)
        })
    })
}

fn build_candidates(
    mode: &RetrievalSearchMode,
    query: &str,
    chunks: &HashMap<String, RetrievalChunk>,
    sources: &HashMap<String, RetrievalSource>,
    lexical: &[RankedRecall],
    semantic: &[RankedRecall],
) -> Vec<Candidate> {
    let mut candidates = HashMap::<String, Candidate>::new();
    for recall in lexical {
        let Some(chunk) = chunks.get(&recall.chunk_id) else {
            continue;
        };
        let Some(source) = sources.get(&chunk.source_id) else {
            continue;
        };
        let entry = candidates
            .entry(recall.chunk_id.clone())
            .or_insert_with(|| Candidate {
                chunk: chunk.clone(),
                source: source.clone(),
                lexical_rank: None,
                semantic_rank: None,
                lexical_score: None,
                semantic_score: None,
                score: 0.0,
                methods: Vec::new(),
            });
        entry.lexical_rank = Some(recall.rank);
        entry.lexical_score = Some(recall.score);
        add_recall_method(&mut entry.methods, RetrievalRecallMethod::Lexical);
        if alias_recall(source, chunk, query) {
            add_recall_method(&mut entry.methods, RetrievalRecallMethod::Alias);
        }
    }
    for recall in semantic {
        let Some(chunk) = chunks.get(&recall.chunk_id) else {
            continue;
        };
        let Some(source) = sources.get(&chunk.source_id) else {
            continue;
        };
        let entry = candidates
            .entry(recall.chunk_id.clone())
            .or_insert_with(|| Candidate {
                chunk: chunk.clone(),
                source: source.clone(),
                lexical_rank: None,
                semantic_rank: None,
                lexical_score: None,
                semantic_score: None,
                score: 0.0,
                methods: Vec::new(),
            });
        entry.semantic_rank = Some(recall.rank);
        entry.semantic_score = Some(recall.score);
        add_recall_method(&mut entry.methods, RetrievalRecallMethod::Semantic);
    }
    let mut candidates = candidates
        .into_values()
        .map(|mut candidate| {
            candidate.score = candidate_score(
                mode,
                candidate.lexical_rank,
                candidate.semantic_rank,
                candidate.semantic_score,
            );
            candidate
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| left.chunk.chunk_id.cmp(&right.chunk.chunk_id))
    });
    candidates
}

fn add_adjacent_candidates(
    primary: &[Candidate],
    chunks: &HashMap<String, RetrievalChunk>,
    sources: &HashMap<String, RetrievalSource>,
    excluded: &HashSet<String>,
    count: usize,
) -> Vec<Candidate> {
    let by_position = chunks
        .values()
        .map(|chunk| {
            (
                (
                    chunk.source_id.clone(),
                    chunk.source_version,
                    chunk.index_version,
                    chunk.ordinal,
                ),
                chunk.chunk_id.clone(),
            )
        })
        .collect::<HashMap<_, _>>();
    let existing = primary
        .iter()
        .map(|candidate| candidate.chunk.chunk_id.clone())
        .collect::<HashSet<_>>();
    let mut seen = existing;
    let mut adjacent = Vec::new();
    for candidate in primary {
        for distance in 1..=count {
            for ordinal in [
                candidate.chunk.ordinal.checked_sub(distance as i64),
                candidate.chunk.ordinal.checked_add(distance as i64),
            ]
            .into_iter()
            .flatten()
            {
                let key = (
                    candidate.chunk.source_id.clone(),
                    candidate.chunk.source_version,
                    candidate.chunk.index_version,
                    ordinal,
                );
                let Some(chunk_id) = by_position.get(&key) else {
                    continue;
                };
                if is_excluded(chunk_id, excluded) || !seen.insert(chunk_id.clone()) {
                    continue;
                }
                let Some(chunk) = chunks.get(chunk_id) else {
                    continue;
                };
                let Some(source) = sources.get(&chunk.source_id) else {
                    continue;
                };
                adjacent.push(Candidate {
                    chunk: chunk.clone(),
                    source: source.clone(),
                    lexical_rank: None,
                    semantic_rank: None,
                    lexical_score: None,
                    semantic_score: None,
                    score: candidate.score / (distance as f32 + 1.0),
                    methods: vec![RetrievalRecallMethod::Adjacent],
                });
            }
        }
    }
    adjacent
}

fn search_hit(candidate: Candidate) -> RetrievalSearchHit {
    let chunk = candidate.chunk;
    let source = candidate.source;
    let chapter_id = chapter_id(&source).or_else(|| chunk.locator.chapter_id.clone());
    let freshness = source_freshness(&source);
    let source_kind = source.source_kind.clone();
    let entity_id = source.entity_id.clone();
    RetrievalSearchHit {
        hit_id: hit_id(&chunk.chunk_id),
        book_id: chunk.book_id.clone(),
        source_kind,
        entity_id,
        chapter_id,
        source_version: chunk.source_version,
        source_updated_at: source.updated_at,
        index_updated_at: source.index_updated_at,
        chunk_id: chunk.chunk_id.clone(),
        quote: chunk.short_quote.clone(),
        locator: chunk.locator.clone(),
        recall_methods: candidate.methods,
        freshness,
        chunk,
        score: candidate.score,
        lexical_score: candidate.lexical_score,
        semantic_score: candidate.semantic_score,
    }
}

fn source_versions(hits: &[RetrievalSearchHit]) -> Vec<RetrievalSourceVersionRecord> {
    let mut seen = HashSet::new();
    hits.iter()
        .filter_map(|hit| {
            let key = (
                hit.chunk.source_id.clone(),
                hit.source_version,
                hit.chunk.index_version,
            );
            seen.insert(key.clone())
                .then_some(RetrievalSourceVersionRecord {
                    source_id: key.0,
                    chapter_id: hit.chapter_id.clone(),
                    source_version: key.1,
                    index_version: key.2,
                })
        })
        .collect()
}

fn excluded_ids(input: &RetrievalSearchRequest) -> Result<HashSet<String>> {
    let mut excluded = HashSet::new();
    for value in &input.excluded_hit_ids {
        if value.is_empty() || value.len() > 8192 || value.chars().any(char::is_control) {
            return Err(invalid());
        }
        excluded.insert(value.clone());
    }
    Ok(excluded)
}

fn broad_status(
    db: &Connection,
    scope: &RetrievalScope,
    query: &str,
    current_chunks: &HashMap<String, RetrievalChunk>,
) -> Result<Option<RetrievalSearchStatus>> {
    let mut broad = scope.clone();
    broad.include_stale = true;
    broad.include_future_plan = true;
    let chunks = read_chunks(db, &broad)?;
    let chunk_map = chunks
        .iter()
        .cloned()
        .map(|chunk| (chunk.chunk_id.clone(), chunk))
        .collect::<HashMap<_, _>>();
    if chunk_map.len() == current_chunks.len() {
        return Ok(None);
    }
    let Some(query) = fts_query(query) else {
        return Ok(None);
    };
    let mut statement = db.prepare(
        "SELECT f.chunk_id
         FROM retrieval_chunks_fts f
         WHERE f.book_id=? AND retrieval_chunks_fts MATCH ?",
    )?;
    let rows = statement.query_map(params![scope.book_id, query], |row| row.get::<_, String>(0))?;
    let sources = read_sources(db, &scope.book_id)?
        .into_iter()
        .map(|source| (source.source_id.clone(), source))
        .collect::<HashMap<_, _>>();
    let mut stale = false;
    let mut future = false;
    for row in rows {
        let chunk_id = row?;
        if current_chunks.contains_key(&chunk_id) || !chunk_map.contains_key(&chunk_id) {
            continue;
        }
        let Some(source_id) = chunk_map.get(&chunk_id).map(|chunk| &chunk.source_id) else {
            continue;
        };
        let Some(source) = sources.get(source_id) else {
            continue;
        };
        stale |= source.source_status != RetrievalSourceStatus::Active
            && source.source_kind != RetrievalSourceKind::FuturePlan;
        future |= source.source_kind == RetrievalSourceKind::FuturePlan;
    }
    Ok(if stale {
        Some(RetrievalSearchStatus::StaleOnly)
    } else if future {
        Some(RetrievalSearchStatus::FuturePlanOnly)
    } else {
        None
    })
}

fn response_context(
    hits: &[RetrievalSearchHit],
    char_budget: usize,
    token_budget: Option<usize>,
    task: &RetrievalTaskStrategy,
    trace: &RetrievalSearchTrace,
) -> crate::rag::contracts::RetrievalContext {
    let evidence_label = |hit: &RetrievalSearchHit| {
        let chapter = hit
            .chunk
            .locator
            .chapter_title_snapshot
            .as_deref()
            .or(hit.chapter_id.as_deref())
            .unwrap_or("book-level");
        let location = hit
            .chunk
            .locator
            .volume_title_snapshot
            .as_deref()
            .map_or_else(
                || chapter.to_owned(),
                |volume| format!("{volume} / {chapter}"),
            );
        format!(
            "{} evidence / {} / {} / source v{}",
            task.as_str(),
            hit.source_kind.as_str(),
            location,
            hit.source_version
        )
    };
    let items = hits
        .iter()
        .map(|hit| ContextItem {
            hit_id: hit.hit_id.clone(),
            label: evidence_label(hit),
            text: hit.chunk.source_text.clone(),
        })
        .collect::<Vec<_>>();
    let context = assemble_context(&items, char_budget, token_budget);
    let included = context
        .included_hit_ids
        .iter()
        .cloned()
        .collect::<HashSet<_>>();
    let materials = hits
        .iter()
        .filter(|hit| included.contains(&hit.hit_id))
        .map(|hit| crate::rag::contracts::RetrievalContextMaterial {
            hit_id: hit.hit_id.clone(),
            label: evidence_label(hit),
            source_kind: hit.source_kind.clone(),
            entity_id: hit.entity_id.clone(),
            chapter_id: hit.chapter_id.clone(),
            chapter_title_snapshot: hit.chunk.locator.chapter_title_snapshot.clone(),
            volume_title_snapshot: hit.chunk.locator.volume_title_snapshot.clone(),
            source_version: hit.source_version,
            chunk_id: hit.chunk_id.clone(),
            quote: hit.quote.clone(),
            freshness: hit.freshness.clone(),
            recall_methods: hit.recall_methods.clone(),
        })
        .collect::<Vec<_>>();
    let context_source_versions = source_versions(
        &hits
            .iter()
            .filter(|hit| included.contains(&hit.hit_id))
            .cloned()
            .collect::<Vec<_>>(),
    );
    let evidence = hits
        .iter()
        .filter(|hit| included.contains(&hit.hit_id))
        .map(|hit| crate::rag::contracts::RetrievalContextEvidence {
            material: crate::rag::contracts::RetrievalContextMaterial {
                hit_id: hit.hit_id.clone(),
                label: evidence_label(hit),
                source_kind: hit.source_kind.clone(),
                entity_id: hit.entity_id.clone(),
                chapter_id: hit.chapter_id.clone(),
                chapter_title_snapshot: hit.chunk.locator.chapter_title_snapshot.clone(),
                volume_title_snapshot: hit.chunk.locator.volume_title_snapshot.clone(),
                source_version: hit.source_version,
                chunk_id: hit.chunk_id.clone(),
                quote: hit.quote.clone(),
                freshness: hit.freshness.clone(),
                recall_methods: hit.recall_methods.clone(),
            },
            text: hit.chunk.source_text.clone(),
        })
        .collect::<Vec<_>>();
    crate::rag::contracts::RetrievalContext {
        search_id: trace.search_id.clone(),
        retrieval_version: trace.retrieval_version.clone(),
        task: trace.task.clone(),
        requested_at: trace.created_at,
        book_id: trace.book_id.clone(),
        chapter_id: trace.chapter_id.clone(),
        scope: trace.scope.clone(),
        excluded_hit_ids: trace.excluded_hit_ids.clone(),
        source_versions: context_source_versions,
        index_version: trace.index_version,
        embedding_fingerprint: trace.embedding_fingerprint.clone(),
        budget: crate::rag::contracts::RetrievalContextBudget {
            char_budget,
            token_budget,
        },
        materials,
        evidence,
        text: context.text,
        char_count: context.char_count,
        token_estimate: context.token_estimate,
        char_budget,
        token_budget,
        included_hit_ids: context.included_hit_ids,
        omitted_hit_ids: context.omitted_hit_ids,
    }
}

fn non_current_hit_status(hits: &[RetrievalSearchHit]) -> Option<RetrievalSearchStatus> {
    if hits.is_empty() {
        return None;
    }
    if hits
        .iter()
        .all(|hit| matches!(hit.freshness, RetrievalFreshness::FuturePlan))
    {
        return Some(RetrievalSearchStatus::FuturePlanOnly);
    }
    if hits.iter().all(|hit| {
        matches!(
            hit.freshness,
            RetrievalFreshness::Stale | RetrievalFreshness::Pending
        )
    }) {
        return Some(RetrievalSearchStatus::StaleOnly);
    }
    None
}

fn record_search_event(
    db: &Connection,
    trace: &RetrievalSearchTrace,
    book_id: &str,
    requested_mode: &RetrievalSearchMode,
    effective_mode: &RetrievalSearchMode,
    status: &RetrievalSearchStatus,
    task: &crate::rag::contracts::RetrievalTaskStrategy,
    query: &str,
    hit_ids: &[String],
) -> Result<()> {
    let source_versions = serde_json::to_string(&trace.source_versions)
        .map_err(|_| search_error("Retrieval trace could not be serialized"))?;
    let hit_ids = serde_json::to_string(hit_ids)
        .map_err(|_| search_error("Retrieval hit trace could not be serialized"))?;
    db.execute(
        "INSERT INTO retrieval_search_events(event_id,book_id,retrieval_version,task,requested_mode,effective_mode,status,query_hash,embedding_fingerprint,source_versions_json,hit_ids_json,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        params![
            trace.search_id,
            book_id,
            RETRIEVAL_VERSION,
            task.as_str(),
            requested_mode.as_str(),
            effective_mode.as_str(),
            serde_json::to_value(status)
                .unwrap()
                .as_str()
                .unwrap()
                .to_owned(),
            stable_text_hash(&normalize_index_text(query)),
            trace.embedding_fingerprint,
            source_versions,
            hit_ids,
            trace.created_at,
        ],
    )?;
    Ok(())
}

impl Database {
    pub fn search_retrieval(
        &mut self,
        input: RetrievalSearchRequest,
        query_vector: Option<Vec<f32>>,
        degradation_reason: Option<String>,
    ) -> Result<Value> {
        validate_task_scope(&input.task, &input.scope)?;
        let requested_mode = input.mode.clone();
        let excluded = excluded_ids(&input)?;
        let limit = input.limit.clamp(1, MAX_SEARCH_LIMIT);
        let char_budget = input.char_budget.clamp(1, MAX_CONTEXT_CHAR_BUDGET);
        let token_budget = input
            .token_budget
            .map(|budget| budget.clamp(1, MAX_CONTEXT_TOKEN_BUDGET));
        let adjacent_count =
            input
                .adjacent_chunk_count
                .min(3)
                .max(if input.adjacent_chunk_count == 0 {
                    0
                } else {
                    DEFAULT_ADJACENT_CHUNKS
                });
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut scope = resolve_scope(&tx, input.scope)?;
        if input
            .freshness_policy
            .as_ref()
            .is_some_and(|policy| policy.fresh_only)
            || !matches!(
                input.task,
                crate::rag::contracts::RetrievalTaskStrategy::Generic
            )
        {
            scope.include_stale = false;
        }
        sync_sources_in_transaction(&tx, &scope.book_id)?;
        let chunks = read_chunks(&tx, &scope)?;
        let chunk_by_id = chunks
            .iter()
            .cloned()
            .map(|chunk| (chunk.chunk_id.clone(), chunk))
            .collect::<HashMap<_, _>>();
        let sources = read_sources(&tx, &scope.book_id)?
            .into_iter()
            .filter(|source| crate::rag::sources::source_is_visible(source, &scope))
            .map(|source| (source.source_id.clone(), source))
            .collect::<HashMap<_, _>>();
        let recall_limit = (limit.saturating_mul(4)).clamp(10, MAX_RECALL_LIMIT);
        let lexical = lexical_recall(
            &tx,
            &scope.book_id,
            &input.query,
            &chunk_by_id,
            recall_limit,
        )?;
        let fingerprint = query_vector
            .as_ref()
            .map(|_| crate::rag::embeddings::current_fingerprint());
        let semantic = if let (Some(query), Some(fingerprint)) =
            (query_vector.as_deref(), fingerprint.as_deref())
        {
            semantic_recall(
                &tx,
                &scope.book_id,
                query,
                &chunk_by_id,
                fingerprint,
                recall_limit,
            )?
        } else {
            Vec::new()
        };
        let require_current_scope = input
            .freshness_policy
            .as_ref()
            .is_some_and(|policy| policy.fresh_only)
            || !matches!(input.task, RetrievalTaskStrategy::Generic);
        let semantic_index_ready =
            semantic_index_ready(&chunk_by_id, &sources, fingerprint.as_deref())
                && (!require_current_scope
                    || sources
                        .values()
                        .filter(|source| !source.source_text.trim().is_empty())
                        .all(|source| {
                            source.index_status == RetrievalIndexStatus::Ready
                                && source.index_version == Some(CHUNK_INDEX_VERSION)
                                && source.embedding_fingerprint == fingerprint
                        }));
        let effective_mode = match requested_mode {
            RetrievalSearchMode::Lexical => RetrievalSearchMode::Lexical,
            RetrievalSearchMode::Semantic if !semantic_index_ready => RetrievalSearchMode::Lexical,
            RetrievalSearchMode::Semantic => RetrievalSearchMode::Semantic,
            RetrievalSearchMode::Hybrid if !semantic_index_ready => RetrievalSearchMode::Lexical,
            RetrievalSearchMode::Hybrid if lexical.is_empty() => RetrievalSearchMode::Semantic,
            RetrievalSearchMode::Hybrid => RetrievalSearchMode::Hybrid,
        };
        let degraded = matches!(
            requested_mode,
            RetrievalSearchMode::Semantic | RetrievalSearchMode::Hybrid
        ) && !semantic_index_ready;
        let mut primary = build_candidates(
            &effective_mode,
            &input.query,
            &chunk_by_id,
            &sources,
            &lexical,
            &semantic,
        )
        .into_iter()
        .filter(|candidate| !is_excluded(&candidate.chunk.chunk_id, &excluded))
        .collect::<Vec<_>>();
        primary.truncate(limit);
        if degraded
            && input
                .freshness_policy
                .as_ref()
                .is_some_and(|policy| !policy.allow_lexical_fallback)
        {
            primary.clear();
        }
        let adjacent =
            add_adjacent_candidates(&primary, &chunk_by_id, &sources, &excluded, adjacent_count);
        primary.extend(adjacent);
        let hits = primary.into_iter().map(search_hit).collect::<Vec<_>>();
        let mut status = if let Some(status) = non_current_hit_status(&hits) {
            status
        } else if hits.is_empty() {
            if let Some(status) = broad_status(&tx, &scope, &input.query, &chunk_by_id)? {
                status
            } else if degraded && query_vector.is_none() {
                if lexical.is_empty() {
                    RetrievalSearchStatus::EmbeddingUnavailable
                } else {
                    RetrievalSearchStatus::DegradedLexical
                }
            } else if degraded && !semantic_index_ready && !lexical.is_empty() {
                RetrievalSearchStatus::IndexNotReady
            } else if matches!(requested_mode, RetrievalSearchMode::Lexical) {
                RetrievalSearchStatus::LexicalNoMatch
            } else if query_vector.is_some() && !semantic_index_ready {
                RetrievalSearchStatus::IndexNotReady
            } else {
                RetrievalSearchStatus::NoResults
            }
        } else if degraded && query_vector.is_none() {
            RetrievalSearchStatus::DegradedLexical
        } else if degraded && !matches!(requested_mode, RetrievalSearchMode::Lexical) {
            RetrievalSearchStatus::IndexNotReady
        } else {
            RetrievalSearchStatus::Ready
        };
        let source_versions = source_versions(&hits);
        let trace = RetrievalSearchTrace {
            search_id: Uuid::new_v4().to_string(),
            retrieval_version: RETRIEVAL_VERSION.to_owned(),
            task: input.task.clone(),
            created_at: now()?,
            book_id: scope.book_id.clone(),
            chapter_id: scope
                .before_anchor
                .as_ref()
                .map(|anchor| anchor.chapter_id.clone())
                .or_else(|| {
                    (scope.allowed_chapter_ids.len() == 1)
                        .then(|| scope.allowed_chapter_ids[0].clone())
                }),
            scope: scope.clone(),
            excluded_hit_ids: input.excluded_hit_ids.clone(),
            index_version: Some(CHUNK_INDEX_VERSION),
            embedding_fingerprint: fingerprint,
            source_versions,
        };
        let context = response_context(&hits, char_budget, token_budget, &input.task, &trace);
        if !hits.is_empty() && context.included_hit_ids.is_empty() {
            status = RetrievalSearchStatus::BudgetExhausted;
        }
        let hit_ids = hits
            .iter()
            .map(|hit| hit.hit_id.clone())
            .collect::<Vec<_>>();
        record_search_event(
            &tx,
            &trace,
            &scope.book_id,
            &requested_mode,
            &effective_mode,
            &status,
            &input.task,
            &input.query,
            &hit_ids,
        )?;
        tx.commit()?;
        Ok(json!(RetrievalSearchResponse {
            requested_mode,
            effective_mode,
            status,
            degraded,
            degradation_reason: degradation_reason.or_else(|| {
                (degraded
                    && semantic.is_empty()
                    && !matches!(input.mode, RetrievalSearchMode::Lexical))
                .then(|| {
                    "Semantic index is unavailable for this scope; lexical results were used"
                        .to_owned()
                })
            }),
            embedding_available: query_vector.is_some(),
            retrieval_version: RETRIEVAL_VERSION.to_owned(),
            score_semantics: "ranking_only".to_owned(),
            lexical_match_count: lexical.len(),
            semantic_match_count: semantic.len(),
            trace,
            context,
            hits,
        }))
    }
}
