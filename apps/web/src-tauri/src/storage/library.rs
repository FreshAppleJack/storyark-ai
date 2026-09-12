use super::records::{bump, record, rows};
use super::requests::{CreateBook, CreateChapter, CreateVolume, SaveChapter};
use super::validation::{
    cover_color, expected, invalid, now, ownership, title, unlocked, valid_id, MAX_INTEGER,
};
use super::{content, Database, Result, StorageError};
use rusqlite::{params, TransactionBehavior};
use serde_json::{json, Value};
use uuid::Uuid;

impl Database {
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
        cover_color(&input.cover_color)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let id = Uuid::new_v4().to_string();
        let now = now()?;
        tx.execute("INSERT INTO books(id,title,author,cover_color,position,created_at,updated_at) VALUES (?,?,?,?,(SELECT coalesce(max(position)+1,0) FROM books),?,?)", params![id,input.title,input.author,input.cover_color,now,now])?;
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
}
