use crate::commands::Reply;
use crate::storage::{SaveBrainstorm, Storage};

#[tauri::command]
pub async fn local_read_brainstorm(
    storage: tauri::State<'_, Storage>,
    book_id: String,
) -> Result<Reply, ()> {
    Ok(storage
        .run(move |db| db.read_brainstorm(&book_id))
        .await
        .into())
}

#[tauri::command]
pub async fn local_save_brainstorm(
    storage: tauri::State<'_, Storage>,
    input: SaveBrainstorm,
) -> Result<Reply, ()> {
    Ok(storage
        .run(move |db| db.save_brainstorm(input))
        .await
        .into())
}
