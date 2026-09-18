use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use uuid::Uuid;

const EXPORT_WRITE_ERROR: &str =
    "The selected export destination could not be written. Check that it is writable and not locked.";

#[derive(Debug, Deserialize)]
pub struct SaveWorkExportInput {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct SaveWorkExportResult {
    #[serde(rename = "byteLength")]
    pub byte_length: usize,
}

/// Save an already validated export to the user-selected path.
///
/// The dialog plugin selects the destination, while this command performs the
/// actual write outside the app-data fs scope. The temporary file is verified
/// before it replaces the destination, and an existing file is restored when
/// the replacement fails.
#[tauri::command]
pub async fn local_save_work_export(
    input: SaveWorkExportInput,
) -> Result<SaveWorkExportResult, String> {
    if input.path.trim().is_empty() {
        return Err(EXPORT_WRITE_ERROR.to_owned());
    }

    let path = input.path;
    let bytes = input.content.into_bytes();
    let byte_length = tauri::async_runtime::spawn_blocking(move || {
        write_verified_export(Path::new(&path), &bytes)
    })
    .await
    .map_err(|_| EXPORT_WRITE_ERROR.to_owned())?
    .map_err(|_| EXPORT_WRITE_ERROR.to_owned())?;

    Ok(SaveWorkExportResult { byte_length })
}

fn write_verified_export(destination: &Path, bytes: &[u8]) -> Result<usize, ()> {
    let parent = destination.parent().unwrap_or_else(|| Path::new("."));
    if !parent.is_dir() {
        return Err(());
    }

    let token = Uuid::new_v4().simple().to_string();
    let temporary_path = parent.join(format!(".storyark-export-{token}.tmp"));
    let backup_path = parent.join(format!(".storyark-export-{token}.bak"));

    if fs::write(&temporary_path, bytes).is_err() {
        let _ = fs::remove_file(&temporary_path);
        return Err(());
    }

    let verified_bytes = match fs::read(&temporary_path) {
        Ok(value) if value == bytes => value,
        _ => {
            let _ = fs::remove_file(&temporary_path);
            return Err(());
        }
    };

    let destination_exists = destination.exists();
    if destination_exists && fs::rename(destination, &backup_path).is_err() {
        let _ = fs::remove_file(&temporary_path);
        return Err(());
    }

    if fs::rename(&temporary_path, destination).is_err() {
        let _ = fs::remove_file(&temporary_path);
        if destination_exists {
            if !destination.exists() {
                let _ = fs::rename(&backup_path, destination);
            }
        }
        return Err(());
    }

    if destination_exists {
        let _ = fs::remove_file(&backup_path);
    }

    Ok(verified_bytes.len())
}

#[cfg(test)]
mod tests {
    use super::write_verified_export;
    use std::fs;
    use std::path::PathBuf;
    use uuid::Uuid;

    fn test_directory() -> PathBuf {
        let directory = std::env::temp_dir().join(format!("storyark-export-{}", Uuid::new_v4()));
        fs::create_dir(&directory).expect("create export test directory");
        directory
    }

    #[test]
    fn writes_and_replaces_a_verified_export() {
        let directory = test_directory();
        let destination = directory.join("work.storyark.json");

        assert_eq!(
            write_verified_export(&destination, br#"{"schemaVersion":1}"#),
            Ok(19)
        );
        assert_eq!(
            fs::read(&destination).expect("read first export"),
            br#"{"schemaVersion":1}"#
        );

        assert_eq!(
            write_verified_export(&destination, br#"{"schemaVersion":2}"#),
            Ok(19)
        );
        assert_eq!(
            fs::read(&destination).expect("read replaced export"),
            br#"{"schemaVersion":2}"#
        );

        fs::remove_dir_all(directory).expect("remove export test directory");
    }
}
