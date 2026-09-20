use super::*;
use crate::storage::{SaveBrainstorm, SaveGraph, SavePlanning};

#[test]
fn work_export_snapshot_reads_every_owned_aggregate_in_one_boundary() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let chapter = fixture(&mut db);
    db.save_chapter(chapter.clone()).unwrap();

    let book_version = db.read_book(&chapter.book_id).unwrap()["book"]["databaseVersion"]
        .as_i64()
        .unwrap();
    let character = db
        .create_character(
            serde_json::from_value(json!({
                "bookId": chapter.book_id,
                "name": "Alice",
                "role": "protagonist",
                "aliases": ["A"],
                "description": "A preserved character",
                "color": "#123456",
                "tags": ["main"],
                "avatar": null,
                "handleConfig": null,
                "expectedBookVersion": book_version
            }))
            .unwrap(),
        )
        .unwrap()["character"]
        .clone();
    let graph = db.initialize_graph(&chapter.book_id).unwrap();
    let node_a = uuid::Uuid::new_v4().to_string();
    let node_b = uuid::Uuid::new_v4().to_string();
    db.save_graph(
        serde_json::from_value::<SaveGraph>(json!({
            "bookId": chapter.book_id,
            "expectedDatabaseVersion": graph["databaseVersion"],
            "sessionKey": "export-test",
            "revision": 1,
            "nodes": [
                {"nodeKey": node_a, "characterId": character["id"], "positionX": 0, "positionY": 0, "handleConfig": null},
                {"nodeKey": node_b, "characterId": character["id"], "positionX": 1, "positionY": 0, "handleConfig": null}
            ],
            "edges": [{"id": uuid::Uuid::new_v4(), "sourceNodeKey": node_a, "targetNodeKey": node_b,
                "sourceHandle": "right-source", "targetHandle": "left-target", "label": "knows"}]
        }))
        .unwrap(),
    )
    .unwrap();
    db.save_planning(
        serde_json::from_value::<SavePlanning>(json!({
            "bookId": chapter.book_id,
            "expectedDatabaseVersion": 0,
            "storySummary": "Saved summary",
            "storyBackground": "Saved background",
            "chapterSummaries": [{"chapterId": chapter.chapter_id, "summary": "Summary", "sourceChapterVersion": 2, "updatedAt": 2}],
            "plotSettings": [],
            "sessionKey": "export-test",
            "revision": 1
        }))
        .unwrap(),
    )
    .unwrap();
    db.save_brainstorm(SaveBrainstorm {
        book_id: chapter.book_id.clone(),
        expected_database_version: 0,
        selected_chapter_ids: json!([chapter.chapter_id]),
        context_snapshot: json!({"bookId":chapter.book_id,"source":"saved"}),
        generated_options: json!([{"id":"option-a","title":"Direction","conflict":"Conflict","motivation":"Motivation","consequences":"Consequences","development":"Development"}]),
        selected_option_id: Some("option-a".into()),
        final_content: "Human-edited result".into(),
        session_key: "export-test".into(),
        revision: 1,
    })
    .unwrap();

    let snapshot = db.read_work_export_snapshot(&chapter.book_id).unwrap();
    assert_eq!(snapshot["databaseVersion"], 7);
    assert_eq!(snapshot["book"]["id"], chapter.book_id);
    assert_eq!(snapshot["volumes"].as_array().unwrap().len(), 1);
    assert_eq!(snapshot["chapters"].as_array().unwrap().len(), 1);
    assert_eq!(snapshot["characters"].as_array().unwrap().len(), 1);
    assert_eq!(snapshot["graph"]["nodes"].as_array().unwrap().len(), 2);
    assert_eq!(snapshot["graph"]["edges"].as_array().unwrap().len(), 1);
    assert_eq!(snapshot["planning"]["storySummary"], "Saved summary");
    assert_eq!(
        snapshot["brainstormWorkspace"]["finalContent"],
        "Human-edited result"
    );
    assert!(snapshot.get("preferences").is_none());
    assert!(snapshot.get("credentials").is_none());
}

#[test]
fn work_export_snapshot_rejects_a_dangling_foreshadowing_mark() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let chapter = fixture(&mut db);
    db.save_chapter(chapter.clone()).unwrap();
    db.connection
        .execute(
            "UPDATE chapters SET content=? WHERE id=?",
            [
                r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"foreshadowing","attrs":{"id":"missing"}}]}]}]}"#,
                &chapter.chapter_id,
            ],
        )
        .unwrap();
    assert_eq!(
        db.read_work_export_snapshot(&chapter.book_id)
            .unwrap_err()
            .code,
        "CONTENT_INCOMPATIBLE"
    );
}

#[test]
fn work_export_snapshot_rejects_a_canonical_mention_from_another_book() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let chapter = fixture(&mut db);
    db.save_chapter(chapter.clone()).unwrap();
    let foreign_character = uuid::Uuid::new_v4().to_string();
    db.connection
        .execute(
            "UPDATE chapters SET content=? WHERE id=?",
            [
                &format!(
                    r#"{{"type":"doc","content":[{{"type":"paragraph","content":[{{"type":"mention","attrs":{{"id":"{foreign_character}","label":"Foreign"}}}}]}}]}}"#
                ),
                &chapter.chapter_id,
            ],
        )
        .unwrap();
    assert_eq!(
        db.read_work_export_snapshot(&chapter.book_id)
            .unwrap_err()
            .code,
        "CONTENT_INCOMPATIBLE"
    );
}

#[test]
fn work_export_snapshot_reads_locked_work_without_attempting_a_write() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let chapter = fixture(&mut db);
    db.save_chapter(chapter.clone()).unwrap();
    db.connection
        .execute(
            "UPDATE chapters SET is_read_only=1 WHERE id=?",
            [&chapter.chapter_id],
        )
        .unwrap();

    let snapshot = db.read_work_export_snapshot(&chapter.book_id).unwrap();
    assert_eq!(snapshot["book"]["id"], chapter.book_id);
    assert_eq!(snapshot["chapters"][0]["id"], chapter.chapter_id);
    assert_eq!(snapshot["chapters"][0]["isReadOnly"], true);
    assert_eq!(snapshot["chapters"][0]["body"]["format"], "tiptap-json");
}
