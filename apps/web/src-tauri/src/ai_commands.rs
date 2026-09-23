use crate::{
    ai::{
        config::{DeleteConfig, SetDefault, TestConnection},
        context,
        generation::{
            CancelRequest, ContextInput, GenerateRequest, GenerationEvent, GenerationPayload,
            GenerationTarget, ValidateAiAdoption,
        },
        settings::SaveSettings,
        tasks::{accepted, AiRuntime, EventSink},
    },
    commands::Reply,
    storage::{Storage, StorageError},
};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use tauri::{Emitter, EventTarget};

fn adoption_request(
    book_id: String,
    target: &GenerationTarget,
    retrieval: Option<&crate::rag::contracts::RetrievalContext>,
) -> Option<ValidateAiAdoption> {
    match target {
        GenerationTarget::Continue {
            chapter_id,
            database_version,
        } => Some(ValidateAiAdoption {
            book_id,
            chapter_id: chapter_id.clone(),
            database_version: *database_version,
            planning_database_version: None,
            retrieval_source_versions: retrieval
                .map(|context| context.source_versions.clone())
                .unwrap_or_default(),
        }),
        GenerationTarget::ChapterSummary {
            chapter_id,
            database_version,
            planning_database_version,
        } => Some(ValidateAiAdoption {
            book_id,
            chapter_id: chapter_id.clone(),
            database_version: *database_version,
            planning_database_version: Some(*planning_database_version),
            retrieval_source_versions: retrieval
                .map(|context| context.source_versions.clone())
                .unwrap_or_default(),
        }),
        GenerationTarget::Brainstorm { .. } => None,
    }
}

#[tauri::command]
pub async fn ai_list_configs(storage: tauri::State<'_, Storage>) -> Result<Reply, ()> {
    Ok(storage.run(|db| db.ai_list()).await.into())
}
#[tauri::command]
pub async fn ai_save_config(
    storage: tauri::State<'_, Storage>,
    input: SaveSettings,
) -> Result<Reply, ()> {
    Ok(storage.run(move |db| db.ai_save(input)).await.into())
}
#[tauri::command]
pub async fn ai_set_default(
    storage: tauri::State<'_, Storage>,
    input: SetDefault,
) -> Result<Reply, ()> {
    Ok(storage.run(move |db| db.ai_default(input)).await.into())
}
#[tauri::command]
pub async fn ai_delete_config(
    storage: tauri::State<'_, Storage>,
    input: DeleteConfig,
) -> Result<Reply, ()> {
    Ok(storage.run(move |db| db.ai_delete(input)).await.into())
}
#[tauri::command]
pub async fn ai_test_connection(
    storage: tauri::State<'_, Storage>,
    input: TestConnection,
) -> Result<Reply, ()> {
    let result = async {
        if uuid::Uuid::parse_str(&input.request_id).is_err() {
            return Err(StorageError::new("VALIDATION_ERROR", "Invalid request ID"));
        }
        let version = input.config.clone();
        let snapshot = storage.run_typed(move |db| db.ai_snapshot(version)).await?;
        crate::ai::connection::test(snapshot).await?;
        // Never publish success for an edited/deleted configuration.
        let mut result = storage
            .run(move |db| db.ai_check_version(input.config))
            .await?;
        result["requestId"] = serde_json::json!(input.request_id);
        Ok(result)
    }
    .await;
    Ok(Reply::from(result))
}

#[tauri::command]
pub async fn ai_prepare_context(
    storage: tauri::State<'_, Storage>,
    runtime: tauri::State<'_, AiRuntime>,
    input: ContextInput,
) -> Result<Reply, ()> {
    let book_id = input.book_id.clone();
    let target = input.target.clone();
    let adoption = adoption_request(book_id.clone(), &target, input.retrieval_context.as_ref());
    let result = storage
        .run_typed(move |db| {
            db.validate_ai_generation_target(&book_id, &target)?;
            if let Some(adoption) = adoption {
                db.validate_ai_adoption(adoption)?;
            }
            Ok(())
        })
        .await
        .and_then(|_| {
            context::prepare(&runtime, input)
                .map(|snapshot| serde_json::to_value(snapshot).unwrap())
        });
    Ok(Reply::from(result))
}

#[tauri::command]
pub async fn ai_start_generation<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    storage: tauri::State<'_, Storage>,
    runtime: tauri::State<'_, AiRuntime>,
    input: GenerateRequest,
) -> Result<Reply, ()> {
    let request_id = input.request_id.clone();
    let target_book_id = input.book_id.clone();
    let target = input.target.clone();
    if let Err(error) = storage
        .run_typed(move |db| db.validate_ai_generation_target(&target_book_id, &target))
        .await
    {
        return Ok(Reply::from(Err(error)));
    }
    let context_snapshot = match runtime.take_context(&input.context_snapshot_id, &input) {
        Ok(snapshot) => snapshot,
        Err(error) => return Ok(Reply::from(Err(error))),
    };
    if let Some(adoption) = adoption_request(
        input.book_id.clone(),
        &input.target,
        context_snapshot.retrieval_context.as_ref(),
    ) {
        if let Err(error) = storage
            .run(move |db| db.validate_ai_adoption(adoption))
            .await
        {
            return Ok(Reply::from(Err(error)));
        }
    }
    let config_version = input.config.clone();
    let snapshot = match storage
        .run_typed(move |db| db.ai_snapshot(config_version))
        .await
    {
        Ok(snapshot) => snapshot,
        Err(error) => return Ok(Reply::from(Err(error))),
    };
    if let Err(error) = storage
        .run_typed({
            let request = input.clone();
            let model_id = snapshot.config.model_id.clone();
            move |db| db.record_ai_generation_start(&request, &model_id)
        })
        .await
    {
        return Ok(Reply::from(Err(error)));
    }
    let cancellation = match runtime.register(&request_id, &input.session_id) {
        Ok(cancellation) => cancellation,
        Err(error) => return Ok(Reply::from(Err(error))),
    };
    let sequence = Arc::new(AtomicU64::new(0));
    let sink_window = window.clone();
    let sink_request_id = input.request_id.clone();
    let sink_session_id = input.session_id.clone();
    let sink_sequence = sequence.clone();
    let sink: EventSink = Arc::new(move |payload: GenerationPayload| {
        let event = GenerationEvent {
            request_id: sink_request_id.clone(),
            session_id: sink_session_id.clone(),
            sequence: sink_sequence.fetch_add(1, Ordering::Relaxed),
            payload,
        };
        let target = EventTarget::webview_window(sink_window.label());
        let _ = sink_window.emit_to(target, "storyark-ai-generation", event);
    });
    sink(GenerationPayload::Started);
    let stream_input = crate::ai::stream::StreamInput {
        config: snapshot.config,
        key: snapshot.key,
        context: crate::ai::tasks::format_generation_prompt(
            &context_snapshot,
            &input.target,
            input.output_chars,
        ),
        control: cancellation,
    };
    if let Err(error) = runtime.start(input, stream_input, sink) {
        runtime.finish(&request_id);
        return Ok(Reply::from(Err(error)));
    }
    Ok(Reply::from(Ok(accepted(&request_id))))
}

#[tauri::command]
pub async fn ai_cancel_generation(
    runtime: tauri::State<'_, AiRuntime>,
    input: CancelRequest,
) -> Result<Reply, ()> {
    let outcome = runtime
        .cancel(&input.request_id, &input.session_id)
        .map(|outcome| serde_json::json!({"requestId":input.request_id,"outcome":outcome}));
    Ok(Reply::from(outcome))
}

#[tauri::command]
pub async fn ai_validate_adoption(
    storage: tauri::State<'_, Storage>,
    input: ValidateAiAdoption,
) -> Result<Reply, ()> {
    Ok(storage
        .run(move |db| db.validate_ai_adoption(input))
        .await
        .into())
}
