use super::*;

fn note_input(chapter: &SaveChapter, version: i64) -> UpdateNote {
    UpdateNote {
        book_id: chapter.book_id.clone(),
        chapter_id: chapter.chapter_id.clone(),
        note_id: "legacy-note".into(),
        expected_database_version: version,
        note: Some("Revised note".into()),
        is_recovered: Some(true),
    }
}
fn planning_input(chapter: &SaveChapter, version: i64) -> SavePlanning {
    SavePlanning {
        book_id: chapter.book_id.clone(),
        expected_database_version: version,
        story_summary: "Author overview".into(),
        story_background: "Author world rules".into(),
        chapter_summaries: json!([{ "chapterId":chapter.chapter_id,"summary":"Historical events","updatedAt":2,"sourceChapterVersion":2,"extra":"preserved" }]),
        plot_settings: json!([{ "id":"plot-a","title":"Future plan","details":"Keep this text","chapterIds":[chapter.chapter_id],"createdAt":1,"updatedAt":2,"custom":true }]),
        session_key: "planning-session".into(),
        revision: 7,
    }
}

#[test]
fn notes_patch_only_the_target_and_preserve_body_unknown_fields_and_other_chapters() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let mut first = fixture(&mut db);
    first.foreshadowings.push(json!({"id":"orphan","note":"Unattached","excerpt":"","createdAt":1,"updatedAt":2,"unknown":[1,2]}));
    db.save_chapter(first.clone()).unwrap();
    let other = fixture(&mut db);
    db.save_chapter(other.clone()).unwrap();
    let saved = db.update_note(note_input(&first, 2)).unwrap();
    assert_eq!(saved["body"]["content"], first.content);
    assert_eq!(
        saved["foreshadowings"][0]["extra"],
        first.foreshadowings[0]["extra"]
    );
    assert_eq!(saved["foreshadowings"][1], first.foreshadowings[1]);
    assert_eq!(
        db.read_book(&other.book_id).unwrap()["chapters"][0]["foreshadowings"][0],
        other.foreshadowings[0]
    );
    assert_eq!(
        db.update_note(note_input(&first, 2)).unwrap_err().code,
        "VERSION_CONFLICT"
    );
    let mut wrong = note_input(&first, 3);
    wrong.book_id = other.book_id;
    assert_eq!(
        db.update_note(wrong).unwrap_err().code,
        "OWNERSHIP_MISMATCH"
    );
    db.connection.execute_batch("CREATE TRIGGER fail_note BEFORE UPDATE ON chapters BEGIN SELECT RAISE(ABORT,'test'); END").unwrap();
    assert_eq!(
        db.update_note(note_input(&first, 3)).unwrap_err().code,
        "STORAGE_FAILURE"
    );
    assert_eq!(db.read_book(&first.book_id).unwrap()["chapters"][0], saved);
    drop(db);
    let mut db = Database::open(&temp.0).unwrap();
    assert_eq!(db.read_book(&first.book_id).unwrap()["chapters"][0], saved);
}

#[test]
fn planning_round_trip_retains_order_and_rejects_stale_or_foreign_references() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let chapter = fixture(&mut db);
    db.save_chapter(chapter.clone()).unwrap();
    assert_eq!(
        db.read_planning(&chapter.book_id).unwrap()["databaseVersion"],
        0
    );
    let mut input = planning_input(&chapter, 0);
    input.plot_settings.as_array_mut().unwrap().push(json!({"id":"plot-b","title":"Second","details":"","chapterIds":[],"createdAt":1,"updatedAt":2}));
    let saved = db.save_planning(input).unwrap();
    assert_eq!(saved["revision"], 7);
    assert_eq!(saved["sessionKey"], "planning-session");
    assert_eq!(saved["planning"]["plotSettings"][0]["id"], "plot-a");
    assert_eq!(saved["planning"]["plotSettings"][1]["id"], "plot-b");
    assert_eq!(
        db.save_planning(planning_input(&chapter, 0))
            .unwrap_err()
            .code,
        "VERSION_CONFLICT"
    );
    let other = fixture(&mut db);
    let mut wrong = planning_input(&chapter, 1);
    wrong.plot_settings[0]["chapterIds"] = json!([other.chapter_id]);
    assert_eq!(
        db.save_planning(wrong).unwrap_err().code,
        "OWNERSHIP_MISMATCH"
    );
    let mut newer = chapter.clone();
    newer.expected_database_version = 2;
    newer.content = newer.content.replace("你好", "再见");
    db.save_chapter(newer).unwrap();
    assert_eq!(
        db.read_planning(&chapter.book_id).unwrap()["chapterSummaries"][0]["sourceChapterVersion"],
        2
    );
    drop(db);
    let mut db = Database::open(&temp.0).unwrap();
    assert_eq!(
        db.read_planning(&chapter.book_id).unwrap(),
        saved["planning"]
    );
}

#[test]
fn adopted_summary_provenance_round_trips_and_future_plan_sources_are_rejected() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let chapter = fixture(&mut db);
    db.save_chapter(chapter.clone()).unwrap();
    let chapter_version = 2;
    let body_fingerprint = "0123456789abcdef";
    let mut input = planning_input(&chapter, 0);
    input.chapter_summaries = json!([{
        "chapterId": chapter.chapter_id,
        "summary": "The adopted summary.",
        "sourceChapterVersion": chapter_version,
        "updatedAt": 10,
        "provenance": "ai-adopted",
        "sourceSnapshot": {
            "chapterId": chapter.chapter_id,
            "chapterDatabaseVersion": chapter_version,
            "chapterTitle": "Chapter",
            "contentFormat": "tiptap-json",
            "contentVersion": 1,
            "fingerprintAlgorithm": "fnv1a64-utf16-v1",
            "bodyFingerprint": body_fingerprint,
            "structuredFingerprint": "fedcba9876543210",
            "blockFingerprints": ["fedcba9876543210"],
            "mentionedCharacterIds": [],
            "foreshadowingIds": [],
            "foreshadowingNoteFingerprints": [],
            "capturedAt": 9
        },
        "generationMetadata": {
            "providerId": "provider-a",
            "configId": "00000000-0000-4000-8000-000000000080",
            "protocol": "openai-compatible",
            "modelId": "model-a",
            "generatedAt": 10,
            "promptVersion": "chapter-summary-v1",
            "source": {
                "bookId": chapter.book_id,
                "chapterId": chapter.chapter_id,
                "chapterDatabaseVersion": chapter_version,
                "sourceBodyFingerprint": body_fingerprint,
                "planningDatabaseVersion": null,
                "allowedSources": [],
                "retrievalTrace": null,
                "includesFuturePlan": false
            }
        }
    }]);
    let mut malicious_summaries = input.chapter_summaries.clone();
    let saved = db.save_planning(input).unwrap();
    assert_eq!(
        saved["planning"]["chapterSummaries"][0]["provenance"],
        "ai-adopted"
    );
    assert_eq!(
        saved["planning"]["chapterSummaries"][0]["generationMetadata"]["source"]
            ["sourceBodyFingerprint"],
        body_fingerprint
    );
    assert_eq!(
        db.read_planning(&chapter.book_id).unwrap()["chapterSummaries"][0]["sourceSnapshot"]
            ["chapterDatabaseVersion"],
        chapter_version
    );

    malicious_summaries[0]["generationMetadata"]["source"]["includesFuturePlan"] = json!(true);
    let mut invalid = planning_input(&chapter, 1);
    invalid.chapter_summaries = malicious_summaries;
    assert_eq!(db.save_planning(invalid).unwrap_err().code, "INVALID_INPUT");
}

#[test]
fn deleting_chapters_cleans_live_references_atomically_but_preserves_plot_and_snapshot_text() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let chapter = fixture(&mut db);
    db.save_chapter(chapter.clone()).unwrap();
    let saved = db.save_planning(planning_input(&chapter, 0)).unwrap()["planning"].clone();
    db.connection.execute("INSERT INTO brainstorm_workspaces(book_id,selected_chapter_ids_json,context_snapshot_json,final_content,created_at,updated_at) VALUES (?,?,?,?,1,1)",
        params![chapter.book_id,json!([chapter.chapter_id]).to_string(),json!({"original":"Keep historical evidence"}).to_string(),"Keep draft"]).unwrap();
    let deletion = || Delete {
        target: ExpectedTarget {
            target: Target::Chapter {
                book_id: chapter.book_id.clone(),
                volume_id: chapter.volume_id.clone(),
                chapter_id: chapter.chapter_id.clone(),
            },
            expected_database_version: 2,
        },
        expected_parent_version: Some(2),
    };
    db.connection.execute_batch("CREATE TRIGGER fail_delete BEFORE DELETE ON chapters BEGIN SELECT RAISE(ABORT,'test'); END").unwrap();
    assert!(db.delete(deletion()).is_err());
    assert_eq!(db.read_planning(&chapter.book_id).unwrap(), saved);
    let version: i64 = db
        .connection
        .query_row(
            "SELECT database_version FROM brainstorm_workspaces",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(version, 1);
    db.connection
        .execute_batch("DROP TRIGGER fail_delete")
        .unwrap();
    db.delete(deletion()).unwrap();
    let planning = db.read_planning(&chapter.book_id).unwrap();
    assert_eq!(planning["databaseVersion"], 2);
    assert_eq!(planning["chapterSummaries"], json!([]));
    assert_eq!(planning["plotSettings"][0]["chapterIds"], json!([]));
    assert_eq!(
        planning["plotSettings"][0]["missingChapterIds"],
        json!([chapter.chapter_id])
    );
    assert_eq!(planning["plotSettings"][0]["details"], "Keep this text");
    let (selected,snapshot,final_text,version):(String,String,String,i64) = db.connection.query_row("SELECT selected_chapter_ids_json,context_snapshot_json,final_content,database_version FROM brainstorm_workspaces", [], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).unwrap();
    assert_eq!(selected, "[]");
    assert_eq!(
        serde_json::from_str::<Value>(&snapshot).unwrap()["original"],
        "Keep historical evidence"
    );
    assert_eq!(final_text, "Keep draft");
    assert_eq!(version, 2);
    assert_eq!(
        db.save_planning(planning_input(&chapter, 1))
            .unwrap_err()
            .code,
        "VERSION_CONFLICT"
    );
}

#[test]
fn planning_failure_and_lock_preserve_committed_data() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let chapter = fixture(&mut db);
    db.save_chapter(chapter.clone()).unwrap();
    let saved = db.save_planning(planning_input(&chapter, 0)).unwrap()["planning"].clone();
    db.connection.execute_batch("CREATE TRIGGER fail_planning BEFORE UPDATE ON planning BEGIN SELECT RAISE(ABORT,'test'); END").unwrap();
    assert_eq!(
        db.save_planning(planning_input(&chapter, 1))
            .unwrap_err()
            .code,
        "STORAGE_FAILURE"
    );
    assert_eq!(db.read_planning(&chapter.book_id).unwrap(), saved);
    db.connection
        .execute(
            "UPDATE books SET is_read_only=1 WHERE id=?",
            [&chapter.book_id],
        )
        .unwrap();
    assert_eq!(
        db.save_planning(planning_input(&chapter, 1))
            .unwrap_err()
            .code,
        "READ_ONLY"
    );
    assert_eq!(
        db.update_note(note_input(&chapter, 2)).unwrap_err().code,
        "READ_ONLY"
    );
}
