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
mod import;
mod library;
mod mutations;
mod planning;
mod planning_cleanup;
mod planning_validation;
mod preferences;
mod records;
mod requests;
mod retrieval_sources;
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
pub use import::{ImportWork, PrepareWorkImport};
pub use planning::SavePlanning;
pub use preferences::SavePreferences;
pub use requests::*;
pub use retrieval_sources::{ListRetrievalSources, SyncRetrievalSources};

use rusqlite::Connection;
use serde_json::Value;
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

#[derive(Clone)]
pub struct Storage(Arc<StorageInner>);

struct StorageInner {
    database: Mutex<Database>,
    cancelled_imports: Mutex<HashSet<String>>,
}

#[cfg(test)]
impl StorageInner {
    fn lock(&self) -> std::sync::LockResult<std::sync::MutexGuard<'_, Database>> {
        self.database.lock()
    }
}

impl Storage {
    pub fn open(directory: &Path) -> Result<Self> {
        Ok(Self(Arc::new(StorageInner {
            database: Mutex::new(Database::open(directory)?),
            cancelled_imports: Mutex::new(HashSet::new()),
        })))
    }
    pub fn cancel_import(&self, request_id: String) {
        if let Ok(mut requests) = self.0.cancelled_imports.lock() {
            requests.insert(request_id);
        }
    }
    pub fn clear_import_cancel(&self, request_id: &str) {
        if let Ok(mut requests) = self.0.cancelled_imports.lock() {
            requests.remove(request_id);
        }
    }
    pub fn is_import_cancelled(&self, request_id: Option<&str>) -> bool {
        request_id.is_some_and(|id| {
            self.0
                .cancelled_imports
                .lock()
                .map(|requests| requests.contains(id))
                .unwrap_or(true)
        })
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
                .database
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
