use crate::commands::Reply;
use crate::storage::{SaveGraph, Storage};

#[tauri::command]
pub async fn local_read_graph(
    storage: tauri::State<'_, Storage>,
    book_id: String,
) -> Result<Reply, ()> {
    Ok(storage.run(move |db| db.read_graph(&book_id)).await.into())
}

#[tauri::command]
pub async fn local_initialize_graph(
    storage: tauri::State<'_, Storage>,
    book_id: String,
) -> Result<Reply, ()> {
    Ok(storage
        .run(move |db| db.initialize_graph(&book_id))
        .await
        .into())
}

#[tauri::command]
pub async fn local_save_graph(
    storage: tauri::State<'_, Storage>,
    input: SaveGraph,
) -> Result<Reply, ()> {
    Ok(storage.run(move |db| db.save_graph(input)).await.into())
}
