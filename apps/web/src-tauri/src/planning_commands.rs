use crate::commands::Reply;
use crate::storage::{SavePlanning, Storage, UpdateNote};

#[tauri::command]
pub async fn local_update_note(
    storage: tauri::State<'_, Storage>,
    input: UpdateNote,
) -> Result<Reply, ()> {
    Ok(storage.run(move |db| db.update_note(input)).await.into())
}
#[tauri::command]
pub async fn local_read_planning(
    storage: tauri::State<'_, Storage>,
    book_id: String,
) -> Result<Reply, ()> {
    Ok(storage
        .run(move |db| db.read_planning(&book_id))
        .await
        .into())
}
#[tauri::command]
pub async fn local_save_planning(
    storage: tauri::State<'_, Storage>,
    input: SavePlanning,
) -> Result<Reply, ()> {
    Ok(storage.run(move |db| db.save_planning(input)).await.into())
}
