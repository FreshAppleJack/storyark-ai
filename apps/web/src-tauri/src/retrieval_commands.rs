use crate::commands::Reply;
use crate::rag::contracts::{RetrievalSearchMode, RetrievalSearchRequest};
use crate::rag::embeddings::{current_fingerprint, EmbeddingRuntime};
use crate::rag::indexing::RetrievalIndexRuntime;
use crate::storage::{
    ListRetrievalChunks, ListRetrievalIndexJobs, ListRetrievalSources, QueueRetrievalIndex,
    RetrievalIndexJobAction, Storage, StorageError, SyncRetrievalSources,
};
use serde_json::json;

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

#[tauri::command]
pub async fn local_list_retrieval_chunks(
    storage: tauri::State<'_, Storage>,
    input: ListRetrievalChunks,
) -> Result<Reply, ()> {
    Ok(storage
        .run(move |db| db.list_retrieval_chunks(input))
        .await
        .into())
}

#[tauri::command]
pub async fn local_embedding_status(
    embedding: tauri::State<'_, EmbeddingRuntime>,
) -> Result<Reply, ()> {
    Ok(Reply::Success {
        ok: true,
        value: json!(embedding.status()),
    })
}

#[tauri::command]
pub async fn local_queue_retrieval_index(
    storage: tauri::State<'_, Storage>,
    embedding: tauri::State<'_, EmbeddingRuntime>,
    runtime: tauri::State<'_, RetrievalIndexRuntime>,
    input: QueueRetrievalIndex,
) -> Result<Reply, ()> {
    let fingerprint = match embedding.status() {
        status if status.available => current_fingerprint(),
        status => {
            return Ok(Reply::Failure {
                ok: false,
                error: StorageError::new(
                    status
                        .error_code
                        .as_deref()
                        .unwrap_or("MODEL_NOT_CONFIGURED"),
                    status
                        .error_message
                        .as_deref()
                        .unwrap_or("Local embedding is not available"),
                ),
            })
        }
    };
    let book_id = input.book_id.clone();
    let result = storage
        .run(move |db| db.queue_retrieval_index(input, &fingerprint))
        .await;
    if result.is_ok() {
        runtime.start(storage.inner().clone(), embedding.inner().clone(), book_id);
    }
    Ok(result.into())
}

#[tauri::command]
pub async fn local_list_retrieval_index_jobs(
    storage: tauri::State<'_, Storage>,
    input: ListRetrievalIndexJobs,
) -> Result<Reply, ()> {
    Ok(storage
        .run(move |db| db.list_retrieval_index_jobs(input))
        .await
        .into())
}

#[tauri::command]
pub async fn local_pause_retrieval_index_job(
    storage: tauri::State<'_, Storage>,
    input: RetrievalIndexJobAction,
) -> Result<Reply, ()> {
    Ok(storage
        .run(move |db| db.pause_retrieval_index_job(input))
        .await
        .into())
}

#[tauri::command]
pub async fn local_cancel_retrieval_index_job(
    storage: tauri::State<'_, Storage>,
    input: RetrievalIndexJobAction,
) -> Result<Reply, ()> {
    Ok(storage
        .run(move |db| db.cancel_retrieval_index_job(input))
        .await
        .into())
}

#[tauri::command]
pub async fn local_retry_retrieval_index_job(
    storage: tauri::State<'_, Storage>,
    embedding: tauri::State<'_, EmbeddingRuntime>,
    runtime: tauri::State<'_, RetrievalIndexRuntime>,
    input: RetrievalIndexJobAction,
) -> Result<Reply, ()> {
    let status = embedding.status();
    if !status.available {
        return Ok(Reply::Failure {
            ok: false,
            error: StorageError::new(
                status
                    .error_code
                    .as_deref()
                    .unwrap_or("MODEL_NOT_CONFIGURED"),
                status
                    .error_message
                    .as_deref()
                    .unwrap_or("Local embedding is not available"),
            ),
        });
    }
    let result = storage
        .run(move |db| db.retry_retrieval_index_job(input))
        .await;
    if let Ok(value) = &result {
        if let Some(book_id) = value.get("bookId").and_then(|value| value.as_str()) {
            runtime.start(
                storage.inner().clone(),
                embedding.inner().clone(),
                book_id.to_owned(),
            );
        }
    }
    Ok(result.into())
}

#[tauri::command]
pub async fn local_search_retrieval(
    storage: tauri::State<'_, Storage>,
    embedding: tauri::State<'_, EmbeddingRuntime>,
    input: RetrievalSearchRequest,
) -> Result<Reply, ()> {
    let requested_mode = input.mode.clone();
    let (query_vector, degradation_reason) =
        if matches!(requested_mode, RetrievalSearchMode::Lexical) {
            (None, None)
        } else if !embedding.status().available {
            (
                None,
                Some(
                    "Local embedding is not configured or its resources are incomplete".to_owned(),
                ),
            )
        } else {
            let embedding = embedding.inner().clone();
            let query = input.query.clone();
            match tauri::async_runtime::spawn_blocking(move || {
                embedding.with_provider(|provider| provider.embed_query(&query))
            })
            .await
            {
                Ok(Ok(vector)) => (Some(vector), None),
                Ok(Err(error)) => (None, Some(error)),
                Err(_) => (
                    None,
                    Some("Embedding query worker stopped unexpectedly".to_owned()),
                ),
            }
        };
    Ok(storage
        .run(move |db| db.search_retrieval(input, query_vector, degradation_reason))
        .await
        .into())
}
