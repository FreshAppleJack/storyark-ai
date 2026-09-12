use crate::storage::{CreateBook, CreateChapter, CreateVolume, SaveChapter, Storage, StorageError};
use serde::Serialize;
use serde_json::Value;

#[derive(Serialize)]
#[serde(untagged)]
pub enum Reply {
    Success { ok: bool, value: Value },
    Failure { ok: bool, error: StorageError },
}
impl From<crate::storage::Result<Value>> for Reply {
    fn from(result: crate::storage::Result<Value>) -> Self {
        match result {
            Ok(value) => Self::Success { ok: true, value },
            Err(error) => Self::Failure { ok: false, error },
        }
    }
}
#[tauri::command]
pub async fn local_list_books(storage: tauri::State<'_, Storage>) -> Result<Reply, ()> {
    Ok(storage.run(|db| db.list_books()).await.into())
}
#[tauri::command]
pub async fn local_read_book(
    storage: tauri::State<'_, Storage>,
    book_id: String,
) -> Result<Reply, ()> {
    Ok(storage.run(move |db| db.read_book(&book_id)).await.into())
}
#[tauri::command]
pub async fn local_create_book(
    storage: tauri::State<'_, Storage>,
    input: CreateBook,
) -> Result<Reply, ()> {
    Ok(storage.run(move |db| db.create_book(input)).await.into())
}
#[tauri::command]
pub async fn local_create_volume(
    storage: tauri::State<'_, Storage>,
    input: CreateVolume,
) -> Result<Reply, ()> {
    Ok(storage.run(move |db| db.create_volume(input)).await.into())
}
#[tauri::command]
pub async fn local_create_chapter(
    storage: tauri::State<'_, Storage>,
    input: CreateChapter,
) -> Result<Reply, ()> {
    Ok(storage.run(move |db| db.create_chapter(input)).await.into())
}
#[tauri::command]
pub async fn local_save_chapter(
    storage: tauri::State<'_, Storage>,
    input: SaveChapter,
) -> Result<Reply, ()> {
    Ok(storage.run(move |db| db.save_chapter(input)).await.into())
}
#[tauri::command]
pub async fn local_backup(storage: tauri::State<'_, Storage>) -> Result<Reply, ()> {
    Ok(storage.run(|db| db.backup()).await.into())
}
