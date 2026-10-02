//! Local diagnostics only. Never pass request bodies, credentials or story text here.
use serde::Serialize;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_BYTES: u64 = 1024 * 1024;
const MAX_MESSAGE_CHARS: usize = 6000;
static LOGGER: OnceLock<Mutex<ErrorLog>> = OnceLock::new();

struct ErrorLog {
    path: PathBuf,
    fallback: PathBuf,
}

/// Defense in depth; callers must still omit author text and provider response bodies.
fn redact(text: &str) -> String {
    text.lines()
        .map(|line| {
            let lower = line.to_ascii_lowercase();
            if [
                "authorization",
                "bearer ",
                "api_key",
                "apikey",
                "api-key",
                "password",
                "secret",
                "token=",
                "token:",
                "token\"",
                "sk-",
            ]
            .iter()
            .any(|needle| lower.contains(needle))
            {
                "[sensitive diagnostic redacted]".to_string()
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
        .chars()
        .take(MAX_MESSAGE_CHARS)
        .collect()
}

fn open_path(directory: &Path) -> std::io::Result<PathBuf> {
    fs::create_dir_all(directory)?;
    let path = directory.join("storyark-errors.log");
    OpenOptions::new().create(true).append(true).open(&path)?;
    Ok(path)
}

impl ErrorLog {
    fn open(preferred: &Path, fallback: &Path) -> std::io::Result<Self> {
        Ok(Self {
            path: open_path(preferred).or_else(|_| open_path(fallback))?,
            fallback: fallback.to_path_buf(),
        })
    }

    fn append(&mut self, line: &str) -> std::io::Result<()> {
        let result = self.write(line);
        if result.is_err() && self.path.parent() != Some(self.fallback.as_path()) {
            self.path = open_path(&self.fallback)?;
            return self.write(line);
        }
        result
    }

    fn write(&self, line: &str) -> std::io::Result<()> {
        if fs::metadata(&self.path).is_ok_and(|m| m.len() + line.len() as u64 > MAX_BYTES) {
            let older = self.path.with_extension("log.2");
            let previous = self.path.with_extension("log.1");
            if older.exists() {
                fs::remove_file(&older)?;
            }
            if previous.exists() {
                fs::rename(&previous, &older)?;
            }
            fs::rename(&self.path, &previous)?;
        }
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        file.write_all(line.as_bytes())?;
        file.flush()
    }
}

pub fn initialize(fallback: PathBuf) {
    let preferred = std::env::var_os("STORYARK_LOG_DIR")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(Path::to_path_buf))
        })
        .unwrap_or_else(|| fallback.clone());
    match ErrorLog::open(&preferred, &fallback) {
        Ok(log) => {
            if cfg!(debug_assertions) {
                eprintln!("StoryArk error log: {}", log.path.display());
            }
            let _ = LOGGER.set(Mutex::new(log));
        }
        Err(error) => eprintln!("StoryArk could not open an error log: {error}"),
    }
}

pub fn record(operation: &str, code: &str, message: &str) {
    if code == "CANCELLED" {
        return;
    }
    let entry = serde_json::json!({
        "timestampUnixMs": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis(),
        "appVersion": env!("CARGO_PKG_VERSION"),
        "operation": redact(operation), "code": redact(code), "message": redact(message),
    });
    if let Some(logger) = LOGGER.get() {
        if cfg!(debug_assertions) {
            eprintln!("StoryArk error: {entry}");
        }
        if let Ok(mut log) = logger.lock() {
            if let Err(error) = log.append(&format!("{entry}\n")) {
                eprintln!("StoryArk could not write an error log: {error}");
            }
        }
    }
}

pub fn install_panic_hook() {
    let original = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // A panic payload can contain user data. Log its location and stack only.
        record(
            "panic",
            "PANIC",
            &format!(
                "{}\n{}",
                info.location()
                    .map(|p| format!("{}:{}:{}", p.file(), p.line(), p.column()))
                    .unwrap_or_else(|| "Location unavailable".into()),
                std::backtrace::Backtrace::force_capture()
            ),
        );
        original(info);
    }));
}

pub fn startup_failure(message: &str) {
    if LOGGER.get().is_none() {
        // App-data resolution itself can fail before setup initializes logging.
        initialize(std::env::temp_dir().join("StoryArk").join("logs"));
    }
    record("startup", "STARTUP_FAILURE", message);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorLogInfo {
    path: Option<String>,
}

#[tauri::command]
pub fn diagnostic_log_info() -> ErrorLogInfo {
    ErrorLogInfo {
        path: LOGGER
            .get()
            .and_then(|l| l.lock().ok())
            .map(|l| l.path.to_string_lossy().into_owned()),
    }
}

#[tauri::command]
pub fn diagnostic_report_error(operation: String, code: String, message: String) {
    record(
        &operation.chars().take(100).collect::<String>(),
        &code.chars().take(80).collect::<String>(),
        &message,
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    fn directory() -> PathBuf {
        std::env::temp_dir().join(format!("storyark-log-test-{}", uuid::Uuid::new_v4()))
    }
    #[test]
    fn redacts_credentials_and_bounds_diagnostics() {
        let result = redact("Error TIMEOUT\nAuthorization: Bearer private-value\napiKey=private-value\nhttps://service/?token=private-value\ntrace at tasks.rs:42");
        assert!(!result.contains("private-value"));
        assert!(result.contains("TIMEOUT"));
        assert!(result.contains("tasks.rs:42"));
        assert_eq!(redact(&"x".repeat(9000)).len(), MAX_MESSAGE_CHARS);
    }
    #[test]
    fn falls_back_when_preferred_directory_is_unusable() {
        let root = directory();
        fs::create_dir_all(&root).unwrap();
        let blocked = root.join("file");
        fs::write(&blocked, "not a directory").unwrap();
        let fallback = root.join("logs");
        let mut log = ErrorLog::open(&blocked, &fallback).unwrap();
        log.append("diagnostic\n").unwrap();
        assert_eq!(
            fs::read_to_string(fallback.join("storyark-errors.log")).unwrap(),
            "diagnostic\n"
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn rotates_and_retains_two_previous_logs() {
        let root = directory();
        let mut log = ErrorLog::open(&root, &root).unwrap();
        for i in 0..5 {
            fs::write(&log.path, "x".repeat(MAX_BYTES as usize)).unwrap();
            log.append(&format!("entry {i}\n")).unwrap();
        }
        assert_eq!(fs::read_to_string(&log.path).unwrap(), "entry 4\n");
        assert!(log.path.with_extension("log.1").exists());
        assert!(log.path.with_extension("log.2").exists());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 3);
        fs::remove_dir_all(root).unwrap();
    }
}
