use super::*;
use crate::rag::contracts::{
    RetrievalAnchor, RetrievalScope, RetrievalSearchMode, RetrievalSearchRequest,
    RetrievalTaskStrategy,
};
use crate::rag::embeddings::{current_fingerprint, DIMENSION};
use crate::storage::{
    ListRetrievalChunks, ListRetrievalSources, QueueRetrievalIndex, SavePlanning,
};

fn source<'a>(sources: &'a Value, kind: &str) -> &'a Value {
    sources
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["sourceKind"] == kind)
        .unwrap_or_else(|| panic!("missing source kind {kind}"))
}

fn current_summary_snapshot(chapter: &SaveChapter, version: i64) -> Value {
    json!({
        "chapterId": chapter.chapter_id,
        "chapterDatabaseVersion": version,
        "chapterTitle": chapter.title,
        "contentFormat": "tiptap-json",
        "contentVersion": 1,
        "fingerprintAlgorithm": "fnv1a64-utf16-v1",
        "bodyFingerprint": "0123456789abcdef",
        "structuredFingerprint": "fedcba9876543210",
        "blockFingerprints": ["fedcba9876543210"],
        "mentionedCharacterIds": [],
        "foreshadowingIds": [],
        "foreshadowingNoteFingerprints": [],
        "capturedAt": 2
    })
}

#[test]
fn source_registry_keeps_display_text_separate_and_invalidates_changed_versions() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let mut chapter = fixture(&mut db);
    let book_id = chapter.book_id.clone();
    let chapter_id = chapter.chapter_id.clone();
    db.save_chapter(chapter.clone()).unwrap();

    let sources = db.sync_retrieval_sources(&book_id).unwrap();
    let manuscript = source(&sources, "manuscript");
    assert_eq!(manuscript["bookId"], book_id);
    assert_eq!(manuscript["entityId"], chapter_id);
    assert_eq!(manuscript["sourceVersion"], 2);
    assert_eq!(manuscript["sourceStatus"], "active");
    assert_eq!(manuscript["indexStatus"], "stale");
    assert!(manuscript["sourceText"].as_str().unwrap().contains("你好"));
    assert!(manuscript["indexText"].as_str().unwrap().contains("你好"));
    assert_ne!(manuscript["sourceText"], json!(""));

    let note = source(&sources, "foreshadowing_note");
    assert_eq!(note["visibilityScope"]["kind"], "chapter");
    assert_eq!(note["entityMetadata"]["chapterId"], chapter_id);

    chapter.expected_database_version = 2;
    chapter.title = "Renamed chapter".into();
    db.save_chapter(chapter).unwrap();
    let changed = source(&db.sync_retrieval_sources(&book_id).unwrap(), "manuscript").clone();
    assert_eq!(changed["sourceVersion"], 3);
    assert_eq!(changed["indexStatus"], "stale");
    assert!(changed["sourceText"]
        .as_str()
        .unwrap()
        .contains("Renamed chapter"));
}

#[test]
fn legacy_summary_without_a_source_snapshot_is_not_marked_as_current_retrieval_evidence() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let chapter = fixture(&mut db);
    db.save_chapter(chapter.clone()).unwrap();
    db.save_planning(SavePlanning {
        book_id: chapter.book_id.clone(),
        expected_database_version: 0,
        story_summary: String::new(),
        story_background: String::new(),
        chapter_summaries: json!([{
            "chapterId": chapter.chapter_id,
            "summary": "An older summary with a matching version number.",
            "sourceChapterVersion": 2,
            "updatedAt": 2
        }]),
        plot_settings: json!([]),
        session_key: "legacy-summary-freshness".into(),
        revision: 1,
    })
    .unwrap();

    let sources = db.sync_retrieval_sources(&chapter.book_id).unwrap();
    assert_eq!(
        source(&sources, "chapter_summary")["sourceStatus"],
        "pending"
    );
}

#[test]
fn chapter_summary_retrieval_rejects_future_plan_and_cross_chapter_scopes() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let chapter = fixture(&mut db);
    db.save_chapter(chapter.clone()).unwrap();
    let book_id = chapter.book_id.clone();
    let chapter_id = chapter.chapter_id.clone();
    let unsafe_scope = |allowed_chapter_ids: Vec<String>,
                        include_future_plan: bool,
                        allowed_source_kinds| RetrievalScope {
        book_id: book_id.clone(),
        allowed_source_kinds,
        allowed_chapter_ids,
        before_chapter_order: None,
        before_anchor: None,
        include_future_plan,
        include_generated: false,
        include_stale: false,
        time_range: None,
    };
    let request = |scope| RetrievalSearchRequest {
        freshness_policy: None,
        scope,
        query: "chapter summary".into(),
        mode: RetrievalSearchMode::Lexical,
        limit: 5,
        excluded_hit_ids: Vec::new(),
        char_budget: 1000,
        token_budget: None,
        adjacent_chunk_count: 0,
        task: RetrievalTaskStrategy::ChapterSummary,
        index_status: None,
    };

    assert_eq!(
        db.search_retrieval(
            request(unsafe_scope(
                vec![chapter_id.clone()],
                true,
                vec![crate::rag::contracts::RetrievalSourceKind::Character],
            )),
            None,
            None
        )
        .unwrap_err()
        .code,
        "INVALID_INPUT"
    );
    assert_eq!(
        db.search_retrieval(
            request(unsafe_scope(
                vec![chapter_id.clone(), Uuid::new_v4().to_string()],
                false,
                vec![crate::rag::contracts::RetrievalSourceKind::Character],
            )),
            None,
            None
        )
        .unwrap_err()
        .code,
        "INVALID_INPUT"
    );

    assert_eq!(
        db.search_retrieval(
            request(unsafe_scope(
                vec![chapter_id.clone()],
                false,
                vec![crate::rag::contracts::RetrievalSourceKind::ForeshadowingNote],
            )),
            None,
            None
        )
        .unwrap_err()
        .code,
        "INVALID_INPUT"
    );

    let response = db
        .search_retrieval(
            request(unsafe_scope(
                vec![chapter_id.clone()],
                false,
                vec![crate::rag::contracts::RetrievalSourceKind::Character],
            )),
            None,
            None,
        )
        .unwrap();
    assert_eq!(response["context"]["task"], "chapter_summary");
    assert_eq!(response["context"]["chapterId"], chapter_id);
    assert_eq!(response["context"]["scope"]["includeFuturePlan"], false);
}

#[test]
fn retrieval_scope_filters_by_book_kind_and_future_plan_before_results() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let chapter = fixture(&mut db);
    db.save_chapter(chapter.clone()).unwrap();
    db.save_planning(SavePlanning {
        book_id: chapter.book_id.clone(),
        expected_database_version: 0,
        story_summary: "Written history".into(),
        story_background: "Confirmed rule".into(),
        chapter_summaries: json!([{
            "chapterId": chapter.chapter_id,
            "summary": "A saved summary",
            "sourceChapterVersion": 2,
            "sourceSnapshot": current_summary_snapshot(&chapter, 2),
            "updatedAt": 2
        }]),
        plot_settings: json!([{
            "id": "future-plot",
            "title": "Planned event",
            "details": "This has not happened",
            "chapterIds": [chapter.chapter_id],
            "createdAt": 1,
            "updatedAt": 2
        }]),
        session_key: "retrieval-test".into(),
        revision: 1,
    })
    .unwrap();

    let initial = db.sync_retrieval_sources(&chapter.book_id).unwrap();
    assert_eq!(
        source(&initial, "chapter_summary")["sourceStatus"],
        "active"
    );
    let mut changed_chapter = chapter.clone();
    changed_chapter.expected_database_version = 2;
    changed_chapter.title = "Changed after summary".into();
    db.save_chapter(changed_chapter).unwrap();
    let stale = db.sync_retrieval_sources(&chapter.book_id).unwrap();
    assert_eq!(source(&stale, "chapter_summary")["sourceStatus"], "stale");
    assert_eq!(source(&stale, "chapter_summary")["indexStatus"], "stale");

    let default_continue = RetrievalScope::continue_before(
        chapter.book_id.clone(),
        RetrievalAnchor {
            chapter_id: chapter.chapter_id.clone(),
            paragraph_ordinal: Some(1),
            text_offset: Some(0),
        },
    );
    let visible = db
        .list_retrieval_sources(ListRetrievalSources {
            scope: default_continue,
        })
        .unwrap();
    assert!(visible
        .as_array()
        .unwrap()
        .iter()
        .all(|item| item["bookId"] == chapter.book_id));
    assert!(visible
        .as_array()
        .unwrap()
        .iter()
        .all(|item| item["sourceKind"] != "future_plan"));
    assert!(visible
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item["sourceKind"] == "manuscript"));

    let future = db
        .list_retrieval_sources(ListRetrievalSources {
            scope: RetrievalScope {
                book_id: chapter.book_id.clone(),
                allowed_source_kinds: vec![crate::rag::contracts::RetrievalSourceKind::FuturePlan],
                allowed_chapter_ids: Vec::new(),
                before_chapter_order: None,
                before_anchor: None,
                include_future_plan: true,
                include_generated: false,
                include_stale: false,
                time_range: None,
            },
        })
        .unwrap();
    assert_eq!(future.as_array().unwrap().len(), 1);
    assert_eq!(future[0]["entityId"], "future-plot");

    let other = fixture(&mut db);
    db.save_chapter(other.clone()).unwrap();
    db.save_planning(SavePlanning {
        book_id: other.book_id.clone(),
        expected_database_version: 0,
        story_summary: "Same field in another work".into(),
        story_background: "Other work background".into(),
        chapter_summaries: json!([]),
        plot_settings: json!([]),
        session_key: "other-retrieval-test".into(),
        revision: 1,
    })
    .unwrap();
    assert!(!db
        .sync_retrieval_sources(&other.book_id)
        .unwrap()
        .as_array()
        .unwrap()
        .is_empty());
    let isolated = db
        .list_retrieval_sources(ListRetrievalSources {
            scope: RetrievalScope {
                book_id: chapter.book_id,
                allowed_source_kinds: Vec::new(),
                allowed_chapter_ids: Vec::new(),
                before_chapter_order: None,
                before_anchor: None,
                include_future_plan: true,
                include_generated: true,
                include_stale: true,
                time_range: None,
            },
        })
        .unwrap();
    assert!(isolated
        .as_array()
        .unwrap()
        .iter()
        .all(|item| item["bookId"] != other.book_id));
}

#[test]
fn chunk_registry_keeps_locators_and_historical_version_identity() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let mut chapter = fixture(&mut db);
    let book_id = chapter.book_id.clone();
    db.save_chapter(chapter.clone()).unwrap();

    let scope = RetrievalScope {
        book_id: book_id.clone(),
        allowed_source_kinds: vec![crate::rag::contracts::RetrievalSourceKind::Manuscript],
        allowed_chapter_ids: Vec::new(),
        before_chapter_order: None,
        before_anchor: None,
        include_future_plan: false,
        include_generated: false,
        include_stale: false,
        time_range: None,
    };
    let first = db
        .list_retrieval_chunks(ListRetrievalChunks {
            scope: scope.clone(),
        })
        .unwrap();
    let first_chunk = first
        .as_array()
        .unwrap()
        .first()
        .expect("a saved manuscript should produce a chunk");
    assert_eq!(first_chunk["bookId"], book_id);
    assert_eq!(first_chunk["sourceVersion"], 2);
    assert_eq!(first_chunk["indexVersion"], 1);
    assert_eq!(first_chunk["locator"]["chapterId"], chapter.chapter_id);
    assert_eq!(first_chunk["locator"]["chapterTitleSnapshot"], "New title");
    assert!(!first_chunk["locator"]["tiptapNodePaths"]
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(first_chunk["locator"]["textHash"], first_chunk["textHash"]);
    let first_id = first_chunk["chunkId"].as_str().unwrap().to_owned();
    let source_id = first_chunk["sourceId"].as_str().unwrap().to_owned();

    chapter.expected_database_version = 2;
    chapter.title = "Changed title".into();
    db.save_chapter(chapter).unwrap();
    let second = db
        .list_retrieval_chunks(ListRetrievalChunks { scope })
        .unwrap();
    assert!(second
        .as_array()
        .unwrap()
        .iter()
        .all(|chunk| chunk["sourceVersion"] == 3));
    assert!(second
        .as_array()
        .unwrap()
        .iter()
        .all(|chunk| chunk["chunkId"] != first_id));
    let historical_count: i64 = db
        .connection
        .query_row(
            "SELECT count(*) FROM retrieval_chunks WHERE source_id=?",
            [source_id],
            |row| row.get(0),
        )
        .unwrap();
    assert!(historical_count >= 2);
}

#[test]
fn lexical_search_uses_cjk_fts_and_returns_locators() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let mut chapter = fixture(&mut db);
    // Real Tiptap documents omit content on blank paragraphs. One blank line
    // must not remove every manuscript chunk, even in an already-ready index.
    chapter.content = json!({"type":"doc","content":[
        {"type":"paragraph"},
        {"type":"paragraph","content":[{"type":"text","text":"你好，那个男人回来了。"}]},
        {"type":"paragraph"}
    ]})
    .to_string();
    db.save_chapter(chapter.clone()).unwrap();
    let source_id = source(
        &db.sync_retrieval_sources(&chapter.book_id).unwrap(),
        "manuscript",
    )["sourceId"]
        .as_str()
        .unwrap()
        .to_owned();
    db.connection
        .execute(
            "DELETE FROM retrieval_chunks WHERE source_id=?",
            [&source_id],
        )
        .unwrap();
    db.connection
        .execute(
            "DELETE FROM retrieval_chunks_fts WHERE source_id=?",
            [&source_id],
        )
        .unwrap();
    db.connection
        .execute(
            "DELETE FROM retrieval_dirty_sources WHERE source_id=?",
            [&source_id],
        )
        .unwrap();
    db.connection.execute("UPDATE retrieval_sources SET index_status='ready',index_version=1,embedding_fingerprint=? WHERE source_id=?", rusqlite::params![current_fingerprint(), source_id]).unwrap();
    let repaired = db.sync_retrieval_sources(&chapter.book_id).unwrap();
    assert_eq!(source(&repaired, "manuscript")["indexStatus"], "stale");
    assert_eq!(
        db.connection
            .query_row(
                "SELECT count(*) FROM retrieval_dirty_sources WHERE source_id=?",
                [&source_id],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    let response = db
        .search_retrieval(
            RetrievalSearchRequest {
                freshness_policy: None,
                scope: RetrievalScope {
                    book_id: chapter.book_id.clone(),
                    allowed_source_kinds: vec![
                        crate::rag::contracts::RetrievalSourceKind::Manuscript,
                    ],
                    allowed_chapter_ids: vec![chapter.chapter_id.clone()],
                    before_chapter_order: None,
                    before_anchor: None,
                    include_future_plan: false,
                    include_generated: false,
                    include_stale: false,
                    time_range: None,
                },
                query: "你好".into(),
                mode: RetrievalSearchMode::Lexical,
                limit: 10,
                excluded_hit_ids: Vec::new(),
                char_budget: 6_000,
                token_budget: None,
                adjacent_chunk_count: 1,
                task: crate::rag::contracts::RetrievalTaskStrategy::Generic,
                index_status: None,
            },
            None,
            None,
        )
        .unwrap();
    assert_eq!(response["effectiveMode"], "lexical");
    assert_eq!(response["status"], "ready");
    assert_eq!(response["scoreSemantics"], "ranking_only");
    assert_eq!(response["retrievalVersion"], "p1-r1-v1");
    assert_eq!(response["trace"]["task"], "generic");
    assert_eq!(response["degraded"], false);
    assert!(!response["hits"].as_array().unwrap().is_empty());
    assert!(response["hits"][0]["hitId"].as_str().is_some());
    assert_eq!(response["hits"][0]["bookId"], chapter.book_id);
    assert_eq!(response["hits"][0]["sourceKind"], "manuscript");
    assert!(response["hits"][0]["sourceUpdatedAt"].as_i64().is_some());
    assert!(response["hits"][0]["indexUpdatedAt"].is_null());
    assert_eq!(response["hits"][0]["recallMethods"][0], "lexical");
    assert_eq!(response["hits"][0]["freshness"], "fresh");
    assert_eq!(
        response["hits"][0]["chunk"]["locator"]["paragraphSpans"][0]["paragraphOrdinal"],
        1
    );
    assert!(response["context"]["text"]
        .as_str()
        .unwrap()
        .contains("你好"));
    assert_eq!(
        response["hits"][0]["chunk"]["locator"]["chapterId"],
        chapter.chapter_id
    );
    assert_eq!(
        db.connection
            .query_row(
                "SELECT count(*) FROM retrieval_search_events WHERE book_id=? AND task=?",
                rusqlite::params![chapter.book_id, "generic"],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        1
    );
}

#[test]
fn lexical_search_applies_scope_before_its_result_limit() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let mut chapter = fixture(&mut db);
    chapter.content = json!({
        "type": "doc",
        "content": [{
            "type": "paragraph",
            "content": [{"type": "text", "text": "她并不脆弱。"}]
        }]
    })
    .to_string();
    db.save_chapter(chapter.clone()).unwrap();

    let (target_chunk_id, matching_document): (String, String) = db
        .connection
        .query_row(
            "SELECT f.chunk_id,f.search_text
             FROM retrieval_chunks_fts f
             JOIN retrieval_chunks c ON c.chunk_id=f.chunk_id
             JOIN retrieval_sources s ON s.source_id=c.source_id AND s.book_id=c.book_id
             WHERE f.book_id=? AND s.source_kind='manuscript' AND c.source_text LIKE '%脆弱%'
             LIMIT 1",
            [&chapter.book_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();

    // Excluded FTS rows used to fill SQL's top-N limit before scope filtering,
    // hiding a valid manuscript match behind unrelated evidence sources.
    for index in 0..12 {
        db.connection
            .execute(
                "INSERT INTO retrieval_chunks_fts(chunk_id,book_id,source_id,source_version,index_version,search_text)
                 VALUES (?,?,?,?,?,?)",
                rusqlite::params![
                    format!("!out-of-scope-decoy-{index:02}"),
                    chapter.book_id,
                    "excluded-source",
                    1,
                    1,
                    matching_document,
                ],
            )
            .unwrap();
    }

    let response = db
        .search_retrieval(
            RetrievalSearchRequest {
                freshness_policy: None,
                scope: RetrievalScope {
                    book_id: chapter.book_id.clone(),
                    allowed_source_kinds: vec![
                        crate::rag::contracts::RetrievalSourceKind::Manuscript,
                    ],
                    allowed_chapter_ids: vec![chapter.chapter_id.clone()],
                    before_chapter_order: None,
                    before_anchor: None,
                    include_future_plan: false,
                    include_generated: false,
                    include_stale: false,
                    time_range: None,
                },
                query: "脆弱".into(),
                mode: RetrievalSearchMode::Lexical,
                limit: 3,
                excluded_hit_ids: Vec::new(),
                char_budget: 6_000,
                token_budget: None,
                adjacent_chunk_count: 0,
                task: crate::rag::contracts::RetrievalTaskStrategy::Generic,
                index_status: None,
            },
            None,
            None,
        )
        .unwrap();

    let hits = response["hits"].as_array().unwrap();
    assert!(hits.iter().any(|hit| hit["chunkId"] == target_chunk_id));
    assert!(hits.iter().all(|hit| hit["sourceKind"] == "manuscript"));
}

#[test]
fn hybrid_search_without_local_embedding_reports_lexical_degradation() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let chapter = fixture(&mut db);
    db.save_chapter(chapter.clone()).unwrap();
    let response = db
        .search_retrieval(
            RetrievalSearchRequest {
                freshness_policy: None,
                scope: RetrievalScope {
                    book_id: chapter.book_id.clone(),
                    allowed_source_kinds: vec![
                        crate::rag::contracts::RetrievalSourceKind::Manuscript,
                    ],
                    allowed_chapter_ids: vec![chapter.chapter_id.clone()],
                    before_chapter_order: None,
                    before_anchor: None,
                    include_future_plan: false,
                    include_generated: false,
                    include_stale: false,
                    time_range: None,
                },
                query: "你好".into(),
                mode: RetrievalSearchMode::Hybrid,
                limit: 3,
                excluded_hit_ids: Vec::new(),
                char_budget: 6_000,
                token_budget: None,
                adjacent_chunk_count: 0,
                task: crate::rag::contracts::RetrievalTaskStrategy::Continuation,
                index_status: None,
            },
            None,
            Some("Local embedding is not configured".into()),
        )
        .unwrap();
    assert_eq!(response["effectiveMode"], "lexical");
    assert_eq!(response["status"], "degraded_lexical");
    assert_eq!(response["degraded"], true);
    assert_eq!(response["embeddingAvailable"], false);
    assert!(!response["hits"].as_array().unwrap().is_empty());
}

#[test]
fn local_index_job_commits_vectors_and_semantic_search_reads_only_ready_rows() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let chapter = fixture(&mut db);
    db.save_chapter(chapter.clone()).unwrap();
    let fingerprint = current_fingerprint();
    let jobs = db
        .queue_retrieval_index(
            QueueRetrievalIndex {
                book_id: chapter.book_id.clone(),
            },
            &fingerprint,
        )
        .unwrap();
    assert!(!jobs.as_array().unwrap().is_empty());
    while let Some(work) = db.claim_next_retrieval_index_job(&chapter.book_id).unwrap() {
        let mut vector = vec![0.0; DIMENSION];
        vector[0] = 1.0;
        let vectors = vec![vector; work.chunks.len()];
        assert_eq!(
            db.commit_retrieval_index_job(&work, &vectors).unwrap(),
            super::super::retrieval_index::IndexCommitResult::Completed
        );
    }
    let response = db
        .search_retrieval(
            RetrievalSearchRequest {
                freshness_policy: None,
                scope: RetrievalScope {
                    book_id: chapter.book_id.clone(),
                    allowed_source_kinds: vec![
                        crate::rag::contracts::RetrievalSourceKind::Manuscript,
                    ],
                    allowed_chapter_ids: vec![chapter.chapter_id],
                    before_chapter_order: None,
                    before_anchor: None,
                    include_future_plan: false,
                    include_generated: false,
                    include_stale: false,
                    time_range: None,
                },
                query: "任何词都可以".into(),
                mode: RetrievalSearchMode::Hybrid,
                limit: 1,
                excluded_hit_ids: Vec::new(),
                char_budget: 6_000,
                token_budget: None,
                adjacent_chunk_count: 1,
                task: crate::rag::contracts::RetrievalTaskStrategy::Generic,
                index_status: None,
            },
            Some(vec![1.0; DIMENSION]),
            None,
        )
        .unwrap();
    assert_eq!(response["effectiveMode"], "semantic");
    assert_eq!(response["status"], "ready");
    assert_eq!(response["degraded"], false);
    assert_eq!(response["lexicalMatchCount"], 0);
    assert_eq!(response["embeddingAvailable"], true);
    assert_eq!(response["hits"].as_array().unwrap().len(), 1);
    assert!(response["hits"][0]["indexUpdatedAt"].as_i64().is_some());
}
