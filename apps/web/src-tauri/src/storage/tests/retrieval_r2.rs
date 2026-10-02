use super::*;
use crate::{
    ai::generation::ValidateAiAdoption, rag::contracts::RetrievalSourceVersionRecord,
    storage::SavePlanning,
};

#[test]
fn adoption_rechecks_saved_chapter_version_lock_and_retrieved_source_versions() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let mut chapter = fixture(&mut db);
    db.save_chapter(chapter.clone()).unwrap();
    let source = db
        .sync_retrieval_sources(&chapter.book_id)
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .find(|source| source["sourceKind"] == "manuscript")
        .unwrap()
        .clone();
    let source_version = RetrievalSourceVersionRecord {
        source_id: source["sourceId"].as_str().unwrap().to_owned(),
        chapter_id: Some(chapter.chapter_id.clone()),
        source_version: source["sourceVersion"].as_i64().unwrap(),
        index_version: 1,
    };
    let input = ValidateAiAdoption {
        book_id: chapter.book_id.clone(),
        chapter_id: chapter.chapter_id.clone(),
        database_version: 2,
        planning_database_version: None,
        retrieval_source_versions: vec![source_version.clone()],
    };

    assert_eq!(
        db.validate_ai_adoption(input.clone()).unwrap()["validated"],
        true
    );

    chapter.expected_database_version = 2;
    chapter.content = chapter.content.replace("你好", "再见");
    db.save_chapter(chapter.clone()).unwrap();
    assert_eq!(
        db.validate_ai_adoption(input.clone()).unwrap_err().code,
        "CONTEXT_CHANGED"
    );

    chapter.expected_database_version = 3;
    db.connection
        .execute(
            "UPDATE chapters SET is_read_only=1 WHERE id=?",
            [&chapter.chapter_id],
        )
        .unwrap();
    let mut current = input;
    current.database_version = 3;
    current.retrieval_source_versions[0].source_version += 1;
    assert_eq!(
        db.validate_ai_adoption(current).unwrap_err().code,
        "READ_ONLY"
    );
}

#[test]
fn adoption_rejects_cross_book_retrieval_sources() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let first = fixture(&mut db);
    let second = fixture(&mut db);
    db.save_chapter(first.clone()).unwrap();
    db.save_chapter(second.clone()).unwrap();
    let second_sources = db.sync_retrieval_sources(&second.book_id).unwrap();
    let foreign_source = second_sources
        .as_array()
        .unwrap()
        .iter()
        .find(|source| source["sourceKind"] == "manuscript")
        .unwrap()
        .clone();
    let request = ValidateAiAdoption {
        book_id: first.book_id,
        chapter_id: first.chapter_id,
        database_version: 2,
        planning_database_version: None,
        retrieval_source_versions: vec![RetrievalSourceVersionRecord {
            source_id: foreign_source["sourceId"].as_str().unwrap().to_owned(),
            chapter_id: Some(second.chapter_id),
            source_version: foreign_source["sourceVersion"].as_i64().unwrap(),
            index_version: 1,
        }],
    };
    assert_eq!(
        db.validate_ai_adoption(request).unwrap_err().code,
        "CONTEXT_CHANGED"
    );
}

#[test]
fn summary_adoption_rechecks_the_planning_aggregate_version() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let chapter = fixture(&mut db);
    db.save_chapter(chapter.clone()).unwrap();
    db.save_planning(SavePlanning {
        book_id: chapter.book_id.clone(),
        expected_database_version: 0,
        story_summary: String::new(),
        story_background: String::new(),
        chapter_summaries: json!([]),
        plot_settings: json!([]),
        session_key: "summary-adoption".into(),
        revision: 1,
    })
    .unwrap();
    let adoption = ValidateAiAdoption {
        book_id: chapter.book_id.clone(),
        chapter_id: chapter.chapter_id.clone(),
        database_version: 2,
        planning_database_version: Some(1),
        retrieval_source_versions: Vec::new(),
    };
    assert_eq!(
        db.validate_ai_adoption(adoption.clone()).unwrap()["validated"],
        true
    );

    db.save_planning(SavePlanning {
        book_id: chapter.book_id.clone(),
        expected_database_version: 1,
        story_summary: "Changed in another planning draft".into(),
        story_background: String::new(),
        chapter_summaries: json!([]),
        plot_settings: json!([]),
        session_key: "summary-adoption-other-session".into(),
        revision: 2,
    })
    .unwrap();
    assert_eq!(
        db.validate_ai_adoption(adoption).unwrap_err().code,
        "CONTEXT_CHANGED"
    );
}

#[test]
fn continuation_anchor_keeps_only_chunks_before_the_selected_paragraph() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let mut chapter = fixture(&mut db);
    chapter.content = serde_json::json!({
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "前文。".repeat(220)}]},
            {"type": "paragraph", "content": [{"type": "text", "text": "锚点之后的正文。"}]}
        ]
    })
    .to_string();
    db.save_chapter(chapter.clone()).unwrap();
    db.save_planning(SavePlanning {
        book_id: chapter.book_id.clone(),
        expected_database_version: 0,
        story_summary: String::new(),
        story_background: String::new(),
        chapter_summaries: serde_json::json!([{
            "chapterId": chapter.chapter_id,
            "summary": "锚点之后的正文。后文事件摘要。",
            "sourceChapterVersion": 2,
            "updatedAt": 3
        }]),
        plot_settings: serde_json::json!([]),
        session_key: "retrieval-r2-test".into(),
        revision: 1,
    })
    .unwrap();

    let scope = crate::rag::contracts::RetrievalScope::continue_before(
        chapter.book_id.clone(),
        crate::rag::contracts::RetrievalAnchor {
            chapter_id: chapter.chapter_id.clone(),
            paragraph_ordinal: Some(1),
            text_offset: Some(0),
        },
    );
    let chunks = db
        .list_retrieval_chunks(crate::storage::ListRetrievalChunks { scope })
        .unwrap();
    let chunks = chunks.as_array().unwrap();

    assert!(
        !chunks.is_empty(),
        "the chapter prefix before the anchor remains retrievable"
    );
    assert!(chunks.iter().all(|chunk| {
        chunk["locator"]["paragraphSpans"]
            .as_array()
            .is_some_and(|spans| {
                !spans.is_empty() && spans.iter().all(|span| span["paragraphOrdinal"] == 0)
            })
    }));
    assert!(chunks.iter().all(|chunk| {
        !chunk["sourceText"]
            .as_str()
            .unwrap_or_default()
            .contains("锚点之后的正文")
    }));
    assert!(chunks.iter().all(|chunk| {
        !chunk["sourceId"]
            .as_str()
            .unwrap_or_default()
            .contains(":chapter_summary:")
    }));
}
