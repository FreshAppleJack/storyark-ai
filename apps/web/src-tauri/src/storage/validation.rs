use super::{Result, StorageError};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub(super) const MAX_INTEGER: i64 = 9_007_199_254_740_991;

pub(super) fn invalid() -> StorageError {
    StorageError::new("INVALID_INPUT", "Invalid storage request")
}
pub(super) fn title(value: &str) -> Result<()> {
    if value.trim().is_empty() || value.len() > 4096 {
        Err(invalid())
    } else {
        Ok(())
    }
}
pub(super) fn valid_id(value: &str) -> Result<()> {
    if Uuid::parse_str(value)
        .map(|id| id.to_string() == value)
        .unwrap_or(false)
    {
        Ok(())
    } else {
        Err(invalid())
    }
}
pub(super) fn now() -> Result<i64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .map_err(|_| invalid())
}
pub(super) fn unlocked(row: &Value) -> Result<()> {
    if row["isReadOnly"] == true {
        Err(StorageError::new(
            "READ_ONLY",
            "Record or ancestor is locked",
        ))
    } else {
        Ok(())
    }
}
pub(super) fn ownership(row: &Value, key: &str, id: &str) -> Result<()> {
    if row[key] != id {
        Err(StorageError::new(
            "OWNERSHIP_MISMATCH",
            "Record belongs to another parent",
        ))
    } else {
        Ok(())
    }
}
pub(super) fn expected(row: &Value, version: i64) -> Result<()> {
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
