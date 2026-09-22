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
    let embedding = embedding.inner().clone();
    let status = tauri::async_runtime::spawn_blocking(move || embedding.status())
        .await
        .map_err(|_| ())?;
    Ok(Reply::Success {
        ok: true,
        value: json!(status),
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
    let wait_ms = input
        .freshness_policy
        .as_ref()
        .map_or(0, |policy| policy.max_wait_ms);
    if wait_ms > 2_000 {
        return Ok(Reply::Failure {
            ok: false,
            error: StorageError::new(
                "INVALID_INPUT",
                "Index wait budget must not exceed 2000 milliseconds",
            ),
        });
    }
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
            match tauri::async_runtime::spawn_blocking(move || embedding.query(&query)).await {
                Ok(Ok(vector)) => (Some(vector), None),
                Ok(Err(error)) => (None, Some(error)),
                Err(_) => (
                    None,
                    Some("Embedding query worker stopped unexpectedly".to_owned()),
                ),
            }
        };
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(wait_ms);
    loop {
        let request = input.clone();
        let vector = query_vector.clone();
        let reason = degradation_reason.clone();
        let result = storage
            .run(move |db| db.search_retrieval(request, vector, reason))
            .await;
        let waiting = result.as_ref().is_ok_and(|value| value["degraded"] == true);
        if !waiting || query_vector.is_none() || std::time::Instant::now() >= deadline {
            return Ok(result.into());
        }
        tokio::time::sleep(
            std::time::Duration::from_millis(100)
                .min(deadline.saturating_duration_since(std::time::Instant::now())),
        )
        .await;
    }
}

#[tauri::command]
pub async fn local_index_schedule_status(
    storage: tauri::State<'_, Storage>,
    runtime: tauri::State<'_, RetrievalIndexRuntime>,
    input: crate::storage::IndexScheduleScope,
) -> Result<Reply, ()> {
    let book = input.book_id.clone();
    let result = storage
        .run(move |db| db.index_schedule_status(input.book_id.as_deref()))
        .await;
    if result.is_ok() {
        runtime.focus(book);
    }
    Ok(result.into())
}

#[tauri::command]
pub async fn local_save_index_preferences(
    storage: tauri::State<'_, Storage>,
    input: crate::storage::SaveIndexPreferences,
) -> Result<Reply, ()> {
    Ok(storage
        .run(move |db| db.save_index_preferences(input))
        .await
        .into())
}
