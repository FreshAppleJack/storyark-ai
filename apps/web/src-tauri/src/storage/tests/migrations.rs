use super::*;

const MIGRATION_0001: &str = include_str!("../../../migrations/0001_library.sql");

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
