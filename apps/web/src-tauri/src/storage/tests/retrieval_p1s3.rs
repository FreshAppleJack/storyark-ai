use super::*;
use crate::rag::contracts::{
    RetrievalScope, RetrievalSearchMode, RetrievalSearchRequest, RetrievalSourceKind,
    RetrievalTaskStrategy,
};
use crate::rag::embeddings::{current_fingerprint, development_model_dir, EmbeddingRuntime};
use crate::storage::QueueRetrievalIndex;
use serde_json::json;
use std::time::Instant;

fn semantic_request(book_id: &str, query: &str) -> RetrievalSearchRequest {
    RetrievalSearchRequest {
        freshness_policy: None,
        scope: RetrievalScope {
            book_id: book_id.to_owned(),
            allowed_source_kinds: vec![RetrievalSourceKind::Manuscript],
            allowed_chapter_ids: Vec::new(),
            before_chapter_order: None,
            before_anchor: None,
            include_future_plan: false,
            include_generated: false,
            include_stale: false,
            time_range: None,
        },
        query: query.to_owned(),
        mode: RetrievalSearchMode::Semantic,
        limit: 8,
        excluded_hit_ids: Vec::new(),
        char_budget: 6_000,
        token_budget: None,
        adjacent_chunk_count: 0,
        task: RetrievalTaskStrategy::Generic,
        index_status: None,
    }
}

#[test]
fn p1s3_records_semantic_score_separation_for_a_no_answer_case() {
    let model_dir = development_model_dir();
    assert!(model_dir.is_dir(), "bundled embedding model is missing");

    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let mut chapter = fixture(&mut db);
    chapter.content = json!({
        "type": "doc",
        "content": [{
            "type": "paragraph",
            "content": [{"type": "text", "text": "林岚在雨夜走到档案室门前。她也叫小岚，旧钥匙在掌心发冷，门后传来微弱的钟声。"}]
        }, {
            "type": "paragraph",
            "content": [{"type": "text", "text": "第二天，林岚用旧钥匙打开档案室，发现父亲留下的记录，跨章事件在这里得到回响。"}]
        }]
    })
    .to_string();
    chapter.word_count = 71;
    db.save_chapter(chapter.clone()).unwrap();

    let runtime = EmbeddingRuntime::with_model_dir(Some(model_dir));
    let fingerprint = current_fingerprint();
    let index_started = Instant::now();
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
        assert_eq!(
            db.commit_retrieval_index_job(&work, &embeddings).unwrap(),
            super::super::retrieval_index::IndexCommitResult::Completed
        );
    }

    let positive_query = "雨夜门扉";
    let positive_vector = runtime
        .with_provider(|provider| provider.embed_query(positive_query))
        .unwrap();
    let positive_query_started = Instant::now();
    let positive = db
        .search_retrieval(
            semantic_request(&chapter.book_id, positive_query),
            Some(positive_vector),
            None,
        )
        .unwrap();
    let negative_query = "海边灯塔的蓝色汽笛";
    let negative_vector = runtime
        .with_provider(|provider| provider.embed_query(negative_query))
        .unwrap();
    let negative_query_started = Instant::now();
    let negative = db
        .search_retrieval(
            semantic_request(&chapter.book_id, negative_query),
            Some(negative_vector),
            None,
        )
        .unwrap();
    assert_eq!(positive["status"], "ready");
    let positive_hits = positive["hits"].as_array().unwrap();
    assert!(!positive_hits.is_empty());
    assert!(positive_hits.first().is_some_and(|hit| {
        hit["bookId"].as_str() == Some(chapter.book_id.as_str())
            && hit["chapterId"].as_str() == Some(chapter.chapter_id.as_str())
    }));
    assert!(positive_hits.iter().all(|hit| {
        hit["sourceVersion"] == hit["chunk"]["sourceVersion"]
            && hit["locator"] == hit["chunk"]["locator"]
            && hit["locator"]["shortQuote"]
                .as_str()
                .is_some_and(|quote| !quote.is_empty())
    }));
    assert_eq!(negative["status"], "no_results");
    assert!(negative["hits"].as_array().unwrap().is_empty());

    eprintln!(
        "P1S3_SCORE {}",
        json!({
            "indexLatencyMs": index_started.elapsed().as_secs_f64() * 1000.0,
            "positiveQueryLatencyMs": positive_query_started.elapsed().as_secs_f64() * 1000.0,
            "negativeQueryLatencyMs": negative_query_started.elapsed().as_secs_f64() * 1000.0,
            "recallAt1": 1.0,
            "citationLocatorCorrectness": 1.0,
            "noAnswerFalseRecall": 0.0,
            "positiveStatus": positive["status"],
            "positiveScores": positive_hits.iter().map(|hit| hit["semanticScore"].clone()).collect::<Vec<_>>(),
            "negativeStatus": negative["status"],
            "negativeScores": negative["hits"].as_array().unwrap().iter().map(|hit| hit["semanticScore"].clone()).collect::<Vec<_>>(),
        })
    );
}
