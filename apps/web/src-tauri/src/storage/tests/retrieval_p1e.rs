use super::*;
use crate::rag::contracts::{
    RetrievalScope, RetrievalSearchMode, RetrievalSearchRequest, RetrievalSourceKind,
    RetrievalTaskStrategy,
};
use crate::rag::embeddings::{
    configured_model_dir, current_fingerprint, EmbeddingRuntime, DIMENSION,
};
use crate::storage::{
    CharacterInput, CreateCharacter, ListRetrievalIndexJobs, QueueRetrievalIndex,
    RetrievalIndexJobAction, SavePlanning,
};
use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use std::{fs, path::Path, time::Instant};

fn request(
    book_id: &str,
    kind: RetrievalSourceKind,
    query: &str,
    include_stale: bool,
    include_future_plan: bool,
    mode: RetrievalSearchMode,
) -> RetrievalSearchRequest {
    RetrievalSearchRequest {
        freshness_policy: None,
        scope: RetrievalScope {
            book_id: book_id.to_owned(),
            allowed_source_kinds: vec![kind],
            allowed_chapter_ids: Vec::new(),
            before_chapter_order: None,
            before_anchor: None,
            include_future_plan,
            include_generated: false,
            include_stale,
            time_range: None,
        },
        query: query.to_owned(),
        mode,
        limit: 10,
        excluded_hit_ids: Vec::new(),
        char_budget: 6_000,
        token_budget: None,
        adjacent_chunk_count: 0,
        task: RetrievalTaskStrategy::Generic,
        index_status: None,
    }
}

fn assert_hit_contract(response: &Value, book_id: &str) {
    for hit in response["hits"].as_array().unwrap() {
        assert_eq!(hit["bookId"], book_id);
        assert!(hit["sourceKind"].as_str().is_some());
        assert!(hit["entityId"].as_str().is_some());
        assert!(hit["sourceVersion"].as_i64().is_some_and(|value| value > 0));
        assert!(hit["chunkId"].as_str().is_some());
        assert!(hit["quote"].as_str().is_some_and(|value| !value.is_empty()));
        assert!(hit["locator"]["shortQuote"]
            .as_str()
            .is_some_and(|value| !value.is_empty()));
        assert_eq!(hit["chunkId"], hit["chunk"]["chunkId"]);
        assert_eq!(hit["sourceVersion"], hit["chunk"]["sourceVersion"]);
        assert_eq!(hit["locator"], hit["chunk"]["locator"]);
    }
}

fn create_duplicate_character(db: &mut Database, book_id: &str) -> String {
    let version = db.read_book(book_id).unwrap()["book"]["databaseVersion"]
        .as_i64()
        .unwrap();
    let result = db
        .create_character(CreateCharacter {
            character: CharacterInput {
                book_id: book_id.to_owned(),
                name: "共同人物".into(),
                role: "supporting".into(),
                aliases: vec!["共同别名".into()],
                description: "用于隔离测试的同名人物".into(),
                color: "#3b82f6".into(),
                tags: vec!["测试".into()],
                avatar: None,
                handle_config: None,
            },
            expected_book_version: version,
        })
        .unwrap();
    result["character"]["id"].as_str().unwrap().to_owned()
}

fn long_chapter(mut chapter: SaveChapter) -> SaveChapter {
    let text = "林岚在雨夜走到档案室门前，旧钥匙在掌心发冷，门后传来微弱的钟声。".repeat(180);
    chapter.content = json!({
        "type": "doc",
        "content": [{
            "type": "paragraph",
            "content": [{"type": "text", "text": text}]
        }]
    })
    .to_string();
    chapter.word_count = text.chars().count() as i64;
    chapter
}

fn claim_any(
    db: &mut Database,
    book_id: &str,
    fingerprint: &str,
) -> super::super::retrieval_index::IndexWork {
    db.queue_retrieval_index(
        QueueRetrievalIndex {
            book_id: book_id.to_owned(),
        },
        fingerprint,
    )
    .unwrap();
    db.claim_next_retrieval_index_job(book_id)
        .unwrap()
        .expect("queueing an index should create a claimable job")
}

fn claim_kind(
    db: &mut Database,
    book_id: &str,
    fingerprint: &str,
    marker: &str,
) -> super::super::retrieval_index::IndexWork {
    db.queue_retrieval_index(
        QueueRetrievalIndex {
            book_id: book_id.to_owned(),
        },
        fingerprint,
    )
    .unwrap();
    while let Some(work) = db.claim_next_retrieval_index_job(book_id).unwrap() {
        if work.source_id.contains(marker) {
            return work;
        }
        db.fail_retrieval_index_job(&work.job_id, "P1-E selected another source")
            .unwrap();
    }
    panic!("index job for {marker} was not queued");
}

fn vectors(work: &super::super::retrieval_index::IndexWork, first_value: f32) -> Vec<Vec<f32>> {
    work.chunks
        .iter()
        .map(|_| {
            let mut vector = vec![0.0; DIMENSION];
            vector[0] = first_value;
            vector
        })
        .collect()
}

fn job_state(db: &mut Database, book_id: &str, job_id: &str) -> String {
    db.list_retrieval_index_jobs(ListRetrievalIndexJobs {
        book_id: book_id.to_owned(),
    })
    .unwrap()
    .as_array()
    .unwrap()
    .iter()
    .find(|job| job["jobId"] == job_id)
    .and_then(|job| job["state"].as_str())
    .unwrap()
    .to_owned()
}

fn embedding_blob(db: &Database, chunk_id: &str) -> Option<Vec<u8>> {
    db.connection
        .query_row(
            "SELECT embedding_blob FROM retrieval_chunks WHERE chunk_id=?",
            [chunk_id],
            |row| row.get(0),
        )
        .optional()
        .unwrap()
        .flatten()
}

fn model_resource_bytes(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .filter_map(std::result::Result::ok)
        .map(|entry| {
            let path = entry.path();
            if path.is_dir() {
                model_resource_bytes(&path)
            } else {
                entry.metadata().map(|metadata| metadata.len()).unwrap_or(0)
            }
        })
        .sum()
}

#[test]
fn retrieval_results_are_strictly_isolated_by_book_for_duplicate_names_aliases_and_text() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let first = fixture(&mut db);
    db.save_chapter(first.clone()).unwrap();
    let second = fixture(&mut db);
    db.save_chapter(second.clone()).unwrap();
    let first_character = create_duplicate_character(&mut db, &first.book_id);
    let second_character = create_duplicate_character(&mut db, &second.book_id);

    let first_character_response = db
        .search_retrieval(
            request(
                &first.book_id,
                RetrievalSourceKind::Character,
                "共同别名",
                false,
                false,
                RetrievalSearchMode::Lexical,
            ),
            None,
            None,
        )
        .unwrap();
    assert_hit_contract(&first_character_response, &first.book_id);
    let character_hits = first_character_response["hits"].as_array().unwrap();
    assert_eq!(character_hits.len(), 1);
    assert_eq!(character_hits[0]["entityId"], first_character);
    assert_ne!(character_hits[0]["entityId"], second_character);

    let first_text_response = db
        .search_retrieval(
            request(
                &first.book_id,
                RetrievalSourceKind::Manuscript,
                "你好",
                false,
                false,
                RetrievalSearchMode::Lexical,
            ),
            None,
            None,
        )
        .unwrap();
    assert_hit_contract(&first_text_response, &first.book_id);
    assert!(first_text_response["hits"]
        .as_array()
        .unwrap()
        .iter()
        .all(|hit| hit["bookId"] == first.book_id));
    assert!(first_text_response["hits"]
        .as_array()
        .unwrap()
        .iter()
        .all(|hit| hit["bookId"] != second.book_id));
}

#[test]
fn stale_future_and_no_answer_states_are_visible_in_the_search_contract() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let mut chapter = fixture(&mut db);
    db.save_chapter(chapter.clone()).unwrap();
    db.save_planning(SavePlanning {
        book_id: chapter.book_id.clone(),
        expected_database_version: 0,
        story_summary: "书籍摘要".into(),
        story_background: "已确认背景".into(),
        chapter_summaries: json!([{
            "chapterId": chapter.chapter_id,
            "summary": "旧概括中的失踪钟声",
            "sourceChapterVersion": 2,
            "updatedAt": 2
        }]),
        plot_settings: json!([{
            "id": "future-plot",
            "title": "未来地下室停电",
            "details": "尚未发生的地下室停电",
            "chapterIds": [chapter.chapter_id],
            "createdAt": 1,
            "updatedAt": 2
        }]),
        session_key: "p1e-search-state".into(),
        revision: 1,
    })
    .unwrap();

    chapter.expected_database_version = 2;
    chapter.title = "当前正文已改变".into();
    db.save_chapter(chapter.clone()).unwrap();

    let stale = db
        .search_retrieval(
            request(
                &chapter.book_id,
                RetrievalSourceKind::ChapterSummary,
                "旧概括中的失踪钟声",
                true,
                false,
                RetrievalSearchMode::Lexical,
            ),
            None,
            None,
        )
        .unwrap();
    assert_eq!(stale["status"], "stale_only");
    assert_hit_contract(&stale, &chapter.book_id);
    assert!(stale["hits"]
        .as_array()
        .unwrap()
        .iter()
        .all(|hit| hit["freshness"] == "stale"));

    let future = db
        .search_retrieval(
            request(
                &chapter.book_id,
                RetrievalSourceKind::FuturePlan,
                "尚未发生的地下室停电",
                false,
                true,
                RetrievalSearchMode::Lexical,
            ),
            None,
            None,
        )
        .unwrap();
    assert_eq!(future["status"], "future_plan_only");
    assert_hit_contract(&future, &chapter.book_id);
    assert!(future["hits"]
        .as_array()
        .unwrap()
        .iter()
        .all(|hit| hit["freshness"] == "future_plan"));

    let no_answer = db
        .search_retrieval(
            request(
                &chapter.book_id,
                RetrievalSourceKind::Manuscript,
                "海边灯塔的蓝色汽笛",
                false,
                false,
                RetrievalSearchMode::Lexical,
            ),
            None,
            None,
        )
        .unwrap();
    assert_eq!(no_answer["status"], "lexical_no_match");
    assert!(no_answer["hits"].as_array().unwrap().is_empty());
}

#[test]
fn wrong_dimension_and_embedding_failure_leave_chunks_unwritten() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let chapter = fixture(&mut db);
    db.save_chapter(chapter.clone()).unwrap();
    let work = claim_any(&mut db, &chapter.book_id, "p1e-wrong-dimension");
    let wrong_vectors = vec![vec![0.0; DIMENSION - 1]; work.chunks.len()];
    let error = db
        .commit_retrieval_index_job(&work, &wrong_vectors)
        .unwrap_err();
    assert_eq!(error.code, "RETRIEVAL_INDEX_FAILURE");
    assert!(work
        .chunks
        .iter()
        .all(|chunk| embedding_blob(&db, &chunk.chunk_id).is_none()));
    assert_eq!(
        job_state(&mut db, &chapter.book_id, &work.job_id),
        "indexing"
    );

    db.fail_retrieval_index_job(&work.job_id, "Synthetic embedding failure")
        .unwrap();
    assert_eq!(job_state(&mut db, &chapter.book_id, &work.job_id), "failed");
    let source_status: String = db
        .connection
        .query_row(
            "SELECT index_status FROM retrieval_sources WHERE source_id=?",
            [&work.source_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(source_status, "failed");
}

#[test]
fn cancellation_and_late_source_versions_discard_index_results() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let mut chapter = fixture(&mut db);
    db.save_chapter(chapter.clone()).unwrap();
    let cancelled = claim_any(&mut db, &chapter.book_id, "p1e-cancel");
    db.cancel_retrieval_index_job(RetrievalIndexJobAction {
        job_id: cancelled.job_id.clone(),
    })
    .unwrap();
    assert_eq!(
        db.commit_retrieval_index_job(&cancelled, &vectors(&cancelled, 1.0))
            .unwrap(),
        super::super::retrieval_index::IndexCommitResult::Stale
    );
    assert_eq!(
        job_state(&mut db, &chapter.book_id, &cancelled.job_id),
        "cancelled"
    );
    assert!(cancelled
        .chunks
        .iter()
        .all(|chunk| embedding_blob(&db, &chunk.chunk_id).is_none()));

    let late = claim_kind(&mut db, &chapter.book_id, "p1e-late-source", ":manuscript:");
    let current_version = db.read_book(&chapter.book_id).unwrap()["chapters"][0]["databaseVersion"]
        .as_i64()
        .unwrap();
    let mut stale_save = chapter.clone();
    stale_save.expected_database_version = current_version;
    chapter.expected_database_version = current_version;
    chapter.title = "版本已经前进".into();
    db.save_chapter(chapter).unwrap();
    assert_eq!(
        db.save_chapter(stale_save).unwrap_err().code,
        "VERSION_CONFLICT"
    );
    assert_eq!(
        db.commit_retrieval_index_job(&late, &vectors(&late, 1.0))
            .unwrap(),
        super::super::retrieval_index::IndexCommitResult::Stale
    );
    assert_eq!(job_state(&mut db, &late.book_id, &late.job_id), "failed");
    assert!(late
        .chunks
        .iter()
        .all(|chunk| embedding_blob(&db, &chunk.chunk_id).is_none()));
}

#[test]
fn partial_index_commit_rolls_back_every_prior_chunk_write() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let chapter = long_chapter({
        let chapter = fixture(&mut db);
        chapter
    });
    db.save_chapter(chapter.clone()).unwrap();
    let initial_fingerprint = current_fingerprint();
    db.queue_retrieval_index(
        QueueRetrievalIndex {
            book_id: chapter.book_id.clone(),
        },
        &initial_fingerprint,
    )
    .unwrap();
    while let Some(work) = db.claim_next_retrieval_index_job(&chapter.book_id).unwrap() {
        assert_eq!(
            db.commit_retrieval_index_job(&work, &vectors(&work, 1.0))
                .unwrap(),
            super::super::retrieval_index::IndexCommitResult::Completed
        );
    }

    let target = claim_kind(
        &mut db,
        &chapter.book_id,
        "p1e-reindex-fingerprint",
        ":manuscript:",
    );
    assert!(target.chunks.len() > 1);
    let original = embedding_blob(&db, &target.chunks[0].chunk_id).unwrap();
    let mut corrupted = target.clone();
    corrupted.chunks[1].chunk_id = "missing-chunk-for-p1e".into();
    assert_eq!(
        db.commit_retrieval_index_job(&corrupted, &vectors(&corrupted, 2.0))
            .unwrap(),
        super::super::retrieval_index::IndexCommitResult::Stale
    );
    assert_eq!(
        embedding_blob(&db, &target.chunks[0].chunk_id),
        Some(original)
    );
    db.fail_retrieval_index_job(&target.job_id, "Synthetic partial write failure")
        .unwrap();
}

#[test]
fn reopening_storage_recovers_interrupted_index_jobs_without_resetting_data() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let chapter = fixture(&mut db);
    db.save_chapter(chapter.clone()).unwrap();
    let work = claim_any(&mut db, &chapter.book_id, "p1e-restart");
    let chunk_count: i64 = db
        .connection
        .query_row(
            "SELECT count(*) FROM retrieval_chunks WHERE book_id=?",
            [&chapter.book_id],
            |row| row.get(0),
        )
        .unwrap();
    drop(db);

    let mut reopened = Database::open(&temp.0).unwrap();
    assert_eq!(
        job_state(&mut reopened, &chapter.book_id, &work.job_id),
        "queued"
    );
    let source_status: String = reopened
        .connection
        .query_row(
            "SELECT index_status FROM retrieval_sources WHERE source_id=?",
            [&work.source_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(source_status, "queued");
    let reopened_chunk_count: i64 = reopened
        .connection
        .query_row(
            "SELECT count(*) FROM retrieval_chunks WHERE book_id=?",
            [&chapter.book_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(reopened_chunk_count, chunk_count);
}

#[test]
fn local_semantic_path_records_p1e_baseline_when_model_is_configured() {
    let Some(model_dir) = configured_model_dir() else {
        eprintln!(
            "P1E_BASELINE {{\"semanticPath\":\"not_configured\",\"lexicalPath\":\"covered\"}}"
        );
        return;
    };
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let chapter = fixture(&mut db);
    db.save_chapter(chapter.clone()).unwrap();
    let runtime = EmbeddingRuntime::default();
    let started = Instant::now();
    let fingerprint = current_fingerprint();
    db.queue_retrieval_index(
        QueueRetrievalIndex {
            book_id: chapter.book_id.clone(),
        },
        &fingerprint,
    )
    .unwrap();
    while let Some(work) = db.claim_next_retrieval_index_job(&chapter.book_id).unwrap() {
        let texts = work
            .chunks
            .iter()
            .map(|chunk| chunk.index_text.clone())
            .collect::<Vec<_>>();
        let embeddings = runtime
            .with_provider(|provider| provider.embed_documents(&texts))
            .unwrap();
        assert_eq!(embeddings.len(), work.chunks.len());
        assert_eq!(
            db.commit_retrieval_index_job(&work, &embeddings).unwrap(),
            super::super::retrieval_index::IndexCommitResult::Completed
        );
    }
    let query_vector = runtime
        .with_provider(|provider| provider.embed_query("你好，世界"))
        .unwrap();
    let response = db
        .search_retrieval(
            request(
                &chapter.book_id,
                RetrievalSourceKind::Manuscript,
                "你好，世界",
                false,
                false,
                RetrievalSearchMode::Semantic,
            ),
            Some(query_vector),
            None,
        )
        .unwrap();
    assert_eq!(response["status"], "ready");
    assert!(response["semanticMatchCount"].as_u64().unwrap() > 0);
    assert_hit_contract(&response, &chapter.book_id);
    let hits = response["hits"].as_array().unwrap();
    let sample_recall_at_1 =
        hits.first()
            .is_some_and(|hit| hit["sourceKind"] == "manuscript") as u8 as f64;
    let citation_correctness = hits
        .iter()
        .filter(|hit| {
            hit["bookId"] == chapter.book_id
                && hit["sourceVersion"] == hit["chunk"]["sourceVersion"]
                && hit["locator"] == hit["chunk"]["locator"]
        })
        .count() as f64
        / hits.len().max(1) as f64;
    let stale_hit_rate = hits
        .iter()
        .filter(|hit| hit["freshness"] == "stale")
        .count() as f64
        / hits.len().max(1) as f64;
    let chunk_count: i64 = db
        .connection
        .query_row(
            "SELECT count(*) FROM retrieval_chunks WHERE book_id=?",
            [&chapter.book_id],
            |row| row.get(0),
        )
        .unwrap();
    let vector_bytes: i64 = db
        .connection
        .query_row(
            "SELECT coalesce(sum(length(embedding_blob)),0) FROM retrieval_chunks WHERE book_id=?",
            [&chapter.book_id],
            |row| row.get(0),
        )
        .unwrap();
    eprintln!(
        "P1E_BASELINE {}",
        json!({
            "platform": std::env::consts::OS,
            "provider": "fastembed-rs",
            "model": "intfloat/multilingual-e5-small",
            "dimension": DIMENSION,
            "sampleRecallAt1": sample_recall_at_1,
            "citationCorrectness": citation_correctness,
            "staleHitRate": stale_hit_rate,
            "indexLatencyMs": started.elapsed().as_secs_f64() * 1000.0,
            "chunkCount": chunk_count,
            "embeddingBytes": vector_bytes,
            "modelResourceBytes": model_resource_bytes(&model_dir)
        })
    );
}
