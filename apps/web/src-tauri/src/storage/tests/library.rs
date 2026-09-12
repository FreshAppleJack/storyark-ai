use super::*;

#[test]
fn disk_reopen_preserves_full_snapshot_and_identity() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let input = fixture(&mut db);
    let saved = db.save_chapter(input.clone()).unwrap();
    assert_eq!(saved["revision"], 7);
    assert_eq!(saved["sessionKey"], "editor-session-1");
    assert_eq!(saved["chapter"]["databaseVersion"], 2);
    drop(db);
    let mut reopened = Database::open(&temp.0).unwrap();
    let loaded = reopened.read_book(&input.book_id).unwrap();
    assert_eq!(loaded["chapters"][0], saved["chapter"]);
    assert_eq!(loaded["chapters"][0]["body"]["content"], input.content);
    assert_eq!(
        loaded["chapters"][0]["foreshadowings"],
        json!(input.foreshadowings)
    );
}

#[test]
fn two_connections_reject_stale_saves_and_parent_versions() {
    let temp = TempDirectory::new();
    let mut first = Database::open(&temp.0).unwrap();
    let input = fixture(&mut first);
    let mut second = Database::open(&temp.0).unwrap();
    first.save_chapter(input.clone()).unwrap();
    let error = second.save_chapter(input.clone()).unwrap_err();
    assert_eq!(error.code, "VERSION_CONFLICT");
    assert_eq!(error.current_database_version, Some(2));
    assert_eq!(
        second
            .create_chapter(CreateChapter {
                book_id: input.book_id.clone(),
                volume_id: input.volume_id.clone(),
                title: "Stale".into(),
                expected_volume_version: 1
            })
            .unwrap_err()
            .code,
        "VERSION_CONFLICT"
    );
    assert_eq!(
        second.read_book(&input.book_id).unwrap()["chapters"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn ownership_missing_records_and_locks_have_distinct_results() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let input = fixture(&mut db);
    let other = db
        .create_book(CreateBook {
            title: "Other".into(),
            author: "".into(),
            cover_color: "".into(),
        })
        .unwrap();
    let mut wrong = input.clone();
    wrong.book_id = other["id"].as_str().unwrap().into();
    assert_eq!(
        db.save_chapter(wrong).unwrap_err().code,
        "OWNERSHIP_MISMATCH"
    );
    let mut missing = input.clone();
    missing.chapter_id = Uuid::new_v4().to_string();
    assert_eq!(db.save_chapter(missing).unwrap_err().code, "NOT_FOUND");
    db.connection
        .execute(
            "UPDATE books SET is_read_only=1 WHERE id=?",
            [&input.book_id],
        )
        .unwrap();
    assert_eq!(
        db.save_chapter(input.clone()).unwrap_err().code,
        "READ_ONLY"
    );
    assert_eq!(
        db.read_book(&input.book_id).unwrap()["chapters"][0]["databaseVersion"],
        1
    );
}

#[test]
fn trigger_failure_rolls_back_snapshot_and_creation() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let input = fixture(&mut db);
    let before = db.read_book(&input.book_id).unwrap();
    db.connection.execute_batch("CREATE TRIGGER fail_save AFTER UPDATE ON chapters BEGIN SELECT RAISE(ABORT,'injected failure'); END;").unwrap();
    assert_eq!(
        db.save_chapter(input.clone()).unwrap_err().code,
        "STORAGE_FAILURE"
    );
    assert_eq!(db.read_book(&input.book_id).unwrap(), before);
    db.connection.execute_batch("CREATE TRIGGER fail_parent BEFORE UPDATE ON volumes BEGIN SELECT RAISE(ABORT,'injected failure'); END;").unwrap();
    assert_eq!(
        db.create_chapter(CreateChapter {
            book_id: input.book_id.clone(),
            volume_id: input.volume_id.clone(),
            title: "Rollback".into(),
            expected_volume_version: 2
        })
        .unwrap_err()
        .code,
        "STORAGE_FAILURE"
    );
    assert_eq!(db.read_book(&input.book_id).unwrap(), before);
}

#[test]
fn invalid_or_unknown_content_never_overwrites_the_original() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let input = fixture(&mut db);
    for raw in [
        "",
        "{broken",
        "null",
        "[]",
        "<p>Old HTML</p>",
        r#"{"type":"doc","content":[{"type":"unknown"}]}"#,
        r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"futureMark"}]}]}]}"#,
    ] {
        let mut bad = input.clone();
        bad.content = raw.into();
        assert_eq!(
            db.save_chapter(bad).unwrap_err().code,
            "CONTENT_INCOMPATIBLE"
        );
    }
    db.connection.execute("UPDATE chapters SET content_format='legacy-html',content_version=0,content='<p>Old</p>',original_content='<p>Old</p>',original_format='legacy-html' WHERE id=?",[&input.chapter_id]).unwrap();
    assert_eq!(
        db.save_chapter(input.clone()).unwrap_err().code,
        "CONTENT_INCOMPATIBLE"
    );
    assert_eq!(
        db.read_book(&input.book_id).unwrap()["chapters"][0]["body"]["originalContent"],
        "<p>Old</p>"
    );
}
