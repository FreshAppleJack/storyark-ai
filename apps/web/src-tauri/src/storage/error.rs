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
    #[track_caller]
    pub fn new(code: &str, message: &str) -> Self {
        let location = std::panic::Location::caller();
        crate::diagnostics::record(
            "desktop",
            code,
            &format!(
                "{message}\n{}:{}:{}",
                location.file(),
                location.line(),
                location.column()
            ),
        );
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
    fn from(error: rusqlite::Error) -> Self {
        crate::diagnostics::record("sqlite", "STORAGE_FAILURE", &error.to_string());
        Self::new(
            "STORAGE_FAILURE",
            "SQLite operation failed; stored data was not reset",
        )
    }
}
impl From<std::io::Error> for StorageError {
    fn from(error: std::io::Error) -> Self {
        crate::diagnostics::record("filesystem", "STORAGE_FAILURE", &error.to_string());
        Self::new("STORAGE_FAILURE", "Cannot access local storage")
    }
}
