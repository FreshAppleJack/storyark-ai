use super::*;
use crate::storage::ImportWork;
use std::cell::Cell;

fn sample_work(book_id: &str, title: &str) -> Value {
    let volume_id = Uuid::new_v4().to_string();
    let chapter_id = Uuid::new_v4().to_string();
    let character_id = Uuid::new_v4().to_string();
    let node_a = Uuid::new_v4().to_string();
    let node_b = Uuid::new_v4().to_string();
    let edge_id = Uuid::new_v4().to_string();
    let now = 1_700_000_000_000_i64;
    let note_id = "legacy-note";
    json!({
        "schemaVersion": 1,
        "exportId": Uuid::new_v4(),
        "exportedAt": "2026-09-18T00:00:00.000Z",
        "producer": {"appVersion":"0.1.0","platform":"windows"},
        "snapshot": {"databaseVersion":5,"contentVersion":1},
        "book": {"id":book_id,"title":title,"author":"Writer","status":"serializing","position":0,"isReadOnly":false,"databaseVersion":4,"createdAt":now,"updatedAt":now},
        "volumes": [{"id":volume_id,"bookId":book_id,"title":"Volume 1","status":"draft","position":0,"isReadOnly":false,"databaseVersion":2,"createdAt":now,"updatedAt":now}],
        "chapters": [{
            "id":chapter_id,"bookId":book_id,"volumeId":volume_id,"title":"Chapter 1","status":"draft","position":0,"isReadOnly":false,"wordCount":2,"databaseVersion":3,"createdAt":now,"updatedAt":now,
            "body":{"format":"tiptap-json","version":1,"contentState":"editable","content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"mention","attrs":{"id":character_id,"label":"Alice"},"marks":[{"type":"foreshadowing","attrs":{"id":note_id}}]}]}]}},
            "foreshadowingIds":[note_id]
        }],
        "characters": [{"id":character_id,"bookId":book_id,"name":"Alice","aliases":[],"role":"protagonist","description":"A preserved character","color":"#123456","tags":[],"avatar":null,"handleConfig":null,"isArchived":false,"position":0,"databaseVersion":2,"createdAt":now,"updatedAt":now}],
        "graphs": [{"bookId":book_id,"databaseVersion":2,"createdAt":now,"updatedAt":now,
            "nodes":[{"nodeKey":node_a,"characterId":character_id,"positionX":0.0,"positionY":0.0,"handleConfig":null},{"nodeKey":node_b,"characterId":character_id,"positionX":200.0,"positionY":0.0,"handleConfig":null}],
            "edges":[{"id":edge_id,"sourceNodeKey":node_a,"targetNodeKey":node_b,"sourceHandle":"right-source","targetHandle":"left-target","label":"knows"}]
        }],
        "foreshadowings":[{"id":note_id,"chapterId":chapter_id,"excerpt":"Alice","note":"Return later","databaseVersion":3,"createdAt":now,"updatedAt":now,"unknownField":{"keep":true}}],
        "planning":{"bookId":book_id,"databaseVersion":1,"storySummary":"Summary","storyBackground":"Background","chapterSummaries":[{"chapterId":chapter_id,"summary":"Chapter summary","sourceChapterVersion":3,"updatedAt":now}],"plotSettings":[{"id":"plot-1","title":"Plot","details":"Details","chapterIds":[chapter_id],"missingChapterIds":[],"createdAt":now,"updatedAt":now}]},
        "brainstormWorkspaces":[{"bookId":book_id,"databaseVersion":1,"createdAt":now,"updatedAt":now,"selectedChapterIds":[chapter_id],"contextSnapshot":{"bookId":book_id,"chapterIds":[chapter_id],"selectedChapters":[{"id":chapter_id,"title":"Chapter 1"}],"appearingCharacters":[{"id":character_id,"name":"Alice"}],"relationships":[{"sourceCharacterId":character_id,"targetCharacterId":character_id,"sourceNodeKey":node_a,"targetNodeKey":node_b}]},"generatedOptions":[{"id":"option-1","title":"Option","conflict":"Conflict","motivation":"Motivation","consequences":"Consequences","development":"Development"}],"selectedOptionId":"option-1","finalContent":"Draft"}],
        "assets": []
    })
}

fn import_request(work: Value, mode: &str, expected: Option<i64>) -> ImportWork {
    serde_json::from_value(json!({
        "work": work,
        "mode": mode,
        "expectedTargetDatabaseVersion": expected
    }))
    .unwrap()
}

#[test]
fn fresh_import_persists_the_complete_work_and_copy_rewrites_instance_ids() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let book_id = Uuid::new_v4().to_string();
    let work = sample_work(&book_id, "Book");

    let prepared = db.prepare_work_import(work.clone()).unwrap();
    assert_eq!(prepared["status"], "ready");
    assert_eq!(prepared["nameConflict"], false);
    let imported = db
        .import_work(import_request(work.clone(), "import", None))
        .unwrap();
    assert_eq!(imported["mode"], "import");
    assert_eq!(imported["bookId"], book_id);

    let conflict = db.prepare_work_import(work.clone()).unwrap();
    assert_eq!(conflict["status"], "conflict");
    assert_eq!(conflict["target"]["databaseVersion"], 4);
    let copied = db
        .import_work(import_request(work.clone(), "copy", Some(4)))
        .unwrap();
    let copied_id = copied["bookId"].as_str().unwrap();
    assert_ne!(copied_id, book_id);
    assert_eq!(copied["book"]["title"], "Book (1)");

    let copied_book = db.read_book(copied_id).unwrap();
    assert_eq!(copied_book["chapters"].as_array().unwrap().len(), 1);
    let copied_character: String = db
        .connection
        .query_row(
            "SELECT id FROM characters WHERE book_id=?",
            [copied_id],
            |row| row.get(0),
        )
        .unwrap();
    let copied_chapter: String = db
        .connection
        .query_row(
            "SELECT id FROM chapters WHERE book_id=?",
            [copied_id],
            |row| row.get(0),
        )
        .unwrap();
    let copied_planning = db.read_planning(copied_id).unwrap();
    assert_eq!(copied_planning["bookId"], copied_id);
    assert_eq!(
        copied_planning["chapterSummaries"][0]["chapterId"],
        copied_chapter
    );
    assert_eq!(
        copied_planning["chapterSummaries"][0]["sourceChapterVersion"],
        1
    );
    let copied_node_char: String = db
        .connection
        .query_row(
            "SELECT character_id FROM graph_nodes WHERE book_id=? LIMIT 1",
            [copied_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(copied_node_char, copied_character);
    assert_ne!(
        copied_character,
        work["characters"][0]["id"].as_str().unwrap()
    );
    let copied_note: String = db
        .connection
        .query_row(
            "SELECT json_extract(foreshadowings_json,'$[0].id') FROM chapters WHERE book_id=?",
            [copied_id],
            |row| row.get(0),
        )
        .unwrap();
    let copied_mark: String = db
        .connection
        .query_row(
            "SELECT content FROM chapters WHERE book_id=?",
            [copied_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_ne!(copied_note, "legacy-note");
    assert!(copied_mark.contains(&copied_note));
    let copied_context: String = db
        .connection
        .query_row(
            "SELECT context_snapshot_json FROM brainstorm_workspaces WHERE book_id=?",
            [copied_id],
            |row| row.get(0),
        )
        .unwrap();
    let copied_context: Value = serde_json::from_str(&copied_context).unwrap();
    assert_eq!(copied_context["selectedChapters"][0]["id"], copied_chapter);
    assert_eq!(
        copied_context["appearingCharacters"][0]["id"],
        copied_character
    );
    assert_eq!(
        copied_context["relationships"][0]["sourceCharacterId"],
        copied_character
    );
    assert_ne!(
        copied_context["relationships"][0]["sourceNodeKey"],
        work["graphs"][0]["nodes"][0]["nodeKey"]
    );
    assert_eq!(
        db.connection
            .query_row(
                "SELECT count(*) FROM graph_nodes WHERE book_id=?",
                [copied_id],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        2
    );
}

#[test]
fn replace_requires_the_current_version_and_keeps_the_original_on_conflict() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let book_id = Uuid::new_v4().to_string();
    let work = sample_work(&book_id, "Book");
    db.import_work(import_request(work.clone(), "import", None))
        .unwrap();

    let error = db
        .import_work(import_request(work.clone(), "replace", Some(999)))
        .unwrap_err();
    assert_eq!(error.code, "VERSION_CONFLICT");
    assert_eq!(db.read_book(&book_id).unwrap()["book"]["title"], "Book");

    let replaced = db
        .import_work(import_request(work, "replace", Some(4)))
        .unwrap();
    assert_eq!(replaced["mode"], "replace");
    assert!(replaced["backupFileName"].as_str().is_some());
    let backup_name = replaced["backupFileName"].as_str().unwrap();
    assert!(temp.0.join("backups").join(backup_name).is_file());

    let restore = TempDirectory::new();
    std::fs::create_dir_all(&restore.0).unwrap();
    std::fs::copy(
        temp.0.join("backups").join(backup_name),
        restore.0.join("storyark.sqlite3"),
    )
    .unwrap();
    let mut restored = Database::open(&restore.0).unwrap();
    assert_eq!(
        restored.read_book(&book_id).unwrap()["book"]["title"],
        "Book"
    );
}

#[test]
fn same_title_with_a_different_id_is_a_name_conflict_and_copy_names_are_repeatable() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let first = sample_work(&Uuid::new_v4().to_string(), "Book");
    db.import_work(import_request(first, "import", None))
        .unwrap();
    let second = sample_work(&Uuid::new_v4().to_string(), "Book");
    let prepared = db.prepare_work_import(second.clone()).unwrap();
    assert_eq!(prepared["status"], "ready");
    assert_eq!(prepared["nameConflict"], true);
    assert_eq!(prepared["copyTitle"], "Book (1)");
    db.import_work(import_request(second, "copy", None))
        .unwrap();
    let third = sample_work(&Uuid::new_v4().to_string(), "Book");
    let prepared_third = db.prepare_work_import(third.clone()).unwrap();
    assert_eq!(prepared_third["copyTitle"], "Book (2)");
}

#[test]
fn import_preparation_handles_works_without_optional_aggregates() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let book_id = Uuid::new_v4().to_string();
    let mut work = sample_work(&book_id, "没有头脑风暴");
    work["planning"]["databaseVersion"] = json!(0);
    work["planning"]["chapterSummaries"] = json!([]);
    work["planning"]["plotSettings"] = json!([]);
    work["brainstormWorkspaces"] = json!([]);

    db.import_work(import_request(work.clone(), "import", None))
        .unwrap();
    let prepared = db.prepare_work_import(work).unwrap();

    assert_eq!(prepared["target"]["stats"]["planningSummaries"], 0);
    assert_eq!(prepared["target"]["stats"]["plotSettings"], 0);
    assert_eq!(prepared["target"]["stats"]["brainstormWorkspaces"], 0);
    assert_eq!(prepared["target"]["stats"]["brainstormOptions"], 0);
}

#[test]
fn invalid_import_is_rejected_before_any_target_mutation() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let book_id = Uuid::new_v4().to_string();
    let mut work = sample_work(&book_id, "Book");
    work["chapters"][0]["body"]["content"] =
        json!({"type":"doc","content":[{"type":"not-supported"}]});
    let error = db
        .import_work(import_request(work, "import", None))
        .unwrap_err();
    assert_eq!(error.code, "IMPORT_INVALID");
    assert_eq!(db.list_books().unwrap().as_array().unwrap().len(), 0);
}

#[test]
fn cancellation_before_commit_rolls_back_a_replace() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let book_id = Uuid::new_v4().to_string();
    let original = sample_work(&book_id, "Original");
    db.import_work(import_request(original, "import", None))
        .unwrap();

    let replacement = sample_work(&book_id, "Replacement");
    let checks = Cell::new(0);
    let error = db
        .import_work_with_cancel(import_request(replacement, "replace", Some(4)), || {
            let current = checks.get();
            checks.set(current + 1);
            current >= 4
        })
        .unwrap_err();

    assert_eq!(error.code, "CANCELLED");
    assert_eq!(db.read_book(&book_id).unwrap()["book"]["title"], "Original");
}

#[test]
fn pending_migration_content_preserves_unknown_marks_and_attributes_through_import_and_export() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let book_id = Uuid::new_v4().to_string();
    let mut work = sample_work(&book_id, "潮汐钟楼");
    let character_id = work["characters"][0]["id"].as_str().unwrap().to_owned();
    let note_id = work["foreshadowings"][0]["id"].as_str().unwrap().to_owned();
    work["characters"][0]["name"] = json!("沈舟");
    work["characters"][0]["aliases"] = json!(["舟舟", "守钟人"]);
    work["chapters"][0]["body"]["contentState"] = json!("pending-migration");
    work["chapters"][0]["body"]["content"] = json!({
        "type":"doc",
        "content":[{
            "type":"paragraph",
            "content":[
                {"type":"text","text":"潮声与钟声。","marks":[{"type":"bold"},{"type":"italic"}]},
                {"type":"text","text":"尚未揭开的秘密。","marks":[
                    {"type":"foreshadowing","attrs":{"id":note_id}},
                    {"type":"futureGlow","attrs":{"tone":"琥珀","strength":2}}
                ]},
                {"type":"mention","attrs":{"id":character_id,"label":"沈舟","futureAlias":"守钟人"}}
            ]
        }]
    });

    db.import_work(import_request(work, "import", None))
        .unwrap();
    let loaded = db.read_book(&book_id).unwrap();
    assert_eq!(
        loaded["chapters"][0]["body"]["contentState"],
        "pending-migration"
    );
    let raw = loaded["chapters"][0]["body"]["content"].as_str().unwrap();
    assert!(raw.contains("futureGlow"));
    assert!(raw.contains("futureAlias"));

    let snapshot = db.read_work_export_snapshot(&book_id).unwrap();
    assert_eq!(
        snapshot["chapters"][0]["body"]["contentState"],
        "pending-migration"
    );
    assert!(snapshot["chapters"][0]["body"]["content"]
        .as_str()
        .unwrap()
        .contains("futureGlow"));
}

#[test]
fn same_name_works_with_different_ids_keep_all_references_book_scoped() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let first_id = Uuid::new_v4().to_string();
    let second_id = Uuid::new_v4().to_string();
    let first = sample_work(&first_id, "潮汐钟楼");
    let second = sample_work(&second_id, "潮汐钟楼");
    db.import_work(import_request(first.clone(), "import", None))
        .unwrap();
    db.import_work(import_request(second.clone(), "import", None))
        .unwrap();

    let first_character: String = db
        .connection
        .query_row(
            "SELECT id FROM characters WHERE book_id=?",
            [&first_id],
            |row| row.get(0),
        )
        .unwrap();
    let second_character: String = db
        .connection
        .query_row(
            "SELECT id FROM characters WHERE book_id=?",
            [&second_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_ne!(first_character, second_character);
    for (book_id, character_id) in [
        (&first_id, &first_character),
        (&second_id, &second_character),
    ] {
        let snapshot = db.read_work_export_snapshot(book_id).unwrap();
        assert_eq!(snapshot["book"]["id"], book_id.as_str());
        assert!(snapshot["characters"]
            .as_array()
            .unwrap()
            .iter()
            .all(|character| character["bookId"] == book_id.as_str()));
        assert!(snapshot["graph"]["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .all(|node| node["characterId"] == character_id.as_str()));
        assert_eq!(snapshot["brainstormWorkspace"]["bookId"], book_id.as_str());
    }
}

#[test]
fn an_export_imported_into_an_independent_directory_reopens_as_the_same_snapshot() {
    let source_directory = TempDirectory::new();
    let target_directory = TempDirectory::new();
    let book_id = Uuid::new_v4().to_string();
    let work = sample_work(&book_id, "潮汐钟楼");

    let source_snapshot = {
        let mut source = Database::open(&source_directory.0).unwrap();
        source
            .import_work(import_request(work.clone(), "import", None))
            .unwrap();
        source.read_work_export_snapshot(&book_id).unwrap()
    };

    let target_snapshot = {
        let mut target = Database::open(&target_directory.0).unwrap();
        target
            .import_work(import_request(work, "import", None))
            .unwrap();
        drop(target);
        let mut reopened = Database::open(&target_directory.0).unwrap();
        reopened.read_work_export_snapshot(&book_id).unwrap()
    };

    assert_eq!(target_snapshot, source_snapshot);
}

#[test]
fn an_interrupted_replace_rolls_back_the_transaction_and_keeps_the_original() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let book_id = Uuid::new_v4().to_string();
    db.import_work(import_request(
        sample_work(&book_id, "Original"),
        "import",
        None,
    ))
    .unwrap();

    let checks = Cell::new(0);
    let interrupted = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        db.import_work_with_cancel(
            import_request(sample_work(&book_id, "Interrupted"), "replace", Some(4)),
            || {
                let current = checks.get();
                checks.set(current + 1);
                if current >= 4 {
                    panic!("simulated process interruption");
                }
                false
            },
        )
        .unwrap();
    }));

    assert!(interrupted.is_err());
    assert_eq!(db.read_book(&book_id).unwrap()["book"]["title"], "Original");
    assert_eq!(db.list_books().unwrap().as_array().unwrap().len(), 1);
}

#[test]
fn backup_failure_and_transaction_failure_leave_the_original_work_readable() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let book_id = Uuid::new_v4().to_string();
    db.import_work(import_request(
        sample_work(&book_id, "Original"),
        "import",
        None,
    ))
    .unwrap();

    std::fs::write(temp.0.join("backups"), b"backup directory failure").unwrap();
    let backup_error = db
        .import_work(import_request(
            sample_work(&book_id, "Replacement"),
            "replace",
            Some(4),
        ))
        .unwrap_err();
    assert_eq!(backup_error.code, "BACKUP_FAILED");
    assert_eq!(db.read_book(&book_id).unwrap()["book"]["title"], "Original");
    std::fs::remove_file(temp.0.join("backups")).unwrap();

    db.connection
        .execute_batch(
            "CREATE TRIGGER storyark_test_fail_import BEFORE INSERT ON chapters
             BEGIN SELECT RAISE(ABORT, 'injected import failure'); END;",
        )
        .unwrap();
    let write_error = db
        .import_work(import_request(
            sample_work(&book_id, "Replacement"),
            "replace",
            Some(4),
        ))
        .unwrap_err();
    assert_eq!(write_error.code, "STORAGE_FAILURE");
    assert_eq!(db.read_book(&book_id).unwrap()["book"]["title"], "Original");
    assert_eq!(db.list_books().unwrap().as_array().unwrap().len(), 1);
}
