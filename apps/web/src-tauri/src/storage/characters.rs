use super::records::{bump, record, rows};
use super::requests::{ArchiveCharacter, CharacterInput, CreateCharacter, UpdateCharacter};
use super::validation::{expected, invalid, now, ownership, title, unlocked, valid_id};
use super::{Database, Result, StorageError};
use rusqlite::{params, TransactionBehavior};
use serde_json::{json, Value};
use uuid::Uuid;

impl Database {
    pub fn list_characters(&self, book_id: &str) -> Result<Value> {
        valid_id(book_id)?;
        Ok(Value::Array(rows(
            &self.connection,
            "SELECT * FROM characters WHERE book_id=? ORDER BY position,id",
            &[&book_id],
        )?))
    }
    pub fn create_character(&mut self, input: CreateCharacter) -> Result<Value> {
        valid_id(&input.character.book_id)?;
        validate_character(&input.character)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let book = record(&tx, "books", &input.character.book_id)?;
        unlocked(&book)?;
        expected(&book, input.expected_book_version)?;
        let id = Uuid::new_v4().to_string();
        let now = now()?;
        let aliases = serde_json::to_string(&input.character.aliases).map_err(|_| invalid())?;
        let tags = serde_json::to_string(&input.character.tags).map_err(|_| invalid())?;
        let handle = match &input.character.handle_config {
            Some(config) => Some(serde_json::to_string(config).map_err(|_| invalid())?),
            None => None,
        };
        tx.execute("INSERT INTO characters(id,book_id,name,aliases_json,role,description,color,tags_json,avatar,handle_config_json,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,(SELECT coalesce(max(position)+1,0) FROM characters WHERE book_id=?),?,?)", params![id,input.character.book_id,input.character.name,aliases,input.character.role,input.character.description,input.character.color,tags,input.character.avatar,handle,input.character.book_id,now,now])?;
        bump(
            &tx,
            "books",
            &input.character.book_id,
            input.expected_book_version,
            now,
        )?;
        let result = json!({"character":record(&tx,"characters",&id)?,"book":record(&tx,"books",&input.character.book_id)?});
        tx.commit()?;
        Ok(result)
    }
    pub fn update_character(&mut self, input: UpdateCharacter) -> Result<Value> {
        valid_id(&input.character.book_id)?;
        valid_id(&input.character_id)?;
        validate_character(&input.character)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let book = record(&tx, "books", &input.character.book_id)?;
        let character = record(&tx, "characters", &input.character_id)?;
        ownership(&character, "bookId", &input.character.book_id)?;
        unlocked(&book)?;
        expected(&character, input.expected_database_version)?;
        let aliases = serde_json::to_string(&input.character.aliases).map_err(|_| invalid())?;
        let tags = serde_json::to_string(&input.character.tags).map_err(|_| invalid())?;
        let handle = match &input.character.handle_config {
            Some(config) => Some(serde_json::to_string(config).map_err(|_| invalid())?),
            None => None,
        };
        let changed = tx.execute("UPDATE characters SET name=?,aliases_json=?,role=?,description=?,color=?,tags_json=?,avatar=?,handle_config_json=?,database_version=database_version+1,updated_at=max(updated_at,?) WHERE id=? AND database_version=?", params![input.character.name,aliases,input.character.role,input.character.description,input.character.color,tags,input.character.avatar,handle,now()?,input.character_id,input.expected_database_version])?;
        if changed != 1 {
            return Err(StorageError::new("VERSION_CONFLICT", "Record changed"));
        }
        if character["handleConfig"] != input.character.handle_config.clone().unwrap_or(Value::Null)
        {
            super::graph::character_defaults_changed(
                &tx,
                &input.character.book_id,
                &input.character_id,
            )?;
        }
        let result = record(&tx, "characters", &input.character_id)?;
        tx.commit()?;
        Ok(result)
    }
    pub fn archive_character(&mut self, input: ArchiveCharacter) -> Result<Value> {
        valid_id(&input.book_id)?;
        valid_id(&input.character_id)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let book = record(&tx, "books", &input.book_id)?;
        let character = record(&tx, "characters", &input.character_id)?;
        ownership(&character, "bookId", &input.book_id)?;
        unlocked(&book)?;
        expected(&character, input.expected_database_version)?;
        let changed = tx.execute("UPDATE characters SET is_archived=?,database_version=database_version+1,updated_at=max(updated_at,?) WHERE id=? AND database_version=?", params![input.is_archived,now()?,input.character_id,input.expected_database_version])?;
        if changed != 1 {
            return Err(StorageError::new("VERSION_CONFLICT", "Record changed"));
        }
        let result = record(&tx, "characters", &input.character_id)?;
        tx.commit()?;
        Ok(result)
    }
}

const CHARACTER_ROLES: [&str; 4] = ["protagonist", "antagonist", "supporting", "mob"];
const HANDLE_SIDES: [&str; 4] = ["top", "right", "bottom", "left"];
const HANDLE_MODES: [&str; 4] = ["source", "target", "both", "none"];

fn validate_character(input: &CharacterInput) -> Result<()> {
    title(&input.name)?;
    if !CHARACTER_ROLES.contains(&input.role.as_str()) {
        return Err(invalid());
    }
    if input.color.trim().is_empty() || input.color.len() > 64 {
        return Err(invalid());
    }
    if input.description.len() > 65536 {
        return Err(invalid());
    }
    for list in [&input.aliases, &input.tags] {
        if list.len() > 256 || list.iter().any(|item| item.len() > 256) {
            return Err(invalid());
        }
    }
    if let Some(avatar) = &input.avatar {
        if avatar.len() > 1024 {
            return Err(invalid());
        }
    }
    if let Some(config) = &input.handle_config {
        let object = config.as_object().ok_or_else(invalid)?;
        if object.len() > 4 {
            return Err(invalid());
        }
        for (side, mode) in object {
            if !HANDLE_SIDES.contains(&side.as_str())
                || !HANDLE_MODES.contains(&mode.as_str().ok_or_else(invalid)?)
            {
                return Err(invalid());
            }
        }
    }
    Ok(())
}
