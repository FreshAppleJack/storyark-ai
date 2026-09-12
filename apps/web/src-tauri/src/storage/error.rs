use serde::Serialize;

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
