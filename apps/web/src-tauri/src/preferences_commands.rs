use crate::commands::Reply;
use crate::storage::{SavePreferences, Storage};

#[tauri::command]
pub async fn local_read_preferences(storage: tauri::State<'_, Storage>) -> Result<Reply, ()> {
    Ok(storage.run(|db| db.read_preferences()).await.into())
}

#[tauri::command]
pub async fn local_save_preferences(
    storage: tauri::State<'_, Storage>,
    input: SavePreferences,
) -> Result<Reply, ()> {
    Ok(storage
        .run(move |db| db.save_preferences(input))
        .await
        .into())
}
