use super::*;

#[test]
fn reorder_accepts_position_tokens_from_the_ipc_request() {
    let request: Reorder = serde_json::from_value(json!({
        "parent": {"kind":"volume","bookId":"book","volumeId":"volume","expectedDatabaseVersion":3},
        "items": [{"kind":"chapter","bookId":"book","volumeId":"volume","chapterId":"chapter","expectedDatabaseVersion":2,"expectedPosition":1}]
    })).unwrap();
    assert_eq!(request.items[0].expected_position, 1);
    assert_eq!(request.items[0].target.expected_database_version, 2);
    assert!(matches!(
        request.items[0].target.target,
        Target::Chapter { .. }
    ));
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
                ReorderItem {
                    target: ExpectedTarget {
                        target: Target::Volume {
                            book_id: input.book_id.clone(),
                            volume_id: second_id.clone(),
                        },
                        expected_database_version: 1,
                    },
                    expected_position: 1,
                },
                ReorderItem {
                    target: ExpectedTarget {
                        target: Target::Volume {
                            book_id: input.book_id.clone(),
                            volume_id: input.volume_id.clone(),
                        },
                        expected_database_version: 2,
                    },
                    expected_position: 0,
                },
            ],
        })
        .unwrap();
    assert_eq!(ordered[0]["id"], json!(second_id));
    assert_eq!(ordered[0]["position"], 0);
    assert_eq!(ordered[1]["position"], 1);
    // Position changes do not advance content versions.
    assert_eq!(
        db.read_book(&input.book_id).unwrap()["book"]["databaseVersion"],
        3
    );
    assert_eq!(ordered[0]["databaseVersion"], 1);
    assert_eq!(ordered[1]["databaseVersion"], 2);
    // Partial sets, wrong parents and stale versions are rejected.
    assert_eq!(
        db.reorder(Reorder {
            parent: Some(book_target(3)),
            items: vec![ReorderItem {
                target: ExpectedTarget {
                    target: Target::Volume {
                        book_id: input.book_id.clone(),
                        volume_id: input.volume_id.clone(),
                    },
                    expected_database_version: 2,
                },
                expected_position: 1,
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
                ReorderItem {
                    target: ExpectedTarget {
                        target: Target::Volume {
                            book_id: input.book_id.clone(),
                            volume_id: second_id.clone(),
                        },
                        expected_database_version: 1,
                    },
                    expected_position: 1,
                },
                ReorderItem {
                    target: ExpectedTarget {
                        target: Target::Volume {
                            book_id: input.book_id.clone(),
                            volume_id: input.volume_id.clone(),
                        },
                        expected_database_version: 2,
                    },
                    expected_position: 0,
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
fn chapter_reorder_preserves_content_versions_and_indexed_sources() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let first = fixture(&mut db);
    db.save_chapter(first.clone()).unwrap();
    let created = db
        .create_chapter(CreateChapter {
            book_id: first.book_id.clone(),
            volume_id: first.volume_id.clone(),
            title: "Second".into(),
            expected_volume_version: 2,
        })
        .unwrap();
    let second_id = created["chapter"]["id"].as_str().unwrap().to_owned();
    let mut second = first.clone();
    second.chapter_id = second_id.clone();
    second.expected_database_version = 1;
    second.title = "Second".into();
    db.save_chapter(second).unwrap();

    let source_states = |db: &Database| {
        db.connection.prepare(
            "SELECT source_id,source_version,index_status,embedding_fingerprint FROM retrieval_sources WHERE book_id=? ORDER BY source_id"
        ).unwrap().query_map([&first.book_id], |row| Ok((
            row.get::<_, String>(0)?, row.get::<_, i64>(1)?,
            row.get::<_, String>(2)?, row.get::<_, Option<String>>(3)?,
        ))).unwrap().collect::<std::result::Result<Vec<_>, _>>().unwrap()
    };
    db.connection.execute(
        "UPDATE retrieval_sources SET index_status='ready',index_version=?1,embedding_fingerprint='test' WHERE book_id=?2 AND source_status='active'",
        params![crate::rag::chunking::CHUNK_INDEX_VERSION, first.book_id],
    ).unwrap();
    db.connection
        .execute(
            "DELETE FROM retrieval_dirty_sources WHERE book_id=?",
            [&first.book_id],
        )
        .unwrap();
    let before = source_states(&db);
    let chunk_count: i64 = db
        .connection
        .query_row(
            "SELECT count(*) FROM retrieval_chunks WHERE book_id=?",
            [&first.book_id],
            |row| row.get(0),
        )
        .unwrap();

    let reordered = db
        .reorder_directory(Reorder {
            parent: Some(ExpectedTarget {
                target: Target::Volume {
                    book_id: first.book_id.clone(),
                    volume_id: first.volume_id.clone(),
                },
                expected_database_version: 3,
            }),
            items: vec![
                ReorderItem {
                    target: ExpectedTarget {
                        target: Target::Chapter {
                            book_id: first.book_id.clone(),
                            volume_id: first.volume_id.clone(),
                            chapter_id: second_id.clone(),
                        },
                        expected_database_version: 2,
                    },
                    expected_position: 1,
                },
                ReorderItem {
                    target: ExpectedTarget {
                        target: Target::Chapter {
                            book_id: first.book_id.clone(),
                            volume_id: first.volume_id.clone(),
                            chapter_id: first.chapter_id.clone(),
                        },
                        expected_database_version: 2,
                    },
                    expected_position: 0,
                },
            ],
        })
        .unwrap();
    assert_eq!(reordered[0]["databaseVersion"], 2);
    assert_eq!(reordered[1]["databaseVersion"], 2);
    assert_eq!(reordered[0]["body"]["content"], "");
    assert_eq!(reordered[1]["body"]["content"], "");
    assert_eq!(
        db.read_chapter(&first.book_id, &first.chapter_id).unwrap()["body"]["content"],
        first.content
    );
    assert_eq!(source_states(&db), before);
    assert_eq!(
        db.connection
            .query_row(
                "SELECT count(*) FROM retrieval_chunks WHERE book_id=?",
                [&first.book_id],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        chunk_count
    );
    assert_eq!(
        db.connection
            .query_row(
                "SELECT count(*) FROM retrieval_dirty_sources WHERE book_id=?",
                [&first.book_id],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    let order: i64 = db.connection.query_row(
        "SELECT json_extract(visibility_scope_json,'$.chapterOrder') FROM retrieval_sources WHERE book_id=? AND source_kind='manuscript' AND entity_id=?",
        params![first.book_id, second_id], |row| row.get(0),
    ).unwrap();
    assert_eq!(order, 0);
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
fn update_book_changes_title_and_status_with_lock_and_version_guards() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let chapter = fixture(&mut db);
    let book_id = chapter.book_id.clone();
    let book = db.read_book(&book_id).unwrap()["book"].clone();
    assert_eq!(book["coverColor"], "bg-blue-600");
    let updated = db
        .update_book(crate::storage::requests::UpdateBook {
            book_id: book_id.clone(),
            expected_database_version: book["databaseVersion"].as_i64().unwrap(),
            title: Some("Renamed Shelf".into()),
            status: Some("completed".into()),
        })
        .unwrap();
    assert_eq!(updated["title"], "Renamed Shelf");
    assert_eq!(updated["status"], "completed");
    assert_eq!(
        updated["databaseVersion"],
        book["databaseVersion"].as_i64().unwrap() + 1
    );
    // Validation: empty title, unknown status, no fields, stale version.
    for input in [
        json!({"bookId":book_id,"expectedDatabaseVersion":2,"title":"  "}),
        json!({"bookId":book_id,"expectedDatabaseVersion":2,"status":"draft"}),
        json!({"bookId":book_id,"expectedDatabaseVersion":2}),
        json!({"bookId":book_id,"expectedDatabaseVersion":9,"status":"serializing"}),
    ] {
        assert!(db
            .update_book(
                serde_json::from_value::<crate::storage::requests::UpdateBook>(input).unwrap()
            )
            .is_err());
    }
    assert_eq!(
        db.read_book(&book_id).unwrap()["book"]["title"],
        "Renamed Shelf"
    );
    // Locked books reject updates; cover color is not mutable through this command.
    db.connection
        .execute("UPDATE books SET is_read_only=1 WHERE id=?", [&book_id])
        .unwrap();
    assert_eq!(
        db.update_book(crate::storage::requests::UpdateBook {
            book_id: book_id.clone(),
            expected_database_version: 2,
            status: Some("serializing".into()),
            title: None,
        })
        .unwrap_err()
        .code,
        "READ_ONLY"
    );
    let rejected = serde_json::from_value::<crate::storage::requests::UpdateBook>(
        json!({"bookId":book_id,"expectedDatabaseVersion":2,"coverColor":"bg-rose-600"}),
    );
    assert!(rejected.is_err());
}
