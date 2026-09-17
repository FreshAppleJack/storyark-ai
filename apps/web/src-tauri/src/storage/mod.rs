//! Local storage facade. Business modules share one connection owner and keep
//! their transaction boundaries inside each Database operation.
mod ai_cleanup;
mod ai_generation;
mod ai_settings;
mod backup;
mod brainstorm;
mod character_order;
mod characters;
mod content;
mod database;
mod error;
mod export;
mod foreshadowing;
mod graph;
mod graph_types;
mod graph_validation;
mod library;
mod mutations;
mod planning;
mod planning_cleanup;
mod planning_validation;
mod preferences;
mod records;
mod requests;
mod targets;
#[cfg(test)]
mod tests;
mod validation;

pub use brainstorm::SaveBrainstorm;
#[cfg(test)]
pub use character_order::CharacterOrderItem;
pub use character_order::ReorderCharacters;
pub use error::{Result, StorageError};
pub use foreshadowing::UpdateNote;
pub use graph_types::SaveGraph;
pub use planning::SavePlanning;
pub use preferences::SavePreferences;
pub use requests::*;

use rusqlite::Connection;
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

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
        self.run_typed(operation).await
    }
    pub async fn run_typed<T: Send + 'static, F>(&self, operation: F) -> Result<T>
    where
        F: FnOnce(&mut Database) -> Result<T> + Send + 'static,
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
    credentials: crate::ai::credentials::Credentials,
}
