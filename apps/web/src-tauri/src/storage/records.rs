use super::validation::invalid;
use super::{Result, StorageError};
use rusqlite::{params, Connection};
use serde_json::{json, Value};

pub(super) fn bump(db: &Connection, table: &str, id: &str, version: i64, time: i64) -> Result<()> {
    // Table names are internal constants, never IPC input.
    if db.execute(&format!("UPDATE {table} SET database_version=database_version+1,updated_at=max(updated_at,?) WHERE id=? AND database_version=?"),params![time,id,version])? != 1 { return Err(StorageError::new("VERSION_CONFLICT","Parent changed")); }
    Ok(())
}
pub(super) fn record(db: &Connection, table: &str, id: &str) -> Result<Value> {
    rows(db, &format!("SELECT * FROM {table} WHERE id=?"), &[&id])?
        .pop()
        .ok_or_else(|| StorageError::new("NOT_FOUND", "Record not found"))
}
pub(super) fn rows(
    db: &Connection,
    sql: &str,
    args: &[&dyn rusqlite::ToSql],
) -> Result<Vec<Value>> {
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
                    if name == "is_read_only" || name == "is_archived" {
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
            } else if matches!(
                name.as_str(),
                "foreshadowings_json" | "aliases_json" | "tags_json"
            ) {
                let parsed: Value = serde_json::from_str(value.as_str().ok_or_else(invalid)?)
                    .map_err(|_| {
                        StorageError::new("CONTENT_INCOMPATIBLE", "Stored JSON field is invalid")
                    })?;
                let key = match name.as_str() {
                    "foreshadowings_json" => "foreshadowings",
                    "aliases_json" => "aliases",
                    "tags_json" => "tags",
                    _ => unreachable!(),
                };
                object.insert(key.into(), parsed);
            } else if name == "handle_config_json" {
                let parsed: Value = match value.as_str() {
                    Some(raw) => serde_json::from_str(raw).map_err(|_| {
                        StorageError::new("CONTENT_INCOMPATIBLE", "Stored handle config is invalid")
                    })?,
                    None => Value::Null,
                };
                object.insert("handleConfig".into(), parsed);
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
