use crate::commands::Reply;
use crate::storage::{ListRetrievalSources, Storage, SyncRetrievalSources};

#[tauri::command]
pub async fn local_sync_retrieval_sources(
    storage: tauri::State<'_, Storage>,
    input: SyncRetrievalSources,
) -> Result<Reply, ()> {
    Ok(storage
        .run(move |db| db.sync_retrieval_sources(&input.book_id))
        .await
        .into())
}

#[tauri::command]
pub async fn local_list_retrieval_sources(
    storage: tauri::State<'_, Storage>,
    input: ListRetrievalSources,
) -> Result<Reply, ()> {
    Ok(storage
        .run(move |db| db.list_retrieval_sources(input))
        .await
        .into())
}
