use super::*;

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
            cover_color: "".into(),
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
            cover_color: "".into(),
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
            cover_color: "".into(),
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
fn character_order_is_atomic_position_guarded_and_survives_reopen() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let book = db
        .create_book(CreateBook {
            title: "Order".into(),
            author: "Writer".into(),
            cover_color: "".into(),
        })
        .unwrap();
    let book_id = book["id"].as_str().unwrap().to_string();
    let mut ids = Vec::new();
    for version in 1..=3 {
        let created = db
            .create_character(CreateCharacter {
                character: character_input(&book_id),
                expected_book_version: version,
            })
            .unwrap();
        ids.push(created["character"]["id"].as_str().unwrap().to_string());
    }
    let request = |order: &[String], version| ReorderCharacters {
        book_id: book_id.clone(),
        expected_book_version: 4,
        items: order
            .iter()
            .map(|id| CharacterOrderItem {
                character_id: id.clone(),
                expected_database_version: version,
                expected_position: ids.iter().position(|known| known == id).unwrap_or(0) as i64,
            })
            .collect(),
    };
    let before = db.list_characters(&book_id).unwrap();
    let reversed: Vec<_> = ids.iter().rev().cloned().collect();
    db.connection.execute_batch("CREATE TRIGGER fail_order BEFORE UPDATE OF position ON characters WHEN NEW.position=0 BEGIN SELECT RAISE(ABORT, 'injected failure'); END;").unwrap();
    assert!(db.reorder_characters(request(&reversed, 1)).is_err());
    assert_eq!(db.list_characters(&book_id).unwrap(), before);
    db.connection
        .execute_batch("DROP TRIGGER fail_order;")
        .unwrap();
    assert!(db.reorder_characters(request(&ids[..2], 1)).is_err());
    assert!(db
        .reorder_characters(request(
            &[ids[0].clone(), ids[0].clone(), ids[2].clone()],
            1
        ))
        .is_err());
    let saved = db.reorder_characters(request(&reversed, 1)).unwrap();
    assert_eq!(saved[0]["id"], reversed[0]);
    assert_eq!(saved[0]["databaseVersion"], 1);
    assert_eq!(saved[0]["updatedAt"], before[2]["updatedAt"]);
    assert_eq!(saved[0]["description"], before[2]["description"]);
    assert_eq!(
        db.reorder_characters(request(&ids, 1)).unwrap_err().code,
        "VERSION_CONFLICT"
    );
    drop(db);
    let mut reopened = Database::open(&temp.0).unwrap();
    assert_eq!(reopened.list_characters(&book_id).unwrap(), saved);
    let foreign = reopened
        .create_book(CreateBook {
            title: "Other".into(),
            author: "Writer".into(),
            cover_color: "".into(),
        })
        .unwrap();
    let other = reopened
        .create_character(CreateCharacter {
            character: character_input(foreign["id"].as_str().unwrap()),
            expected_book_version: 1,
        })
        .unwrap();
    let mut wrong = ids.clone();
    wrong[0] = other["character"]["id"].as_str().unwrap().into();
    assert_eq!(
        reopened
            .reorder_characters(request(&wrong, 1))
            .unwrap_err()
            .code,
        "OWNERSHIP_MISMATCH"
    );
    assert_eq!(reopened.list_characters(&book_id).unwrap(), saved);
}
