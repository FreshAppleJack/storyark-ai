use super::*;

pub(super) fn ipc(
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
        json!({"input":{"title":"IPC Book","author":"Writer","coverColor":"bg-rose-600"}}),
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
    let sources = ipc(
        &window,
        "local_sync_retrieval_sources",
        json!({"input":{"bookId":book_id}}),
    );
    assert_eq!(sources["ok"], true);
    assert!(sources["value"]
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item["sourceKind"] == "manuscript"));
    let listed = ipc(
        &window,
        "local_list_retrieval_sources",
        json!({"input":{"scope":{
            "bookId":book_id,
            "allowedSourceKinds":["manuscript"]
        }}}),
    );
    assert_eq!(listed["ok"], true);
    assert!(listed["value"]
        .as_array()
        .unwrap()
        .iter()
        .all(|item| item["sourceKind"] == "manuscript"));
    drop(window);
    drop(app);
    let reopened = build();
    let window = tauri::WebviewWindowBuilder::new(&reopened, "main", Default::default())
        .build()
        .unwrap();
    let loaded = ipc(&window, "local_read_book", json!({"bookId":book_id}));
    assert_eq!(loaded["value"]["chapters"][0], saved["value"]["chapter"]);
    let export = ipc(
        &window,
        "local_read_work_export_snapshot",
        json!({"bookId":book_id}),
    );
    assert_eq!(export["ok"], true);
    assert_eq!(export["value"]["databaseVersion"], 7);
    assert_eq!(export["value"]["book"]["id"], book_id);
    assert_eq!(
        export["value"]["chapters"][0]["id"],
        saved["value"]["chapter"]["id"]
    );
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
        json!({"input":{"title":"IPC","author":"","coverColor":""}}),
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
