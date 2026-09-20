use super::*;
use crate::rag::contracts::{RetrievalAnchor, RetrievalScope};
use crate::storage::{ListRetrievalSources, SavePlanning};

fn source<'a>(sources: &'a Value, kind: &str) -> &'a Value {
    sources
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["sourceKind"] == kind)
        .unwrap_or_else(|| panic!("missing source kind {kind}"))
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
        .all(|item| item["sourceKind"] != "manuscript"));

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
            },
        })
        .unwrap();
    assert!(isolated
        .as_array()
        .unwrap()
        .iter()
        .all(|item| item["bookId"] != other.book_id));
}
