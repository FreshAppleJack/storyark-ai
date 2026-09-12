mod content;
#[cfg(test)]
mod tests;

use rusqlite::{params, Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const MIGRATION: &str = include_str!("../../migrations/0001_library.sql");
const MAX_INTEGER: i64 = 9_007_199_254_740_991;
pub type Result<T> = std::result::Result<T, StorageError>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_database_version: Option<i64>,
}
impl StorageError {
    pub fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            current_database_version: None,
        }
    }
}
impl std::fmt::Display for StorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}
impl std::error::Error for StorageError {}
impl From<rusqlite::Error> for StorageError {
    fn from(_: rusqlite::Error) -> Self {
        Self::new(
            "STORAGE_FAILURE",
            "SQLite operation failed; stored data was not reset",
        )
    }
}
impl From<std::io::Error> for StorageError {
    fn from(_: std::io::Error) -> Self {
        Self::new("STORAGE_FAILURE", "Cannot access local storage")
    }
}

#[derive(Clone)]
pub struct Storage(Arc<Mutex<Database>>);
impl Storage {
    pub fn open(directory: &Path) -> Result<Self> {
        Ok(Self(Arc::new(Mutex::new(Database::open(directory)?))))
    }
    pub async fn run<F>(&self, operation: F) -> Result<Value>
    where
        F: FnOnce(&mut Database) -> Result<Value> + Send + 'static,
    {
        let owner = self.0.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let mut db = owner
                .lock()
                .map_err(|_| StorageError::new("STORAGE_FAILURE", "Storage worker unavailable"))?;
            operation(&mut db)
        })
        .await
        .map_err(|_| StorageError::new("STORAGE_FAILURE", "Storage task failed"))?
    }
}

pub struct Database {
    connection: Connection,
    directory: PathBuf,
}
impl Database {
    pub fn open(directory: &Path) -> Result<Self> {
        std::fs::create_dir_all(directory)?;
        let mut connection = Connection::open(directory.join("storyark.sqlite3"))?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", true)?;
        let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let version: i64 = tx.pragma_query_value(None, "user_version", |r| r.get(0))?;
        match version {
            0 => {
                let count: i64 = tx.query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", [], |r| r.get(0))?;
                if count != 0 {
                    return Err(StorageError::new(
                        "STORAGE_FAILURE",
                        "Unversioned database contains tables; refusing initialization",
                    ));
                }
                tx.execute_batch(MIGRATION)?;
                tx.pragma_update(None, "user_version", 1)?;
            }
            1 => {}
            _ => {
                return Err(StorageError::new(
                    "STORAGE_FAILURE",
                    "Unsupported database version; use a compatible application",
                ))
            }
        }
        // Catch missing tables/columns even for an allegedly current database.
        tx.prepare("SELECT b.author,v.book_id,c.content_version,c.foreshadowings_json FROM books b,volumes v,chapters c LIMIT 0")?;
        let integrity: String = tx.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
        if integrity != "ok" || tx.prepare("PRAGMA foreign_key_check")?.exists([])? {
            return Err(StorageError::new(
                "STORAGE_FAILURE",
                "Database integrity check failed",
            ));
        }
        tx.commit()?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "FULL")?;
        Ok(Self {
            connection,
            directory: directory.to_owned(),
        })
    }

    pub fn list_books(&self) -> Result<Value> {
        Ok(Value::Array(rows(
            &self.connection,
            "SELECT * FROM books ORDER BY position,id",
            &[],
        )?))
    }
    pub fn read_book(&mut self, book_id: &str) -> Result<Value> {
        valid_id(book_id)?;
        let tx = self.connection.transaction()?;
        let book = record(&tx, "books", book_id)?;
        let volumes = rows(
            &tx,
            "SELECT * FROM volumes WHERE book_id=? ORDER BY position,id",
            &[&book_id],
        )?;
        let chapters = rows(
            &tx,
            "SELECT c.* FROM chapters c JOIN volumes v ON v.id=c.volume_id WHERE c.book_id=? ORDER BY v.position,v.id,c.position,c.id",
            &[&book_id],
        )?;
        tx.commit()?;
        Ok(json!({"book":book,"volumes":volumes,"chapters":chapters}))
    }
    pub fn create_book(&mut self, input: CreateBook) -> Result<Value> {
        title(&input.title)?;
        if input.author.len() > 1024 {
            return Err(invalid());
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let id = Uuid::new_v4().to_string();
        let now = now()?;
        tx.execute("INSERT INTO books(id,title,author,position,created_at,updated_at) VALUES (?,?,?,(SELECT coalesce(max(position)+1,0) FROM books),?,?)", params![id,input.title,input.author,now,now])?;
        let result = record(&tx, "books", &id)?;
        tx.commit()?;
        Ok(result)
    }
    pub fn create_volume(&mut self, input: CreateVolume) -> Result<Value> {
        valid_id(&input.book_id)?;
        title(&input.title)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let book = record(&tx, "books", &input.book_id)?;
        unlocked(&book)?;
        expected(&book, input.expected_book_version)?;
        let id = Uuid::new_v4().to_string();
        let now = now()?;
        tx.execute("INSERT INTO volumes(id,book_id,title,position,created_at,updated_at) VALUES (?,?,?,(SELECT coalesce(max(position)+1,0) FROM volumes WHERE book_id=?),?,?)", params![id,input.book_id,input.title,input.book_id,now,now])?;
        bump(
            &tx,
            "books",
            &input.book_id,
            input.expected_book_version,
            now,
        )?;
        let result =
            json!({"volume":record(&tx,"volumes",&id)?,"book":record(&tx,"books",&input.book_id)?});
        tx.commit()?;
        Ok(result)
    }
    pub fn create_chapter(&mut self, input: CreateChapter) -> Result<Value> {
        valid_id(&input.book_id)?;
        valid_id(&input.volume_id)?;
        title(&input.title)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let book = record(&tx, "books", &input.book_id)?;
        let volume = record(&tx, "volumes", &input.volume_id)?;
        ownership(&volume, "bookId", &input.book_id)?;
        unlocked(&book)?;
        unlocked(&volume)?;
        expected(&volume, input.expected_volume_version)?;
        let id = Uuid::new_v4().to_string();
        let now = now()?;
        tx.execute("INSERT INTO chapters(id,book_id,volume_id,title,position,content_format,content_version,content,created_at,updated_at) VALUES (?,?,?,?,(SELECT coalesce(max(position)+1,0) FROM chapters WHERE volume_id=?),'tiptap-json',1,?,?,?)", params![id,input.book_id,input.volume_id,input.title,input.volume_id,r#"{"type":"doc","content":[{"type":"paragraph"}]}"#,now,now])?;
        bump(
            &tx,
            "volumes",
            &input.volume_id,
            input.expected_volume_version,
            now,
        )?;
        let result = json!({"chapter":record(&tx,"chapters",&id)?,"volume":record(&tx,"volumes",&input.volume_id)?});
        tx.commit()?;
        Ok(result)
    }
    pub fn save_chapter(&mut self, input: SaveChapter) -> Result<Value> {
        valid_id(&input.book_id)?;
        valid_id(&input.volume_id)?;
        valid_id(&input.chapter_id)?;
        title(&input.title)?;
        if input.content_format != "tiptap-json"
            || input.content_version != 1
            || input.session_key.is_empty()
            || input.session_key.len() > 4096
            || !(0..=MAX_INTEGER).contains(&input.revision)
            || !(0..=MAX_INTEGER).contains(&input.word_count)
        {
            return Err(invalid());
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let book = record(&tx, "books", &input.book_id)?;
        let volume = record(&tx, "volumes", &input.volume_id)?;
        let chapter = record(&tx, "chapters", &input.chapter_id)?;
        ownership(&volume, "bookId", &input.book_id)?;
        ownership(&chapter, "bookId", &input.book_id)?;
        ownership(&chapter, "volumeId", &input.volume_id)?;
        unlocked(&book)?;
        unlocked(&volume)?;
        unlocked(&chapter)?;
        expected(&chapter, input.expected_database_version)?;
        if chapter["body"]["format"] != "tiptap-json" || chapter["body"]["version"] != 1 {
            return Err(content::incompatible());
        }
        // Validate both sides: a newer client must not overwrite unknown stored marks.
        content::validate(
            chapter["body"]["content"]
                .as_str()
                .ok_or_else(content::incompatible)?,
        )?;
        content::validate(&input.content)?;
        content::notes(&input.foreshadowings)?;
        let notes = serde_json::to_string(&input.foreshadowings).map_err(|_| invalid())?;
        let changed = tx.execute("UPDATE chapters SET title=?,content=?,word_count=?,foreshadowings_json=?,database_version=database_version+1,updated_at=max(updated_at,?) WHERE id=? AND database_version=?", params![input.title,input.content,input.word_count,notes,now()?,input.chapter_id,input.expected_database_version])?;
        if changed != 1 {
            return Err(StorageError::new("VERSION_CONFLICT", "Chapter changed"));
        }
        let result = json!({"chapter":record(&tx,"chapters",&input.chapter_id)?,"sessionKey":input.session_key,"revision":input.revision});
        tx.commit()?;
        Ok(result)
    }
    pub fn rename(&mut self, input: Rename) -> Result<Value> {
        title(&input.title)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let target = locate(&tx, &input.target.target)?;
        unlocked_ancestors(&target)?;
        unlocked(&target.row)?;
        expected(&target.row, input.target.expected_database_version)?;
        let changed = tx.execute(&format!("UPDATE {} SET title=?,database_version=database_version+1,updated_at=max(updated_at,?) WHERE id=? AND database_version=?", target.table), params![input.title, now()?, target.id, input.target.expected_database_version])?;
        if changed != 1 {
            return Err(StorageError::new("VERSION_CONFLICT", "Record changed"));
        }
        let result = record(&tx, target.table, &target.id)?;
        tx.commit()?;
        Ok(result)
    }
    pub fn set_read_only(&mut self, input: SetReadOnly) -> Result<Value> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let target = locate(&tx, &input.target.target)?;
        // Ancestor locks block the change, but the record's own lock must not:
        // otherwise a locked chapter could never be unlocked again.
        unlocked_ancestors(&target)?;
        expected(&target.row, input.target.expected_database_version)?;
        let changed = tx.execute(&format!("UPDATE {} SET is_read_only=?,database_version=database_version+1,updated_at=max(updated_at,?) WHERE id=? AND database_version=?", target.table), params![input.is_read_only, now()?, target.id, input.target.expected_database_version])?;
        if changed != 1 {
            return Err(StorageError::new("VERSION_CONFLICT", "Record changed"));
        }
        let result = record(&tx, target.table, &target.id)?;
        tx.commit()?;
        Ok(result)
    }
    pub fn reorder(&mut self, input: Reorder) -> Result<Value> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        // A reorder never bumps the parent version: position is a child-row
        // property, and callers update children from the returned records.
        let child_table: &str = match &input.parent {
            None => "books",
            Some(parent) => {
                let located = locate(&tx, &parent.target)?;
                if located.table == "chapters" {
                    return Err(invalid());
                }
                unlocked_ancestors(&located)?;
                unlocked(&located.row)?;
                expected(&located.row, parent.expected_database_version)?;
                if located.table == "books" {
                    "volumes"
                } else {
                    "chapters"
                }
            }
        };
        let siblings = match &input.parent {
            None => rows(&tx, "SELECT * FROM books", &[])?,
            Some(parent) => match &parent.target {
                Target::Book { book_id } => {
                    rows(&tx, "SELECT * FROM volumes WHERE book_id=?", &[book_id])?
                }
                Target::Volume { volume_id, .. } => rows(
                    &tx,
                    "SELECT * FROM chapters WHERE volume_id=?",
                    &[volume_id],
                )?,
                Target::Chapter { .. } => return Err(invalid()),
            },
        };
        if siblings.len() != input.items.len() {
            return Err(invalid());
        }
        let mut seen = std::collections::HashSet::new();
        let mut ordered = Vec::with_capacity(input.items.len());
        for (index, item) in input.items.iter().enumerate() {
            let belongs = match (&input.parent, &item.target) {
                (None, Target::Book { .. }) => true,
                (Some(parent), Target::Volume { book_id, .. }) => {
                    matches!(&parent.target, Target::Book { book_id: parent_id } if parent_id == book_id)
                }
                (Some(parent), Target::Chapter { volume_id, .. }) => {
                    matches!(&parent.target, Target::Volume { volume_id: parent_id, .. } if parent_id == volume_id)
                }
                _ => false,
            };
            if !belongs {
                return Err(invalid());
            }
            let located = locate(&tx, &item.target)?;
            if !seen.insert(located.id.clone()) {
                return Err(invalid());
            }
            unlocked_ancestors(&located)?;
            unlocked(&located.row)?;
            expected(&located.row, item.expected_database_version)?;
            let changed = tx.execute(&format!("UPDATE {} SET position=?,database_version=database_version+1,updated_at=max(updated_at,?) WHERE id=? AND database_version=?", child_table), params![index as i64, now()?, located.id, item.expected_database_version])?;
            if changed != 1 {
                return Err(StorageError::new("VERSION_CONFLICT", "Record changed"));
            }
            ordered.push(record(&tx, child_table, &located.id)?);
        }
        if siblings
            .iter()
            .any(|row| !seen.contains(row["id"].as_str().unwrap_or_default()))
        {
            return Err(invalid());
        }
        tx.commit()?;
        Ok(Value::Array(ordered))
    }
    pub fn delete(&mut self, input: Delete) -> Result<Value> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let target = locate(&tx, &input.target.target)?;
        unlocked_ancestors(&target)?;
        unlocked(&target.row)?;
        expected(&target.row, input.target.expected_database_version)?;
        // Deleting advances the parent version so other sessions notice the
        // structural change; the version is required except for root books.
        // Every input is validated before any row is touched.
        let parent = match (target.ancestors.last(), input.expected_parent_version) {
            (Some((table, row)), Some(version)) => {
                expected(row, version)?;
                Some((
                    table,
                    row["id"].as_str().ok_or_else(invalid)?.to_string(),
                    version,
                ))
            }
            (Some(_), None) => return Err(invalid()),
            (None, _) => None,
        };
        let changed = tx.execute(
            &format!(
                "DELETE FROM {} WHERE id=? AND database_version=?",
                target.table
            ),
            params![target.id, input.target.expected_database_version],
        )?;
        if changed != 1 {
            return Err(StorageError::new("VERSION_CONFLICT", "Record changed"));
        }
        let parent = match parent {
            Some((table, id, version)) => {
                bump(&tx, table, &id, version, now()?)?;
                Some(record(&tx, table, &id)?)
            }
            None => None,
        };
        tx.commit()?;
        Ok(json!({"deletedId":target.id,"parent":parent}))
    }
    pub fn backup(&self) -> Result<Value> {
        let folder = self.directory.join("backups");
        std::fs::create_dir_all(&folder)?;
        let name = format!("storyark-{}-{}.sqlite3", now()?, Uuid::new_v4());
        let partial = folder.join(format!("{name}.partial"));
        let target = folder.join(&name);
        // SQLite's online backup includes committed WAL pages; never copy the live file.
        let outcome = (|| -> Result<()> {
            let mut destination = Connection::open(&partial)?;
            let backup = rusqlite::backup::Backup::new(&self.connection, &mut destination)?;
            backup.run_to_completion(128, Duration::from_millis(5), None)?;
            drop(backup);
            let integrity: String =
                destination.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
            if integrity != "ok" {
                return Err(StorageError::new(
                    "STORAGE_FAILURE",
                    "Backup integrity check failed",
                ));
            }
            drop(destination);
            std::fs::rename(&partial, &target)?;
            Ok(())
        })();
        if outcome.is_err() {
            let _ = std::fs::remove_file(&partial);
        }
        outcome?;
        Ok(json!({"fileName":name}))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateBook {
    pub title: String,
    pub author: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateVolume {
    pub book_id: String,
    pub title: String,
    pub expected_book_version: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateChapter {
    pub book_id: String,
    pub volume_id: String,
    pub title: String,
    pub expected_volume_version: i64,
}
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveChapter {
    pub book_id: String,
    pub volume_id: String,
    pub chapter_id: String,
    pub expected_database_version: i64,
    pub session_key: String,
    pub revision: i64,
    pub title: String,
    pub content_format: String,
    pub content_version: i64,
    pub content: String,
    pub word_count: i64,
    pub foreshadowings: Vec<Value>,
}

// serde flatten and deny_unknown_fields are incompatible, so shared target
// shapes validate IDs and relationships in code instead of denying fields.
#[derive(Deserialize, Clone)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Target {
    Book {
        book_id: String,
    },
    Volume {
        book_id: String,
        volume_id: String,
    },
    Chapter {
        book_id: String,
        volume_id: String,
        chapter_id: String,
    },
}
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExpectedTarget {
    #[serde(flatten)]
    pub target: Target,
    pub expected_database_version: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rename {
    #[serde(flatten)]
    pub target: ExpectedTarget,
    pub title: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetReadOnly {
    #[serde(flatten)]
    pub target: ExpectedTarget,
    pub is_read_only: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reorder {
    pub parent: Option<ExpectedTarget>,
    pub items: Vec<ExpectedTarget>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Delete {
    #[serde(flatten)]
    pub target: ExpectedTarget,
    pub expected_parent_version: Option<i64>,
}

struct Located {
    table: &'static str,
    id: String,
    row: Value,
    ancestors: Vec<(&'static str, Value)>,
}
fn locate(tx: &Connection, target: &Target) -> Result<Located> {
    match target {
        Target::Book { book_id } => {
            valid_id(book_id)?;
            let row = record(tx, "books", book_id)?;
            Ok(Located {
                table: "books",
                id: book_id.clone(),
                row,
                ancestors: vec![],
            })
        }
        Target::Volume { book_id, volume_id } => {
            valid_id(book_id)?;
            valid_id(volume_id)?;
            let book = record(tx, "books", book_id)?;
            let row = record(tx, "volumes", volume_id)?;
            ownership(&row, "bookId", book_id)?;
            Ok(Located {
                table: "volumes",
                id: volume_id.clone(),
                row,
                ancestors: vec![("books", book)],
            })
        }
        Target::Chapter {
            book_id,
            volume_id,
            chapter_id,
        } => {
            valid_id(book_id)?;
            valid_id(volume_id)?;
            valid_id(chapter_id)?;
            let book = record(tx, "books", book_id)?;
            let volume = record(tx, "volumes", volume_id)?;
            ownership(&volume, "bookId", book_id)?;
            let row = record(tx, "chapters", chapter_id)?;
            ownership(&row, "bookId", book_id)?;
            ownership(&row, "volumeId", volume_id)?;
            Ok(Located {
                table: "chapters",
                id: chapter_id.clone(),
                row,
                ancestors: vec![("books", book), ("volumes", volume)],
            })
        }
    }
}
fn unlocked_ancestors(located: &Located) -> Result<()> {
    for (_, ancestor) in &located.ancestors {
        unlocked(ancestor)?;
    }
    Ok(())
}
fn invalid() -> StorageError {
    StorageError::new("INVALID_INPUT", "Invalid storage request")
}
fn title(value: &str) -> Result<()> {
    if value.trim().is_empty() || value.len() > 4096 {
        Err(invalid())
    } else {
        Ok(())
    }
}
fn valid_id(value: &str) -> Result<()> {
    if Uuid::parse_str(value)
        .map(|id| id.to_string() == value)
        .unwrap_or(false)
    {
        Ok(())
    } else {
        Err(invalid())
    }
}
fn now() -> Result<i64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .map_err(|_| invalid())
}
fn unlocked(row: &Value) -> Result<()> {
    if row["isReadOnly"] == true {
        Err(StorageError::new(
            "READ_ONLY",
            "Record or ancestor is locked",
        ))
    } else {
        Ok(())
    }
}
fn ownership(row: &Value, key: &str, id: &str) -> Result<()> {
    if row[key] != id {
        Err(StorageError::new(
            "OWNERSHIP_MISMATCH",
            "Record belongs to another parent",
        ))
    } else {
        Ok(())
    }
}
fn expected(row: &Value, version: i64) -> Result<()> {
    if !(1..MAX_INTEGER).contains(&version) {
        return Err(invalid());
    }
    if row["databaseVersion"] != version {
        return Err(StorageError {
            code: "VERSION_CONFLICT".into(),
            message: "Record changed; reload before resolving the draft".into(),
            current_database_version: row["databaseVersion"].as_i64(),
        });
    }
    Ok(())
}
fn bump(db: &Connection, table: &str, id: &str, version: i64, time: i64) -> Result<()> {
    // Table names are internal constants, never IPC input.
    if db.execute(&format!("UPDATE {table} SET database_version=database_version+1,updated_at=max(updated_at,?) WHERE id=? AND database_version=?"),params![time,id,version])? != 1 { return Err(StorageError::new("VERSION_CONFLICT","Parent changed")); }
    Ok(())
}
fn record(db: &Connection, table: &str, id: &str) -> Result<Value> {
    rows(db, &format!("SELECT * FROM {table} WHERE id=?"), &[&id])?
        .pop()
        .ok_or_else(|| StorageError::new("NOT_FOUND", "Record not found"))
}
fn rows(db: &Connection, sql: &str, args: &[&dyn rusqlite::ToSql]) -> Result<Vec<Value>> {
    let mut statement = db.prepare(sql)?;
    let names: Vec<String> = statement
        .column_names()
        .iter()
        .map(|s| s.to_string())
        .collect();
    let mut cursor = statement.query(args)?;
    let mut output = Vec::new();
    while let Some(row) = cursor.next()? {
        let mut object = serde_json::Map::new();
        let mut body = serde_json::Map::new();
        for (i, name) in names.iter().enumerate() {
            use rusqlite::types::ValueRef;
            let value = match row.get_ref(i)? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(n) => {
                    if name == "is_read_only" {
                        json!(n != 0)
                    } else {
                        json!(n)
                    }
                }
                ValueRef::Text(s) => json!(std::str::from_utf8(s).map_err(|_| invalid())?),
                _ => {
                    return Err(StorageError::new(
                        "STORAGE_FAILURE",
                        "Unexpected column type",
                    ))
                }
            };
            let key = match name.as_str() {
                "content_format" => Some("format"),
                "content_version" => Some("version"),
                "content" => Some("content"),
                "original_content" => Some("originalContent"),
                "original_format" => Some("originalFormat"),
                _ => None,
            };
            if let Some(key) = key {
                body.insert(key.into(), value);
            } else if name == "foreshadowings_json" {
                object.insert(
                    "foreshadowings".into(),
                    serde_json::from_str(value.as_str().ok_or_else(invalid)?).map_err(|_| {
                        StorageError::new("CONTENT_INCOMPATIBLE", "Stored notes are invalid")
                    })?,
                );
            } else {
                let mut parts = name.split('_');
                let mut key = parts.next().unwrap_or_default().to_owned();
                for part in parts {
                    let mut chars = part.chars();
                    if let Some(c) = chars.next() {
                        key.extend(c.to_uppercase());
                        key.extend(chars);
                    }
                }
                object.insert(key, value);
            }
        }
        if !body.is_empty() {
            object.insert("body".into(), Value::Object(body));
        }
        output.push(Value::Object(object));
    }
    Ok(output)
}
