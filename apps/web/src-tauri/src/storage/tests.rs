use super::*;

fn ipc(
    window: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    command: &str,
    body: Value,
) -> Value {
    tauri::test::get_ipc_response(
        window,
        tauri::webview::InvokeRequest {
            cmd: command.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "http://tauri.localhost".parse().unwrap(),
            body: tauri::ipc::InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.into(),
        },
    )
    .unwrap()
    .deserialize()
    .unwrap()
}

#[test]
fn tauri_ipc_creates_saves_and_reads_after_reopening_the_database() {
    let temp = TempDirectory::new();
    let build = || {
        crate::with_storage_commands(tauri::test::mock_builder())
            .manage(Storage::open(&temp.0).unwrap())
            .build(tauri::generate_context!())
            .unwrap()
    };
    let app = build();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let book = ipc(
        &window,
        "local_create_book",
        json!({"input":{"title":"IPC Book","author":"Writer"}}),
    );
    assert_eq!(book["ok"], true);
    let book_id = book["value"]["id"].clone();
    let volume = ipc(
        &window,
        "local_create_volume",
        json!({"input":{"bookId":book_id,"title":"Volume","expectedBookVersion":1}}),
    );
    assert_eq!(volume["ok"], true);
    let volume_id = volume["value"]["volume"]["id"].clone();
    let chapter = ipc(
        &window,
        "local_create_chapter",
        json!({"input":{"bookId":book_id,"volumeId":volume_id,"title":"Chapter","expectedVolumeVersion":1}}),
    );
    assert_eq!(chapter["ok"], true);
    let raw=json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"你好","marks":[{"type":"bold"},{"type":"foreshadowing","attrs":{"id":"note-1"}}]}]}]}).to_string();
    let saved = ipc(
        &window,
        "local_save_chapter",
        json!({"input":{
            "bookId":book_id,"volumeId":volume_id,"chapterId":chapter["value"]["chapter"]["id"],
            "expectedDatabaseVersion":1,"sessionKey":"ipc-session","revision":3,"title":"Saved",
            "contentFormat":"tiptap-json","contentVersion":1,"content":raw,"wordCount":2,
            "foreshadowings":[{"id":"note-1","excerpt":"你好","note":"Keep","createdAt":1,"updatedAt":1}]
        }}),
    );
    assert_eq!(saved["ok"], true);
    drop(window);
    drop(app);
    let reopened = build();
    let window = tauri::WebviewWindowBuilder::new(&reopened, "main", Default::default())
        .build()
        .unwrap();
    let loaded = ipc(&window, "local_read_book", json!({"bookId":book_id}));
    assert_eq!(loaded["value"]["chapters"][0], saved["value"]["chapter"]);
    let other = tauri::WebviewWindowBuilder::new(&reopened, "untrusted", Default::default())
        .build()
        .unwrap();
    assert!(tauri::test::get_ipc_response(
        &other,
        tauri::webview::InvokeRequest {
            cmd: "local_list_books".into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "http://tauri.localhost".parse().unwrap(),
            body: tauri::ipc::InvokeBody::Json(json!({})),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.into(),
        }
    )
    .is_err());
}

struct TempDirectory(PathBuf);
impl TempDirectory {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!("storyark-storage-test-{}", Uuid::new_v4())))
    }
}
impl Drop for TempDirectory {
    fn drop(&mut self) {
        // Only remove the unique test directory created under the OS temp root.
        if self.0.parent() == Some(std::env::temp_dir().as_path())
            && self
                .0
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("storyark-storage-test-")
        {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}
fn fixture(db: &mut Database) -> SaveChapter {
    let book = db
        .create_book(CreateBook {
            title: "Book".into(),
            author: "Writer".into(),
        })
        .unwrap();
    let book_id = book["id"].as_str().unwrap().to_string();
    let volume = db
        .create_volume(CreateVolume {
            book_id: book_id.clone(),
            title: "Volume".into(),
            expected_book_version: 1,
        })
        .unwrap();
    let volume_id = volume["volume"]["id"].as_str().unwrap().to_string();
    let chapter = db
        .create_chapter(CreateChapter {
            book_id: book_id.clone(),
            volume_id: volume_id.clone(),
            title: "Chapter".into(),
            expected_volume_version: 1,
        })
        .unwrap();
    SaveChapter {
        book_id,volume_id,chapter_id:chapter["chapter"]["id"].as_str().unwrap().into(),
        expected_database_version:1,session_key:"editor-session-1".into(),revision:7,
        title:"New title".into(),content_format:"tiptap-json".into(),content_version:1,
        content:json!({"type":"doc","content":[{"type":"paragraph","attrs":{"textAlign":"left"},"content":[
            {"type":"text","text":"你好，世界。","marks":[{"type":"bold"}]},
            {"type":"mention","attrs":{"id":"legacy-character","label":"Alice","color":"#123456"},"marks":[{"type":"foreshadowing","attrs":{"id":"legacy-note"}}]}
        ]}]}).to_string(),word_count:9,
        foreshadowings:vec![json!({"id":"legacy-note","excerpt":"Alice","note":"Return later","createdAt":1,"updatedAt":2,"extra":{"preserve":true}})],
    }
}

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

#[test]
fn backup_restores_committed_wal_content_to_a_separate_directory() {
    let temp = TempDirectory::new();
    let restore = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let input = fixture(&mut db);
    db.save_chapter(input.clone()).unwrap();
    let backup = db.backup().unwrap();
    std::fs::create_dir_all(&restore.0).unwrap();
    std::fs::copy(
        temp.0
            .join("backups")
            .join(backup["fileName"].as_str().unwrap()),
        restore.0.join("storyark.sqlite3"),
    )
    .unwrap();
    let mut restored = Database::open(&restore.0).unwrap();
    assert_eq!(
        restored.read_book(&input.book_id).unwrap(),
        db.read_book(&input.book_id).unwrap()
    );
}

#[test]
fn future_unversioned_and_corrupt_databases_are_not_reset() {
    for scenario in ["future", "unversioned", "corrupt"] {
        let temp = TempDirectory::new();
        std::fs::create_dir_all(&temp.0).unwrap();
        let path = temp.0.join("storyark.sqlite3");
        if scenario == "corrupt" {
            std::fs::write(&path, b"not a database").unwrap();
        } else {
            let db = Connection::open(&path).unwrap();
            db.execute_batch(
                "CREATE TABLE precious(value TEXT); INSERT INTO precious VALUES ('keep');",
            )
            .unwrap();
            if scenario == "future" {
                db.pragma_update(None, "user_version", 99).unwrap();
            }
        }
        let before = std::fs::read(&path).unwrap();
        assert!(Database::open(&temp.0).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }
}

/// Builds a real version-1 database with rich library data, bypassing
/// `Database::open` so no upgrade runs. Returns the fixture ids.
fn seed_v1_database(directory: &Path) -> (String, String, String) {
    std::fs::create_dir_all(directory).unwrap();
    let connection = Connection::open(directory.join("storyark.sqlite3")).unwrap();
    connection
        .pragma_update(None, "foreign_keys", true)
        .unwrap();
    connection.execute_batch(MIGRATION_0001).unwrap();
    connection.pragma_update(None, "user_version", 1).unwrap();
    let book_id = Uuid::new_v4().to_string();
    let volume_id = Uuid::new_v4().to_string();
    let chapter_id = Uuid::new_v4().to_string();
    let content = json!({"type":"doc","content":[{"type":"paragraph","content":[
        {"type":"text","text":"旧正文","marks":[{"type":"bold"}]},
        {"type":"mention","attrs":{"id":"legacy-character","label":"旧人物","color":"#123456","futureField":{"nested":true}},"marks":[{"type":"foreshadowing","attrs":{"id":"legacy-note"}}]}
    ]}]}).to_string();
    let notes = json!([{"id":"legacy-note","excerpt":"旧人物","note":"回收","createdAt":1,"updatedAt":2,"unknownField":{"keep":true}}]).to_string();
    connection.execute("INSERT INTO books(id,title,author,position,is_read_only,database_version,created_at,updated_at) VALUES (?,'旧书','作者',0,0,2,100,200)", [&book_id]).unwrap();
    connection.execute("INSERT INTO volumes(id,book_id,title,position,database_version,created_at,updated_at) VALUES (?,?,'旧卷',0,3,100,200)", params![volume_id, book_id]).unwrap();
    connection.execute("INSERT INTO chapters(id,book_id,volume_id,title,position,content_format,content_version,content,original_content,original_format,foreshadowings_json,is_read_only,database_version,created_at,updated_at) VALUES (?,?,?,'旧章',0,'legacy-html',0,?,?,'legacy-html',?,1,4,100,200)", params![chapter_id, book_id, volume_id, content, "<p>原始旧文</p>", notes]).unwrap();
    (book_id, volume_id, chapter_id)
}

#[test]
fn upgrade_from_v1_preserves_work_data_and_creates_a_prior_backup() {
    let temp = TempDirectory::new();
    let (book_id, _, chapter_id) = seed_v1_database(&temp.0);
    let mut db = Database::open(&temp.0).unwrap();
    let version: i64 = db
        .connection
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(version, 2);
    let loaded = db.read_book(&book_id).unwrap();
    let chapter = &loaded["chapters"][0];
    // Content, original recovery copy, ids, unknown note fields and the lock
    // state all survive the upgrade untouched.
    assert_eq!(chapter["id"], json!(chapter_id));
    assert_eq!(chapter["isReadOnly"], true);
    assert_eq!(chapter["databaseVersion"], 4);
    assert_eq!(chapter["body"]["format"], "legacy-html");
    assert_eq!(chapter["body"]["originalContent"], "<p>原始旧文</p>");
    assert!(chapter["body"]["content"]
        .as_str()
        .unwrap()
        .contains("futureField"));
    assert_eq!(
        chapter["foreshadowings"][0]["unknownField"],
        json!({"keep": true})
    );
    // The new stage tables exist and are empty for an upgraded library.
    for table in [
        "characters",
        "graphs",
        "graph_nodes",
        "graph_edges",
        "planning",
        "application_preferences",
        "brainstorm_workspaces",
    ] {
        let count: i64 = db
            .connection
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0, "table {table} should start empty");
    }
    // A consistent pre-upgrade backup exists and still reads as version 1.
    let backups = std::fs::read_dir(temp.0.join("backups"))
        .unwrap()
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".sqlite3"))
        .collect::<Vec<_>>();
    assert_eq!(backups.len(), 1);
    let backup = Connection::open(temp.0.join("backups").join(&backups[0])).unwrap();
    let backup_version: i64 = backup
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(backup_version, 1);
    let backup_books: i64 = backup
        .query_row("SELECT count(*) FROM books", [], |r| r.get(0))
        .unwrap();
    assert_eq!(backup_books, 1);
}

#[test]
fn a_failed_upgrade_rolls_back_and_keeps_the_v1_database() {
    let temp = TempDirectory::new();
    let (book_id, _, _) = seed_v1_database(&temp.0);
    // Poison the upgrade path: 0002 cannot create an already-existing table.
    let connection = Connection::open(temp.0.join("storyark.sqlite3")).unwrap();
    connection
        .execute_batch("CREATE TABLE characters(id TEXT PRIMARY KEY NOT NULL) STRICT;")
        .unwrap();
    drop(connection);
    assert!(Database::open(&temp.0).is_err());
    // The old database keeps its version and every row; nothing was rebuilt.
    let connection = Connection::open(temp.0.join("storyark.sqlite3")).unwrap();
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(version, 1);
    let books: i64 = connection
        .query_row("SELECT count(*) FROM books WHERE id=?", [&book_id], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(books, 1);
    let chapters: i64 = connection
        .query_row(
            "SELECT count(*) FROM chapters WHERE is_read_only=1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(chapters, 1);
    // The pre-upgrade backup was still taken before the failure.
    assert!(std::fs::read_dir(temp.0.join("backups"))
        .unwrap()
        .any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".sqlite3")));
}

#[test]
fn a_fresh_database_initializes_at_the_latest_version_with_all_tables() {
    let temp = TempDirectory::new();
    let db = Database::open(&temp.0).unwrap();
    let version: i64 = db
        .connection
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(version, 2);
    for table in [
        "books",
        "volumes",
        "chapters",
        "characters",
        "graphs",
        "graph_nodes",
        "graph_edges",
        "planning",
        "application_preferences",
        "brainstorm_workspaces",
    ] {
        db.connection
            .prepare(&format!("SELECT * FROM {table} LIMIT 0"))
            .unwrap();
    }
    // A fresh empty database takes no pre-upgrade backup.
    assert!(!temp.0.join("backups").exists());
}

#[test]
fn migration_failure_rolls_back_schema_and_version() {
    let temp = TempDirectory::new();
    std::fs::create_dir_all(&temp.0).unwrap();
    let mut db = Connection::open(temp.0.join("storyark.sqlite3")).unwrap();
    {
        let tx = db.transaction().unwrap();
        tx.execute_batch(MIGRATION_0001).unwrap();
        tx.pragma_update(None, "user_version", 1).unwrap();
        assert!(tx
            .execute_batch("INSERT INTO nonexistent VALUES (1)")
            .is_err());
    }
    assert_eq!(
        db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
}

#[test]
fn rename_updates_titles_and_rejects_stale_or_locked_targets() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let input = fixture(&mut db);
    let renamed = db
        .rename(Rename {
            target: ExpectedTarget {
                target: Target::Chapter {
                    book_id: input.book_id.clone(),
                    volume_id: input.volume_id.clone(),
                    chapter_id: input.chapter_id.clone(),
                },
                expected_database_version: 1,
            },
            title: "Renamed chapter".into(),
        })
        .unwrap();
    assert_eq!(renamed["title"], "Renamed chapter");
    assert_eq!(renamed["databaseVersion"], 2);
    assert_eq!(
        db.rename(Rename {
            target: ExpectedTarget {
                target: Target::Book {
                    book_id: input.book_id.clone()
                },
                expected_database_version: 2,
            },
            title: "Renamed book".into(),
        })
        .unwrap()["title"],
        "Renamed book"
    );
    db.connection
        .execute(
            "UPDATE volumes SET is_read_only=1 WHERE id=?",
            [&input.volume_id],
        )
        .unwrap();
    assert_eq!(
        db.rename(Rename {
            target: ExpectedTarget {
                target: Target::Chapter {
                    book_id: input.book_id.clone(),
                    volume_id: input.volume_id.clone(),
                    chapter_id: input.chapter_id.clone(),
                },
                expected_database_version: 2,
            },
            title: "Blocked".into(),
        })
        .unwrap_err()
        .code,
        "READ_ONLY"
    );
    db.connection
        .execute(
            "UPDATE volumes SET is_read_only=0 WHERE id=?",
            [&input.volume_id],
        )
        .unwrap();
    assert_eq!(
        db.rename(Rename {
            target: ExpectedTarget {
                target: Target::Chapter {
                    book_id: input.book_id.clone(),
                    volume_id: input.volume_id.clone(),
                    chapter_id: input.chapter_id.clone(),
                },
                expected_database_version: 1,
            },
            title: "Stale".into(),
        })
        .unwrap_err()
        .code,
        "VERSION_CONFLICT"
    );
}

#[test]
fn set_read_only_blocks_writes_until_unlocked() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let input = fixture(&mut db);
    let chapter_target = |version: i64| ExpectedTarget {
        target: Target::Chapter {
            book_id: input.book_id.clone(),
            volume_id: input.volume_id.clone(),
            chapter_id: input.chapter_id.clone(),
        },
        expected_database_version: version,
    };
    let locked = db
        .set_read_only(SetReadOnly {
            target: chapter_target(1),
            is_read_only: true,
        })
        .unwrap();
    assert_eq!(locked["isReadOnly"], true);
    assert_eq!(locked["databaseVersion"], 2);
    assert_eq!(
        db.save_chapter(input.clone()).unwrap_err().code,
        "READ_ONLY"
    );
    assert_eq!(
        db.rename(Rename {
            target: chapter_target(2),
            title: "Blocked".into()
        })
        .unwrap_err()
        .code,
        "READ_ONLY"
    );
    // The record's own lock never blocks unlocking itself.
    let unlocked = db
        .set_read_only(SetReadOnly {
            target: chapter_target(2),
            is_read_only: false,
        })
        .unwrap();
    assert_eq!(unlocked["isReadOnly"], false);
    let mut resumed = input.clone();
    resumed.expected_database_version = 3;
    db.save_chapter(resumed).unwrap();
    db.connection
        .execute(
            "UPDATE books SET is_read_only=1 WHERE id=?",
            [&input.book_id],
        )
        .unwrap();
    assert_eq!(
        db.set_read_only(SetReadOnly {
            target: chapter_target(4),
            is_read_only: true
        })
        .unwrap_err()
        .code,
        "READ_ONLY"
    );
}

#[test]
fn reorder_repositions_siblings_and_validates_the_complete_set() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let input = fixture(&mut db);
    let second = db
        .create_volume(CreateVolume {
            book_id: input.book_id.clone(),
            title: "Second".into(),
            expected_book_version: 2,
        })
        .unwrap();
    let second_id = second["volume"]["id"].as_str().unwrap().to_string();
    let book_target = |version: i64| ExpectedTarget {
        target: Target::Book {
            book_id: input.book_id.clone(),
        },
        expected_database_version: version,
    };
    let ordered = db
        .reorder(Reorder {
            parent: Some(book_target(3)),
            items: vec![
                ExpectedTarget {
                    target: Target::Volume {
                        book_id: input.book_id.clone(),
                        volume_id: second_id.clone(),
                    },
                    expected_database_version: 1,
                },
                ExpectedTarget {
                    target: Target::Volume {
                        book_id: input.book_id.clone(),
                        volume_id: input.volume_id.clone(),
                    },
                    expected_database_version: 2,
                },
            ],
        })
        .unwrap();
    assert_eq!(ordered[0]["id"], json!(second_id));
    assert_eq!(ordered[0]["position"], 0);
    assert_eq!(ordered[1]["position"], 1);
    // The parent version is untouched by a reorder: only children advance.
    assert_eq!(
        db.read_book(&input.book_id).unwrap()["book"]["databaseVersion"],
        3
    );
    // Partial sets, wrong parents and stale versions are rejected.
    assert_eq!(
        db.reorder(Reorder {
            parent: Some(book_target(3)),
            items: vec![ExpectedTarget {
                target: Target::Volume {
                    book_id: input.book_id.clone(),
                    volume_id: input.volume_id.clone(),
                },
                expected_database_version: 3,
            }],
        })
        .unwrap_err()
        .code,
        "INVALID_INPUT"
    );
    assert_eq!(
        db.reorder(Reorder {
            parent: Some(book_target(3)),
            items: vec![
                ExpectedTarget {
                    target: Target::Volume {
                        book_id: input.book_id.clone(),
                        volume_id: second_id.clone(),
                    },
                    expected_database_version: 1,
                },
                ExpectedTarget {
                    target: Target::Volume {
                        book_id: input.book_id.clone(),
                        volume_id: input.volume_id.clone(),
                    },
                    expected_database_version: 2,
                },
            ],
        })
        .unwrap_err()
        .code,
        "VERSION_CONFLICT"
    );
    // A chapter cannot parent a reorder.
    assert_eq!(
        db.reorder(Reorder {
            parent: Some(ExpectedTarget {
                target: Target::Chapter {
                    book_id: input.book_id.clone(),
                    volume_id: input.volume_id.clone(),
                    chapter_id: input.chapter_id.clone(),
                },
                expected_database_version: 1,
            }),
            items: vec![],
        })
        .unwrap_err()
        .code,
        "INVALID_INPUT"
    );
}

#[test]
fn delete_cascades_and_advances_parent_versions() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let input = fixture(&mut db);
    let deleted = db
        .delete(Delete {
            target: ExpectedTarget {
                target: Target::Chapter {
                    book_id: input.book_id.clone(),
                    volume_id: input.volume_id.clone(),
                    chapter_id: input.chapter_id.clone(),
                },
                expected_database_version: 1,
            },
            expected_parent_version: Some(2),
        })
        .unwrap();
    assert_eq!(deleted["deletedId"], json!(input.chapter_id));
    assert_eq!(deleted["parent"]["databaseVersion"], 3);
    assert!(db.read_book(&input.book_id).unwrap()["chapters"]
        .as_array()
        .unwrap()
        .is_empty());
    // Deleting without the parent version is rejected for child records.
    assert_eq!(
        db.delete(Delete {
            target: ExpectedTarget {
                target: Target::Volume {
                    book_id: input.book_id.clone(),
                    volume_id: input.volume_id.clone(),
                },
                expected_database_version: 3,
            },
            expected_parent_version: None,
        })
        .unwrap_err()
        .code,
        "INVALID_INPUT"
    );
    // Cascade: deleting the volume removes its chapters too.
    let second = fixture(&mut db);
    assert!(second.volume_id != input.volume_id);
    let removed = db
        .delete(Delete {
            target: ExpectedTarget {
                target: Target::Volume {
                    book_id: second.book_id.clone(),
                    volume_id: second.volume_id.clone(),
                },
                expected_database_version: 2,
            },
            expected_parent_version: Some(2),
        })
        .unwrap();
    assert_eq!(removed["parent"]["databaseVersion"], 3);
    let loaded = db.read_book(&input.book_id).unwrap();
    assert!(loaded["chapters"].as_array().unwrap().is_empty());
    assert_eq!(loaded["volumes"].as_array().unwrap().len(), 1);
    // Locked and stale targets stay put.
    db.connection
        .execute(
            "UPDATE volumes SET is_read_only=1 WHERE id=?",
            [&input.volume_id],
        )
        .unwrap();
    assert_eq!(
        db.delete(Delete {
            target: ExpectedTarget {
                target: Target::Volume {
                    book_id: input.book_id.clone(),
                    volume_id: input.volume_id.clone(),
                },
                expected_database_version: 3,
            },
            expected_parent_version: Some(4),
        })
        .unwrap_err()
        .code,
        "READ_ONLY"
    );
}

#[test]
fn ipc_renames_reorders_and_deletes_through_registered_commands() {
    let temp = TempDirectory::new();
    let app = crate::with_storage_commands(tauri::test::mock_builder())
        .manage(Storage::open(&temp.0).unwrap())
        .build(tauri::generate_context!())
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let book = ipc(
        &window,
        "local_create_book",
        json!({"input":{"title":"IPC","author":""}}),
    );
    let book_id = book["value"]["id"].clone();
    let volume = ipc(
        &window,
        "local_create_volume",
        json!({"input":{"bookId":book_id,"title":"Volume","expectedBookVersion":1}}),
    );
    let volume_id = volume["value"]["volume"]["id"].clone();
    let renamed = ipc(
        &window,
        "local_rename",
        json!({"input":{"kind":"volume","bookId":book_id,"volumeId":volume_id,"expectedDatabaseVersion":1,"title":"Renamed"}}),
    );
    assert_eq!(renamed["ok"], true);
    assert_eq!(renamed["value"]["title"], "Renamed");
    let locked = ipc(
        &window,
        "local_set_read_only",
        json!({"input":{"kind":"volume","bookId":book_id,"volumeId":volume_id,"expectedDatabaseVersion":2,"isReadOnly":true}}),
    );
    assert_eq!(locked["value"]["isReadOnly"], true);
    let blocked = ipc(
        &window,
        "local_rename",
        json!({"input":{"kind":"volume","bookId":book_id,"volumeId":volume_id,"expectedDatabaseVersion":3,"title":"Blocked"}}),
    );
    assert_eq!(blocked["ok"], false);
    assert_eq!(blocked["error"]["code"], "READ_ONLY");
    let unlocked = ipc(
        &window,
        "local_set_read_only",
        json!({"input":{"kind":"volume","bookId":book_id,"volumeId":volume_id,"expectedDatabaseVersion":3,"isReadOnly":false}}),
    );
    assert_eq!(unlocked["ok"], true);
    let deleted = ipc(
        &window,
        "local_delete",
        json!({"input":{"kind":"volume","bookId":book_id,"volumeId":volume_id,"expectedDatabaseVersion":4,"expectedParentVersion":2}}),
    );
    assert_eq!(deleted["ok"], true);
    assert_eq!(deleted["value"]["parent"]["databaseVersion"], 3);
    let loaded = ipc(&window, "local_read_book", json!({"bookId":book_id}));
    assert!(loaded["value"]["volumes"].as_array().unwrap().is_empty());
}

fn character_input(book_id: &str) -> CharacterInput {
    CharacterInput {
        book_id: book_id.into(),
        name: "林晚".into(),
        role: "protagonist".into(),
        aliases: vec!["晚晚".into(), "Lin".into()],
        description: "主角".into(),
        color: "#3b82f6".into(),
        tags: vec!["主线".into()],
        avatar: None,
        handle_config: Some(json!({"top": "both", "left": "none"})),
    }
}

#[test]
fn character_crud_and_archive_follow_the_same_concurrency_rules() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let book = db
        .create_book(CreateBook {
            title: "Book".into(),
            author: "Writer".into(),
        })
        .unwrap();
    let book_id = book["id"].as_str().unwrap().to_string();
    // Create assigns a UUID, bumps the book version and returns the record.
    let created = db
        .create_character(CreateCharacter {
            character: character_input(&book_id),
            expected_book_version: 1,
        })
        .unwrap();
    let character_id = created["character"]["id"].as_str().unwrap().to_string();
    assert!(Uuid::parse_str(&character_id).is_ok());
    assert_eq!(created["character"]["aliases"], json!(["晚晚", "Lin"]));
    assert_eq!(
        created["character"]["handleConfig"],
        json!({"top": "both", "left": "none"})
    );
    assert_eq!(created["character"]["isArchived"], false);
    assert_eq!(created["book"]["databaseVersion"], 2);
    // Update is version-guarded and keeps unknown cross-book IDs out.
    let stale = db.update_character(UpdateCharacter {
        character: character_input(&book_id),
        character_id: character_id.clone(),
        expected_database_version: 9,
    });
    assert_eq!(stale.unwrap_err().code, "VERSION_CONFLICT");
    let mut renamed = character_input(&book_id);
    renamed.name = "林晚舟".into();
    let updated = db
        .update_character(UpdateCharacter {
            character: renamed,
            character_id: character_id.clone(),
            expected_database_version: 1,
        })
        .unwrap();
    assert_eq!(updated["name"], "林晚舟");
    assert_eq!(updated["databaseVersion"], 2);
    // Archive and unarchive preserve every reference field.
    let archived = db
        .archive_character(ArchiveCharacter {
            book_id: book_id.clone(),
            character_id: character_id.clone(),
            expected_database_version: 2,
            is_archived: true,
        })
        .unwrap();
    assert_eq!(archived["isArchived"], true);
    assert_eq!(archived["aliases"], json!(["晚晚", "Lin"]));
    let listed = db.list_characters(&book_id).unwrap();
    assert_eq!(listed.as_array().unwrap().len(), 1);
    assert_eq!(listed[0]["isArchived"], true);
    let other_book = db
        .create_book(CreateBook {
            title: "Other".into(),
            author: "".into(),
        })
        .unwrap();
    let wrong_book = db.archive_character(ArchiveCharacter {
        book_id: other_book["id"].as_str().unwrap().into(),
        character_id: character_id.clone(),
        expected_database_version: 3,
        is_archived: false,
    });
    assert_eq!(wrong_book.unwrap_err().code, "OWNERSHIP_MISMATCH");
}

#[test]
fn character_validation_and_book_locks_are_enforced() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let book = db
        .create_book(CreateBook {
            title: "Book".into(),
            author: "Writer".into(),
        })
        .unwrap();
    let book_id = book["id"].as_str().unwrap().to_string();
    let mut bad = character_input(&book_id);
    bad.role = "narrator".into();
    assert_eq!(
        db.create_character(CreateCharacter {
            character: bad,
            expected_book_version: 1
        })
        .unwrap_err()
        .code,
        "INVALID_INPUT"
    );
    let mut bad_handle = character_input(&book_id);
    bad_handle.handle_config = Some(json!({"diagonal": "source"}));
    assert_eq!(
        db.create_character(CreateCharacter {
            character: bad_handle,
            expected_book_version: 1
        })
        .unwrap_err()
        .code,
        "INVALID_INPUT"
    );
    db.connection
        .execute("UPDATE books SET is_read_only=1 WHERE id=?", [&book_id])
        .unwrap();
    assert_eq!(
        db.create_character(CreateCharacter {
            character: character_input(&book_id),
            expected_book_version: 1
        })
        .unwrap_err()
        .code,
        "READ_ONLY"
    );
}

#[test]
fn serialized_worker_keeps_the_async_caller_free_and_returns_committed_data() {
    let temp = TempDirectory::new();
    let storage = Storage::open(&temp.0).unwrap();
    tauri::async_runtime::block_on(async {
        let worker = storage.clone();
        let first = tauri::async_runtime::spawn(async move {
            worker
                .run(|db| {
                    db.create_book(CreateBook {
                        title: "First".into(),
                        author: "".into(),
                    })
                })
                .await
        });
        let second = storage
            .run(|db| {
                db.create_book(CreateBook {
                    title: "Second".into(),
                    author: "".into(),
                })
            })
            .await
            .unwrap();
        first.await.unwrap().unwrap();
        assert!(second["id"].is_string());
        assert_eq!(
            storage
                .run(|db| db.list_books())
                .await
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            2
        );
    });
}
