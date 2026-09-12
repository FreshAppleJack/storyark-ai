use crate::storage::{
    ArchiveCharacter, CreateBook, CreateChapter, CreateCharacter, CreateVolume, Delete, Rename,
    Reorder, ReorderCharacters, SaveChapter, SetReadOnly, Storage, StorageError, UpdateBook,
    UpdateCharacter,
};
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
pub async fn local_rename(storage: tauri::State<'_, Storage>, input: Rename) -> Result<Reply, ()> {
    Ok(storage.run(move |db| db.rename(input)).await.into())
}
#[tauri::command]
pub async fn local_update_book(
    storage: tauri::State<'_, Storage>,
    input: UpdateBook,
) -> Result<Reply, ()> {
    Ok(storage.run(move |db| db.update_book(input)).await.into())
}
#[tauri::command]
pub async fn local_set_read_only(
    storage: tauri::State<'_, Storage>,
    input: SetReadOnly,
) -> Result<Reply, ()> {
    Ok(storage.run(move |db| db.set_read_only(input)).await.into())
}
#[tauri::command]
pub async fn local_reorder(
    storage: tauri::State<'_, Storage>,
    input: Reorder,
) -> Result<Reply, ()> {
    Ok(storage.run(move |db| db.reorder(input)).await.into())
}
#[tauri::command]
pub async fn local_delete(storage: tauri::State<'_, Storage>, input: Delete) -> Result<Reply, ()> {
    Ok(storage.run(move |db| db.delete(input)).await.into())
}
#[tauri::command]
pub async fn local_list_characters(
    storage: tauri::State<'_, Storage>,
    book_id: String,
) -> Result<Reply, ()> {
    Ok(storage
        .run(move |db| db.list_characters(&book_id))
        .await
        .into())
}
#[tauri::command]
pub async fn local_create_character(
    storage: tauri::State<'_, Storage>,
    input: CreateCharacter,
) -> Result<Reply, ()> {
    Ok(storage
        .run(move |db| db.create_character(input))
        .await
        .into())
}
#[tauri::command]
pub async fn local_update_character(
    storage: tauri::State<'_, Storage>,
    input: UpdateCharacter,
) -> Result<Reply, ()> {
    Ok(storage
        .run(move |db| db.update_character(input))
        .await
        .into())
}
#[tauri::command]
pub async fn local_archive_character(
    storage: tauri::State<'_, Storage>,
    input: ArchiveCharacter,
) -> Result<Reply, ()> {
    Ok(storage
        .run(move |db| db.archive_character(input))
        .await
        .into())
}
#[tauri::command]
pub async fn local_backup(storage: tauri::State<'_, Storage>) -> Result<Reply, ()> {
    Ok(storage.run(|db| db.backup()).await.into())
}

#[tauri::command]
pub async fn local_reorder_characters(
    storage: tauri::State<'_, Storage>,
    input: ReorderCharacters,
) -> Result<Reply, ()> {
    Ok(storage
        .run(move |db| db.reorder_characters(input))
        .await
        .into())
}
