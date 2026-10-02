use super::*;
use crate::rag::{
    contracts::{
        RetrievalAnchor, RetrievalFreshnessPolicy, RetrievalScope, RetrievalSearchMode,
        RetrievalSearchRequest, RetrievalSourceKind, RetrievalTaskStrategy,
    },
    embeddings::{current_fingerprint, development_model_dir, EmbeddingRuntime},
};
use crate::storage::{
    CharacterInput, CreateChapter, CreateCharacter, QueueRetrievalIndex, SavePlanning,
};
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

fn sample_text(id: &str) -> String {
    let sample: Value =
        serde_json::from_str(include_str!("../../rag/tests/p1_e_samples.json")).unwrap();
    sample["documents"]
        .as_array()
        .unwrap()
        .iter()
        .find(|document| document["id"] == id)
        .unwrap_or_else(|| panic!("missing fixed sample document {id}"))["text"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn tiptap_document(paragraphs: &[String]) -> String {
    json!({
        "type": "doc",
        "content": paragraphs.iter().map(|text| json!({
            "type": "paragraph",
            "content": [{"type": "text", "text": text}],
        })).collect::<Vec<_>>(),
    })
    .to_string()
}

fn allowed_kinds() -> Vec<RetrievalSourceKind> {
    vec![
        RetrievalSourceKind::Manuscript,
        RetrievalSourceKind::ChapterSummary,
        RetrievalSourceKind::Planning,
        RetrievalSourceKind::ConfirmedSetting,
        RetrievalSourceKind::Character,
        RetrievalSourceKind::Relationship,
        RetrievalSourceKind::ForeshadowingNote,
    ]
}

fn search(
    db: &mut Database,
    runtime: &EmbeddingRuntime,
    scope: RetrievalScope,
    query: &str,
    task: RetrievalTaskStrategy,
) -> Value {
    let query_vector = runtime
        .with_provider(|provider| provider.embed_query(query))
        .unwrap();
    db.search_retrieval(
        RetrievalSearchRequest {
            freshness_policy: Some(RetrievalFreshnessPolicy {
                fresh_only: true,
                allow_lexical_fallback: true,
                max_wait_ms: 0,
            }),
            scope,
            query: query.to_owned(),
            mode: RetrievalSearchMode::Hybrid,
            limit: 8,
            excluded_hit_ids: Vec::new(),
            char_budget: 8_000,
            token_budget: Some(2_000),
            adjacent_chunk_count: 0,
            task,
            index_status: None,
        },
        Some(query_vector),
        None,
    )
    .unwrap()
}

fn hit_matches(
    response: &Value,
    kind: &str,
    entity_id: Option<&str>,
    chapter_id: Option<&str>,
) -> bool {
    response["hits"].as_array().unwrap().iter().any(|hit| {
        hit["sourceKind"] == kind
            && entity_id.is_none_or(|expected| hit["entityId"] == expected)
            && chapter_id.is_none_or(|expected| hit["chapterId"] == expected)
    })
}

fn hit_summary(response: &Value) -> Vec<Value> {
    response["hits"]
        .as_array()
        .unwrap()
        .iter()
        .map(|hit| {
            json!({
                "sourceKind": hit["sourceKind"],
                "entityId": hit["entityId"],
                "chapterId": hit["chapterId"],
                "sourceVersion": hit["sourceVersion"],
                "freshness": hit["freshness"],
                "recallMethods": hit["recallMethods"],
                "score": hit["score"],
                "semanticScore": hit["semanticScore"],
                "lexicalScore": hit["lexicalScore"],
            })
        })
        .collect()
}

fn contains_forbidden_text(response: &Value, text: &str) -> bool {
    response["hits"].as_array().unwrap().iter().any(|hit| {
        hit["chunk"]["sourceText"]
            .as_str()
            .is_some_and(|source_text| source_text.contains(text))
    })
}

#[test]
fn fixed_sample_continue_and_brainstorm_obey_their_distinct_source_ranges() {
    let model_dir = development_model_dir();
    assert!(model_dir.is_dir(), "bundled embedding model is missing");
    let runtime = EmbeddingRuntime::with_model_dir(Some(model_dir));
    let fingerprint = current_fingerprint();
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();

    let mut previous = fixture(&mut db);
    let chapter_one_text = sample_text("chapter-1");
    let prior_event_text = sample_text("chapter-2");
    previous.title = "雨夜门扉".into();
    previous.content = tiptap_document(&[chapter_one_text, prior_event_text]);
    previous.word_count = 64;
    db.save_chapter(previous.clone()).unwrap();

    let volume_version = db
        .connection
        .query_row(
            "SELECT database_version FROM volumes WHERE id=?",
            [&previous.volume_id],
            |row| row.get::<_, i64>(0),
        )
        .unwrap();
    let current_record = db
        .create_chapter(CreateChapter {
            book_id: previous.book_id.clone(),
            volume_id: previous.volume_id.clone(),
            title: "续章".into(),
            expected_volume_version: volume_version,
        })
        .unwrap();
    let current_chapter_id = current_record["chapter"]["id"].as_str().unwrap().to_owned();
    let after_anchor_text = "锚点之后的事实：海边灯塔的蓝色汽笛突然响起。".to_owned();
    db.save_chapter(crate::storage::SaveChapter {
        book_id: previous.book_id.clone(),
        volume_id: previous.volume_id.clone(),
        chapter_id: current_chapter_id.clone(),
        expected_database_version: 1,
        session_key: "p1-r4-current-chapter".into(),
        revision: 1,
        title: "续章".into(),
        content_format: "tiptap-json".into(),
        content_version: 1,
        content: tiptap_document(&[
            "林岚在新章开头回想旧钥匙。".into(),
            after_anchor_text.clone(),
        ]),
        word_count: 20,
        foreshadowings: Vec::new(),
    })
    .unwrap();

    let character_name = sample_text("character-lan");
    let book_version = db.read_book(&previous.book_id).unwrap()["book"]["databaseVersion"]
        .as_i64()
        .unwrap();
    db.create_character(CreateCharacter {
        character: CharacterInput {
            book_id: previous.book_id.clone(),
            name: "林岚".into(),
            role: "protagonist".into(),
            aliases: vec!["小岚".into()],
            description: character_name,
            color: "#3b82f6".into(),
            tags: vec!["主线".into()],
            avatar: None,
            handle_config: None,
        },
        expected_book_version: book_version,
    })
    .unwrap();

    let setting_text = sample_text("confirmed-setting");
    let future_plan_text = sample_text("future-plot");
    let stale_summary_text = sample_text("chapter-1-summary");
    db.save_planning(SavePlanning {
        book_id: previous.book_id.clone(),
        expected_database_version: 0,
        story_summary: "林岚在雨夜走到档案室门前。".into(),
        story_background: setting_text,
        chapter_summaries: json!([{
            "chapterId": previous.chapter_id,
            "summary": stale_summary_text,
            "sourceChapterVersion": 1,
            "updatedAt": 2
        }]),
        plot_settings: json!([{
            "id": "future-plot",
            "title": "未来计划",
            "details": future_plan_text,
            "chapterIds": [previous.chapter_id, current_chapter_id],
            "createdAt": 1,
            "updatedAt": 2
        }]),
        session_key: "p1-r4-planning".into(),
        revision: 1,
    })
    .unwrap();

    db.queue_retrieval_index(
        QueueRetrievalIndex {
            book_id: previous.book_id.clone(),
        },
        &fingerprint,
    )
    .unwrap();
    while let Some(work) = db
        .claim_next_retrieval_index_job(&previous.book_id)
        .unwrap()
    {
        let texts = work
            .chunks
            .iter()
            .map(|chunk| chunk.index_text.clone())
            .collect::<Vec<_>>();
        let vectors = runtime
            .with_provider(|provider| provider.embed_documents(&texts))
            .unwrap();
        db.commit_retrieval_index_job(&work, &vectors).unwrap();
    }

    let continue_scope = RetrievalScope {
        before_chapter_order: Some(1),
        ..RetrievalScope::continue_before(
            previous.book_id.clone(),
            RetrievalAnchor {
                chapter_id: current_chapter_id.clone(),
                paragraph_ordinal: Some(1),
                text_offset: Some(0),
            },
        )
    };
    let brainstorm_scope = RetrievalScope {
        book_id: previous.book_id.clone(),
        allowed_source_kinds: allowed_kinds(),
        allowed_chapter_ids: vec![previous.chapter_id.clone()],
        before_chapter_order: None,
        before_anchor: None,
        include_future_plan: false,
        include_generated: false,
        include_stale: false,
        time_range: None,
    };

    let queries = [
        ("character name / alias", "小岚", "character", None, None),
        (
            "confirmed setting",
            "档案门只能在雨夜开启",
            "planning",
            Some("story-background"),
            None,
        ),
        (
            "previously written event",
            "旧钥匙打开档案室",
            "manuscript",
            None,
            Some(previous.chapter_id.as_str()),
        ),
    ];
    let mut continue_results = serde_json::Map::new();
    let mut brainstorm_results = serde_json::Map::new();
    for (case, query, kind, entity_id, chapter_id) in queries {
        let continuation = search(
            &mut db,
            &runtime,
            continue_scope.clone(),
            query,
            RetrievalTaskStrategy::Continuation,
        );
        assert!(
            hit_matches(&continuation, kind, entity_id, chapter_id),
            "Continue failed fixed sample case: {case}; response={continuation}"
        );
        continue_results.insert(
            case.into(),
            json!({
                "query": query,
                "hits": hit_summary(&continuation),
            }),
        );

        let brainstorm = search(
            &mut db,
            &runtime,
            brainstorm_scope.clone(),
            query,
            RetrievalTaskStrategy::Brainstorm,
        );
        assert!(
            hit_matches(&brainstorm, kind, entity_id, chapter_id),
            "Brainstorm failed fixed sample case: {case}; response={brainstorm}"
        );
        brainstorm_results.insert(
            case.into(),
            json!({
                "query": query,
                "hits": hit_summary(&brainstorm),
            }),
        );
    }

    let after_anchor = search(
        &mut db,
        &runtime,
        continue_scope.clone(),
        "海边灯塔的蓝色汽笛",
        RetrievalTaskStrategy::Continuation,
    );
    let continue_after_anchor_leak = after_anchor["hits"]
        .as_array()
        .unwrap()
        .iter()
        .any(|hit| hit["sourceKind"] == "manuscript" && hit["chapterId"] == current_chapter_id)
        || contains_forbidden_text(&after_anchor, &after_anchor_text);
    assert!(
        !continue_after_anchor_leak,
        "Continue leaked text after the insertion anchor: {after_anchor}"
    );
    let unselected_later_chapter = search(
        &mut db,
        &runtime,
        brainstorm_scope.clone(),
        "海边灯塔的蓝色汽笛",
        RetrievalTaskStrategy::Brainstorm,
    );
    let brainstorm_unselected_chapter_leak = unselected_later_chapter["hits"]
        .as_array()
        .unwrap()
        .iter()
        .any(|hit| hit["sourceKind"] == "manuscript" && hit["chapterId"] == current_chapter_id)
        || contains_forbidden_text(&unselected_later_chapter, &after_anchor_text);
    assert!(
        !brainstorm_unselected_chapter_leak,
        "Brainstorm leaked an unselected later chapter: {unselected_later_chapter}"
    );

    let future_query = "尚未发生的地下室停电";
    let mut future_hits = serde_json::Map::new();
    for (name, scope, task) in [
        (
            "continue",
            continue_scope.clone(),
            RetrievalTaskStrategy::Continuation,
        ),
        (
            "brainstorm",
            brainstorm_scope.clone(),
            RetrievalTaskStrategy::Brainstorm,
        ),
    ] {
        let response = search(&mut db, &runtime, scope, future_query, task);
        assert!(
            response["hits"].as_array().unwrap().iter().all(|hit| {
                hit["sourceKind"] != "future_plan"
                    && !contains_forbidden_text(&json!({"hits": [hit]}), &future_plan_text)
            }),
            "retrieval leaked an unoccurred future plan to {name}: {response}"
        );
        future_hits.insert(
            name.into(),
            json!({
                "status": response["status"],
                "hits": hit_summary(&response),
                "notTargetedHitCount": response["hits"].as_array().unwrap().len(),
            }),
        );
    }

    let stale_query = "旧概括中的失踪钟声";
    let mut stale_hits = serde_json::Map::new();
    for (name, scope, task) in [
        (
            "continue",
            continue_scope.clone(),
            RetrievalTaskStrategy::Continuation,
        ),
        (
            "brainstorm",
            brainstorm_scope.clone(),
            RetrievalTaskStrategy::Brainstorm,
        ),
    ] {
        let response = search(&mut db, &runtime, scope, stale_query, task);
        assert!(
            response["hits"].as_array().unwrap().iter().all(|hit| {
                hit["freshness"] == "fresh"
                    && !contains_forbidden_text(&json!({"hits": [hit]}), &stale_summary_text)
            }),
            "retrieval leaked an expired summary to {name}: {response}"
        );
        stale_hits.insert(
            name.into(),
            json!({
                "status": response["status"],
                "hits": hit_summary(&response),
                "notTargetedHitCount": response["hits"].as_array().unwrap().len(),
            }),
        );
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    eprintln!(
        "P1R4_RETRIEVAL_ONLY {}",
        json!({
            "timestampUtc": timestamp,
            "platform": std::env::consts::OS,
            "embeddingProvider": "fastembed-rs",
            "embeddingModelId": "intfloat/multilingual-e5-small",
            "generationService": "not invoked",
            "generationProtocol": "not applicable; live provider/CDP acceptance skipped by user instruction",
            "generationModelId": "not observed; no generation request made",
            "sample": "p1_e_samples.json v1 with a confirmed-setting case",
            "continueSourceScope": continue_scope,
            "brainstormSourceScope": brainstorm_scope,
            "continueHits": continue_results,
            "brainstormHits": brainstorm_results,
            "continueAfterAnchorQuery": {
                "hits": hit_summary(&after_anchor),
                "notTargetedHitCount": after_anchor["hits"].as_array().unwrap().len(),
                "forbiddenManuscriptLeak": continue_after_anchor_leak,
            },
            "brainstormUnselectedLaterChapterQuery": {
                "hits": hit_summary(&unselected_later_chapter),
                "notTargetedHitCount": unselected_later_chapter["hits"].as_array().unwrap().len(),
                "forbiddenManuscriptLeak": brainstorm_unselected_chapter_leak,
            },
            "futurePlanQueries": future_hits,
            "staleSummaryQueries": stale_hits,
            "checks": {
                "continueAfterAnchorBoundaryPassed": !continue_after_anchor_leak,
                "unselectedBrainstormChapterBoundaryPassed": !brainstorm_unselected_chapter_leak,
                "futurePlanLeak": false,
                "staleSourceLeak": false,
            },
        })
    );
}
