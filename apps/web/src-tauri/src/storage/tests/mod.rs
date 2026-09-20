use super::*;
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use uuid::Uuid;

mod backup;
mod brainstorm;
mod characters;
mod export;
mod graph;
mod import;
mod ipc;
mod library;
mod migrations;
mod mutations;
mod planning;
mod preferences;
mod retrieval;
mod worker;

struct TempDirectory(PathBuf);
impl TempDirectory {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!("storyark-storage-test-{}", Uuid::new_v4())))
    }
}
impl Drop for TempDirectory {
    fn drop(&mut self) {
        // Only remove the unique test directory created under the OS temp root.
        if self.0.parent() == Some(std::env::temp_dir().as_path())
            && self
                .0
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("storyark-storage-test-")
        {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}
fn fixture(db: &mut Database) -> SaveChapter {
    let book = db
        .create_book(CreateBook {
            title: "Book".into(),
            author: "Writer".into(),
            cover_color: "bg-blue-600".into(),
        })
        .unwrap();
    let book_id = book["id"].as_str().unwrap().to_string();
    let volume = db
        .create_volume(CreateVolume {
            book_id: book_id.clone(),
            title: "Volume".into(),
            expected_book_version: 1,
        })
        .unwrap();
    let volume_id = volume["volume"]["id"].as_str().unwrap().to_string();
    let chapter = db
        .create_chapter(CreateChapter {
            book_id: book_id.clone(),
            volume_id: volume_id.clone(),
            title: "Chapter".into(),
            expected_volume_version: 1,
        })
        .unwrap();
    SaveChapter {
        book_id,volume_id,chapter_id:chapter["chapter"]["id"].as_str().unwrap().into(),
        expected_database_version:1,session_key:"editor-session-1".into(),revision:7,
        title:"New title".into(),content_format:"tiptap-json".into(),content_version:1,
        content:json!({"type":"doc","content":[{"type":"paragraph","attrs":{"textAlign":"left"},"content":[
            {"type":"text","text":"你好，世界。","marks":[{"type":"bold"}]},
            {"type":"mention","attrs":{"id":"legacy-character","label":"Alice","color":"#123456"},"marks":[{"type":"foreshadowing","attrs":{"id":"legacy-note"}}]}
        ]}]}).to_string(),word_count:9,
        foreshadowings:vec![json!({"id":"legacy-note","excerpt":"Alice","note":"Return later","createdAt":1,"updatedAt":2,"extra":{"preserve":true}})],
    }
}

mod ai_settings;
