use super::*;
use crate::storage::graph_types::{GraphSnapshot, SaveGraph};

fn graph_fixture(db: &mut Database) -> (SaveChapter, Value) {
    let chapter = fixture(db);
    db.save_chapter(chapter.clone()).unwrap();
    let book = db.read_book(&chapter.book_id).unwrap();
    let character = db.create_character(serde_json::from_value(json!({
        "bookId":chapter.book_id,"name":"Alice","role":"protagonist","aliases":[],
        "description":"Writer-owned character","color":"#123456","tags":[],
        "avatar":null,"handleConfig":null,"expectedBookVersion":book["book"]["databaseVersion"]
    })).unwrap()).unwrap()["character"].clone();
    assert_eq!(db.read_graph(&chapter.book_id).unwrap(), Value::Null);
    let empty = db.initialize_graph(&chapter.book_id).unwrap();
    assert_eq!(empty["nodes"], json!([]));
    let a = Uuid::new_v4().to_string();
    let b = Uuid::new_v4().to_string();
    let input = json!({"bookId":chapter.book_id,"expectedDatabaseVersion":1,"sessionKey":"graph-test","revision":7,
        "nodes":[
            {"nodeKey":a,"characterId":character["id"],"positionX":12.5,"positionY":-42.25,"handleConfig":null},
            {"nodeKey":b,"characterId":character["id"],"positionX":345.75,"positionY":86.0,"handleConfig":{"top":"both","right":"source","bottom":"none","left":"target"}}
        ],"edges":[{"id":Uuid::new_v4().to_string(),"sourceNodeKey":a,"targetNodeKey":b,
            "sourceHandle":"right-source","targetHandle":"top-target","label":"Same person, different scene"}]
    });
    (chapter, input)
}

fn save(db: &mut Database, input: &Value) -> Result<Value> {
    db.save_graph(serde_json::from_value::<SaveGraph>(input.clone()).unwrap())
}

#[test]
fn graph_round_trip_preserves_instances_ports_archival_and_saved_empty_graphs() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let (chapter, mut input) = graph_fixture(&mut db);
    let saved = save(&mut db, &input).unwrap();
    assert_eq!(saved["sessionKey"], "graph-test");
    assert_eq!(saved["revision"], 7);
    assert_eq!(saved["graph"]["nodes"].as_array().unwrap().len(), 2);
    let character_id = input["nodes"][0]["characterId"]
        .as_str()
        .unwrap()
        .to_owned();
    db.archive_character(ArchiveCharacter {
        book_id: chapter.book_id.clone(),
        character_id: character_id.clone(),
        expected_database_version: 1,
        is_archived: true,
    })
    .unwrap();
    drop(db);
    let mut db = Database::open(&temp.0).unwrap();
    assert_eq!(db.read_graph(&chapter.book_id).unwrap(), saved["graph"]);
    assert_eq!(
        db.initialize_graph(&chapter.book_id).unwrap(),
        saved["graph"]
    );
    input["expectedDatabaseVersion"] = json!(2);
    input["nodes"] = json!([]);
    input["edges"] = json!([]);
    save(&mut db, &input).unwrap();
    drop(db);
    let mut db = Database::open(&temp.0).unwrap();
    assert_eq!(
        db.initialize_graph(&chapter.book_id).unwrap()["nodes"],
        json!([])
    );
    assert_eq!(
        db.list_characters(&chapter.book_id).unwrap()[0]["id"],
        character_id
    );
    assert_eq!(
        db.read_book(&chapter.book_id).unwrap()["chapters"][0]["body"]["content"],
        chapter.content
    );
}

#[test]
fn graph_validation_rejects_wrong_owners_dangling_ports_duplicates_and_coordinates() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let (chapter, input) = graph_fixture(&mut db);
    let (_, foreign) = graph_fixture(&mut db);
    let before = db.read_graph(&chapter.book_id).unwrap();
    for (pointer, value) in [
        (
            "/nodes/0/characterId",
            foreign["nodes"][0]["characterId"].clone(),
        ),
        ("/nodes/0/positionX", json!(1_000_001)),
        ("/nodes/1/nodeKey", input["nodes"][0]["nodeKey"].clone()),
        ("/edges/0/targetNodeKey", json!(Uuid::new_v4().to_string())),
        ("/edges/0/sourceHandle", json!("right-target")),
        ("/nodes/0/handleConfig", json!({"right":"none"})),
    ] {
        let mut invalid = input.clone();
        *invalid.pointer_mut(pointer).unwrap() = value;
        assert!(save(&mut db, &invalid).is_err());
        assert_eq!(db.read_graph(&chapter.book_id).unwrap(), before);
    }
    let mut invalid: SaveGraph = serde_json::from_value(input).unwrap();
    invalid.nodes[0].position_y = f64::NAN;
    assert!(db.save_graph(invalid).is_err());
}

#[test]
fn graph_replacement_rolls_back_and_stale_connections_cannot_overwrite() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let (chapter, mut input) = graph_fixture(&mut db);
    let saved = save(&mut db, &input).unwrap()["graph"].clone();
    let mut other = Database::open(&temp.0).unwrap();
    assert_eq!(
        save(&mut other, &input).unwrap_err().code,
        "VERSION_CONFLICT"
    );
    input["expectedDatabaseVersion"] = json!(2);
    input["nodes"][0]["positionX"] = json!(999.5);
    db.connection.execute_batch("CREATE TRIGGER reject_graph_edge BEFORE INSERT ON graph_edges BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
    assert_eq!(save(&mut db, &input).unwrap_err().code, "STORAGE_FAILURE");
    assert_eq!(db.read_graph(&chapter.book_id).unwrap(), saved);
    db.connection
        .execute_batch("DROP TRIGGER reject_graph_edge")
        .unwrap();
    assert_eq!(
        save(&mut db, &input).unwrap()["graph"]["databaseVersion"],
        3
    );
    assert_eq!(
        save(&mut other, &input).unwrap_err().code,
        "VERSION_CONFLICT"
    );
    db.connection
        .execute(
            "UPDATE books SET is_read_only=1 WHERE id=?",
            [&chapter.book_id],
        )
        .unwrap();
    input["expectedDatabaseVersion"] = json!(3);
    assert_eq!(save(&mut db, &input).unwrap_err().code, "READ_ONLY");
}

#[test]
fn changing_inherited_character_ports_cannot_silently_drop_connections() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let (chapter, input) = graph_fixture(&mut db);
    let before = save(&mut db, &input).unwrap()["graph"].clone();
    let character = db.list_characters(&chapter.book_id).unwrap()[0].clone();
    let mut update = json!({"bookId":chapter.book_id,"characterId":character["id"],"expectedDatabaseVersion":1,
        "name":"Alice","role":"protagonist","aliases":[],"description":"","color":"#123456","tags":[],
        "avatar":null,"handleConfig":{"right":"none"}});
    assert_eq!(
        db.update_character(serde_json::from_value(update.clone()).unwrap())
            .unwrap_err()
            .code,
        "INVALID_INPUT"
    );
    assert_eq!(db.read_graph(&chapter.book_id).unwrap(), before);
    assert_eq!(db.list_characters(&chapter.book_id).unwrap()[0], character);
    update["handleConfig"] = json!({"right":"both"});
    db.update_character(serde_json::from_value(update).unwrap())
        .unwrap();
    assert_eq!(
        db.read_graph(&chapter.book_id).unwrap()["databaseVersion"],
        3
    );
}

#[test]
fn graph_commands_use_the_registered_ipc_and_return_committed_snapshots() {
    let temp = TempDirectory::new();
    let storage = Storage::open(&temp.0).unwrap();
    let (chapter, input) = graph_fixture(&mut storage.0.lock().unwrap());
    let app = crate::with_storage_commands(tauri::test::mock_builder())
        .manage(storage)
        .build(tauri::generate_context!())
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let initialized = super::ipc::ipc(
        &window,
        "local_initialize_graph",
        json!({"bookId":chapter.book_id}),
    );
    assert_eq!(initialized["ok"], true);
    let result = super::ipc::ipc(&window, "local_save_graph", json!({"input":input}));
    assert_eq!(result["ok"], true);
    let read = super::ipc::ipc(
        &window,
        "local_read_graph",
        json!({"bookId":chapter.book_id}),
    );
    assert_eq!(read["value"], result["value"]["graph"]);
    serde_json::from_value::<GraphSnapshot>(read["value"].clone()).unwrap();
}
