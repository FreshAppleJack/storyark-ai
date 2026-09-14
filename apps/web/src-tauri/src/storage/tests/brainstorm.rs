use super::*;
use crate::ai::generation::{GenerationTarget, SourceVersion};
use crate::storage::SaveBrainstorm;

fn input(chapter: &SaveChapter, version: i64) -> SaveBrainstorm {
    SaveBrainstorm {
        book_id: chapter.book_id.clone(),
        expected_database_version: version,
        selected_chapter_ids: json!([chapter.chapter_id]),
        context_snapshot: json!({
            "bookTitle":"Book",
            "selectedChapters":[{"id":chapter.chapter_id,"title":"Chapter","databaseVersion":2}],
            "customOpaque":{"preserved":true}
        }),
        generated_options: json!([{
            "id":"option-a","title":"Direction A","conflict":"Hook","motivation":"Why",
            "consequences":"Cost","development":"Plan","modelTrace":{"kept":"opaque"}
        }]),
        selected_option_id: Some("option-a".into()),
        final_content: "Author-confirmed final direction".into(),
        session_key: "brainstorm-session".into(),
        revision: 5,
    }
}

#[test]
fn brainstorm_round_trip_preserves_opaque_snapshots_options_and_order() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let chapter = fixture(&mut db);
    db.save_chapter(chapter.clone()).unwrap();
    let empty = db.read_brainstorm(&chapter.book_id).unwrap();
    assert_eq!(empty["databaseVersion"], 0);
    assert_eq!(empty["selectedChapterIds"], json!([]));
    let saved = db.save_brainstorm(input(&chapter, 0)).unwrap();
    assert_eq!(saved["sessionKey"], "brainstorm-session");
    assert_eq!(saved["revision"], 5);
    assert_eq!(saved["workspace"]["databaseVersion"], 1);
    assert_eq!(
        saved["workspace"]["contextSnapshot"]["customOpaque"],
        json!({"preserved":true})
    );
    assert_eq!(
        saved["workspace"]["generatedOptions"][0]["modelTrace"],
        json!({"kept":"opaque"})
    );
    drop(db);
    let mut db = Database::open(&temp.0).unwrap();
    let reopened = db.read_brainstorm(&chapter.book_id).unwrap();
    assert_eq!(reopened, saved["workspace"]);
    assert_eq!(reopened["finalContent"], "Author-confirmed final direction");
}

#[test]
fn brainstorm_rejects_stale_writes_foreign_chapters_and_bad_references() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let chapter = fixture(&mut db);
    db.save_chapter(chapter.clone()).unwrap();
    let other = fixture(&mut db);
    db.save_chapter(other.clone()).unwrap();
    db.save_brainstorm(input(&chapter, 0)).unwrap();
    let before = db.read_brainstorm(&chapter.book_id).unwrap();
    for (pointer, value) in [
        ("/expectedDatabaseVersion", json!(0)), // stale first-write claim
        ("/expectedDatabaseVersion", json!(9)), // stale version
        ("/selectedChapterIds/0", json!(other.chapter_id)), // foreign chapter
        ("/selectedOptionId", json!("missing-option")),
        ("/contextSnapshot", json!(["not-an-object"])),
        ("/generatedOptions/0/id", json!("")),
    ] {
        let mut invalid = serde_json::to_value(input(&chapter, 1)).unwrap();
        *invalid.pointer_mut(pointer).unwrap() = value;
        assert!(db
            .save_brainstorm(serde_json::from_value::<SaveBrainstorm>(invalid).unwrap())
            .is_err());
        assert_eq!(db.read_brainstorm(&chapter.book_id).unwrap(), before);
    }
}

#[test]
fn brainstorm_respects_book_locks_and_cascades_with_book_deletion() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let chapter = fixture(&mut db);
    db.save_chapter(chapter.clone()).unwrap();
    db.save_brainstorm(input(&chapter, 0)).unwrap();
    db.connection
        .execute(
            "UPDATE books SET is_read_only=1 WHERE id=?",
            [&chapter.book_id],
        )
        .unwrap();
    assert_eq!(
        db.save_brainstorm(input(&chapter, 1)).unwrap_err().code,
        "READ_ONLY"
    );
    // Deleting the book cascades the workspace row in the same transaction.
    db.connection
        .execute(
            "UPDATE books SET is_read_only=0 WHERE id=?",
            [&chapter.book_id],
        )
        .unwrap();
    let book_version = db.read_book(&chapter.book_id).unwrap()["book"]["databaseVersion"]
        .as_i64()
        .unwrap();
    db.delete(crate::storage::Delete {
        target: crate::storage::ExpectedTarget {
            target: crate::storage::Target::Book {
                book_id: chapter.book_id.clone(),
            },
            expected_database_version: book_version,
        },
        expected_parent_version: None,
    })
    .unwrap();
    assert_eq!(
        db.read_brainstorm(&chapter.book_id).unwrap_err().code,
        "NOT_FOUND"
    );
}

#[test]
fn brainstorm_commands_use_registered_ipc() {
    let temp = TempDirectory::new();
    let storage = Storage::open(&temp.0).unwrap();
    let chapter = {
        let mut db = storage.0.lock().unwrap();
        let chapter = fixture(&mut db);
        db.save_chapter(chapter.clone()).unwrap();
        chapter
    };
    let app = crate::with_storage_commands(tauri::test::mock_builder())
        .manage(storage)
        .build(tauri::generate_context!())
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let empty = super::ipc::ipc(
        &window,
        "local_read_brainstorm",
        json!({"bookId":chapter.book_id}),
    );
    assert_eq!(empty["ok"], true);
    assert_eq!(empty["value"]["databaseVersion"], 0);
    let saved = super::ipc::ipc(
        &window,
        "local_save_brainstorm",
        json!({"input":serde_json::to_value(input(&chapter, 0)).unwrap()}),
    );
    assert_eq!(saved["ok"], true);
    assert_eq!(saved["value"]["workspace"]["databaseVersion"], 1);
    let read = super::ipc::ipc(
        &window,
        "local_read_brainstorm",
        json!({"bookId":chapter.book_id}),
    );
    assert_eq!(read["value"], saved["value"]["workspace"]);
}

#[test]
fn ai_brainstorm_target_freezes_owned_source_versions() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let chapter = fixture(&mut db);
    db.save_chapter(chapter.clone()).unwrap();
    let target = GenerationTarget::Brainstorm {
        workspace_database_version: 0,
        planning_database_version: 0,
        graph_database_version: 0,
        sources: vec![SourceVersion {
            chapter_id: chapter.chapter_id.clone(),
            database_version: 2,
        }],
    };
    assert!(db
        .validate_ai_generation_target(&chapter.book_id, &target)
        .is_ok());

    let mut stale = target.clone();
    if let GenerationTarget::Brainstorm { sources, .. } = &mut stale {
        sources[0].database_version = 3;
    }
    assert_eq!(
        db.validate_ai_generation_target(&chapter.book_id, &stale)
            .unwrap_err()
            .code,
        "CONTEXT_CHANGED"
    );

    let foreign = fixture(&mut db);
    db.save_chapter(foreign.clone()).unwrap();
    let mut wrong_book = target;
    if let GenerationTarget::Brainstorm { sources, .. } = &mut wrong_book {
        sources[0].chapter_id = foreign.chapter_id;
    }
    assert_eq!(
        db.validate_ai_generation_target(&chapter.book_id, &wrong_book)
            .unwrap_err()
            .code,
        "OWNERSHIP_MISMATCH"
    );
}
