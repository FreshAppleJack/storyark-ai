use super::validation::now;
use super::{Database, Result, StorageError};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::{path::Path, time::Duration};
use uuid::Uuid;

impl Database {
    pub fn backup(&self) -> Result<Value> {
        Ok(json!({"fileName": backup_database(&self.connection, &self.directory)?}))
    }
}

/// Consistent online backup of the current database into `<directory>/backups`.
/// Used both by the backup command and automatically before every upgrade.
/// Returns the backup file name; a failed backup never leaves a partial file.
pub(super) fn backup_database(connection: &Connection, directory: &Path) -> Result<String> {
    let folder = directory.join("backups");
    std::fs::create_dir_all(&folder)?;
    let name = format!("storyark-{}-{}.sqlite3", now()?, Uuid::new_v4());
    let partial = folder.join(format!("{name}.partial"));
    let target = folder.join(&name);
    // SQLite's online backup includes committed WAL pages; never copy the live file.
    let outcome = (|| -> Result<()> {
        let mut destination = Connection::open(&partial)?;
        destination.pragma_update(None, "foreign_keys", true)?;
        let backup = rusqlite::backup::Backup::new(connection, &mut destination)?;
        backup.run_to_completion(128, Duration::from_millis(5), None)?;
        drop(backup);
        let integrity: String = destination.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
        if integrity != "ok" {
            return Err(StorageError::new(
                "STORAGE_FAILURE",
                "Backup integrity check failed",
            ));
        }
        if destination
            .prepare("PRAGMA foreign_key_check")?
            .exists([])?
        {
            return Err(StorageError::new(
                "STORAGE_FAILURE",
                "Backup foreign-key integrity check failed",
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
    Ok(name)
}
