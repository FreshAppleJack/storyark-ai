use super::*;
use crate::storage::SavePreferences;

fn input(version: i64) -> SavePreferences {
    SavePreferences {
        expected_database_version: version,
        dark_mode: Some(true),
        editor_margin_px: Some(48),
        editor_line_height: Some(1.5),
        ai_continue_context_chars: Some(2000),
        ai_continue_output_chars: Some(400),
        auto_highlight: Some(json!({"disabledRoles":["mob"]})),
        session_key: "preferences-session".into(),
        revision: 3,
    }
}

#[test]
fn preferences_round_trip_preserves_null_fields_and_acknowledgement() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    assert_eq!(db.read_preferences().unwrap(), Value::Null);
    let mut sparse = input(0);
    sparse.dark_mode = None;
    sparse.auto_highlight = None;
    let saved = db.save_preferences(sparse).unwrap();
    assert_eq!(saved["sessionKey"], "preferences-session");
    assert_eq!(saved["revision"], 3);
    assert_eq!(saved["preferences"]["databaseVersion"], 1);
    assert_eq!(saved["preferences"]["darkMode"], Value::Null);
    assert_eq!(saved["preferences"]["editorMarginPx"], 48);
    drop(db);
    let mut db = Database::open(&temp.0).unwrap();
    let reopened = db.read_preferences().unwrap();
    assert_eq!(reopened["databaseVersion"], 1);
    assert_eq!(reopened["darkMode"], Value::Null);
    assert_eq!(reopened["autoHighlight"], Value::Null);
    assert_eq!(reopened["editorLineHeight"], 1.5);
    let updated = db.save_preferences(input(1)).unwrap();
    assert_eq!(updated["preferences"]["databaseVersion"], 2);
    assert_eq!(updated["preferences"]["darkMode"], true);
    assert_eq!(
        updated["preferences"]["autoHighlight"]["disabledRoles"],
        json!(["mob"])
    );
}

#[test]
fn preferences_reject_stale_importers_conflicts_and_invalid_values() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    db.save_preferences(input(0)).unwrap();
    // A second importer expecting version 0 must never overwrite the row.
    assert_eq!(
        db.save_preferences(input(0)).unwrap_err().code,
        "VERSION_CONFLICT"
    );
    assert_eq!(
        db.save_preferences(input(3)).unwrap_err().code,
        "VERSION_CONFLICT"
    );
    for mutate in [
        ("/editorMarginPx", json!(23)),
        ("/editorLineHeight", json!(1.9)),
        ("/aiContinueContextChars", json!(499)),
        ("/aiContinueOutputChars", json!(801)),
        ("/autoHighlight", json!({"disabledRoles":["king"]})),
        ("/autoHighlight", json!({"disabledRoles":"mob"})),
    ] {
        let mut invalid = json!({
            "expectedDatabaseVersion": 1, "darkMode": true, "editorMarginPx": 48,
            "editorLineHeight": 1.5, "aiContinueContextChars": 2000,
            "aiContinueOutputChars": 400, "autoHighlight": {"disabledRoles": ["mob"]},
            "sessionKey": "preferences-session", "revision": 4,
        });
        *invalid.pointer_mut(mutate.0).unwrap() = mutate.1;
        assert!(db
            .save_preferences(serde_json::from_value::<SavePreferences>(invalid).unwrap())
            .is_err());
    }
    // The stored row is untouched by every rejected write.
    assert_eq!(db.read_preferences().unwrap()["databaseVersion"], 1);
}

#[test]
fn preferences_ignore_book_locks_and_survive_book_deletion() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let chapter = fixture(&mut db);
    db.save_chapter(chapter.clone()).unwrap();
    db.connection
        .execute(
            "UPDATE books SET is_read_only=1 WHERE id=?",
            [&chapter.book_id],
        )
        .unwrap();
    // Work locks never apply to application preferences.
    db.save_preferences(input(0)).unwrap();
    assert_eq!(db.read_preferences().unwrap()["databaseVersion"], 1);
}

#[test]
fn preferences_commands_use_registered_ipc() {
    let temp = TempDirectory::new();
    let storage = Storage::open(&temp.0).unwrap();
    let app = crate::with_storage_commands(tauri::test::mock_builder())
        .manage(storage)
        .build(tauri::generate_context!())
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let empty = super::ipc::ipc(&window, "local_read_preferences", json!({}));
    assert_eq!(empty["ok"], true);
    assert_eq!(empty["value"], Value::Null);
    let saved = super::ipc::ipc(
        &window,
        "local_save_preferences",
        json!({"input":{
            "expectedDatabaseVersion":0,"darkMode":true,"editorMarginPx":48,
            "editorLineHeight":1.5,"aiContinueContextChars":2000,
            "aiContinueOutputChars":400,"autoHighlight":{"disabledRoles":["mob"]},
            "sessionKey":"preferences-session","revision":3
        }}),
    );
    assert_eq!(saved["ok"], true);
    assert_eq!(saved["value"]["preferences"]["databaseVersion"], 1);
}
