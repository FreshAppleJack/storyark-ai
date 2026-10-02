#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    diagnostics::install_panic_hook();
    with_storage_commands(tauri::Builder::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // The test override isolates logs as well as authored data.
            let directory = match std::env::var_os("STORYARK_DATA_DIR") {
                Some(custom) if !custom.is_empty() => std::path::PathBuf::from(custom),
                _ => app.path().app_data_dir()?,
            };
            diagnostics::initialize(directory.join("logs"));
            app.manage(ai::tasks::AiRuntime::default());
            let bundled_model_dir = if cfg!(mobile) || !cfg!(debug_assertions) {
                app.path()
                    .resolve(
                        rag::embeddings::BUNDLED_MODEL_RESOURCE_PATH,
                        tauri::path::BaseDirectory::Resource,
                    )
                    .ok()
            } else {
                Some(rag::embeddings::development_model_dir())
            };
            app.manage(rag::embeddings::EmbeddingRuntime::with_model_dir(
                bundled_model_dir,
            ));
            app.manage(rag::indexing::RetrievalIndexRuntime::default());
            // Initialize on a worker before showing a usable application.
            let storage = std::thread::spawn(move || storage::Storage::open(&directory))
                .join()
                .map_err(|_| std::io::Error::other("Storage initialization worker failed"))??;
            app.state::<rag::indexing::RetrievalIndexRuntime>()
                .coordinate(
                    storage.clone(),
                    app.state::<rag::embeddings::EmbeddingRuntime>()
                        .inner()
                        .clone(),
                );
            app.manage(storage);
            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| {
            diagnostics::startup_failure(&error.to_string());
            panic!("error while running StoryArk: {error}");
        });
}

fn with_storage_commands<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.invoke_handler(tauri::generate_handler![
        diagnostics::diagnostic_report_error,
        diagnostics::diagnostic_log_info,
        ai_commands::ai_list_configs,
        ai_commands::ai_save_config,
        ai_commands::ai_set_default,
        ai_commands::ai_delete_config,
        ai_commands::ai_test_connection,
        ai_commands::ai_prepare_context,
        ai_commands::ai_start_generation,
        ai_commands::ai_cancel_generation,
        ai_commands::ai_validate_adoption,
        commands::local_list_books,
        commands::local_read_book,
        commands::local_read_work_export_snapshot,
        commands::local_prepare_work_import,
        commands::local_import_work,
        commands::local_cancel_work_import,
        export::local_save_work_export,
        commands::local_create_book,
        commands::local_create_volume,
        commands::local_create_chapter,
        commands::local_save_chapter,
        commands::local_rename,
        commands::local_update_book,
        commands::local_set_read_only,
        commands::local_reorder,
        commands::local_delete,
        commands::local_list_characters,
        commands::local_reorder_characters,
        commands::local_create_character,
        commands::local_update_character,
        commands::local_archive_character,
        commands::local_backup,
        planning_commands::local_update_note,
        planning_commands::local_read_planning,
        planning_commands::local_save_planning,
        graph_commands::local_read_graph,
        graph_commands::local_initialize_graph,
        graph_commands::local_save_graph,
        preferences_commands::local_read_preferences,
        preferences_commands::local_save_preferences,
        brainstorm_commands::local_read_brainstorm,
        brainstorm_commands::local_save_brainstorm,
        retrieval_commands::local_sync_retrieval_sources,
        retrieval_commands::local_list_retrieval_sources,
        retrieval_commands::local_list_retrieval_chunks,
        retrieval_commands::local_embedding_status,
        retrieval_commands::local_index_schedule_status,
        retrieval_commands::local_save_index_preferences,
        retrieval_commands::local_queue_retrieval_index,
        retrieval_commands::local_list_retrieval_index_jobs,
        retrieval_commands::local_pause_retrieval_index_job,
        retrieval_commands::local_cancel_retrieval_index_job,
        retrieval_commands::local_retry_retrieval_index_job,
        retrieval_commands::local_search_retrieval,
    ])
}
mod brainstorm_commands;
mod commands;
mod diagnostics;
mod export;
mod graph_commands;
mod planning_commands;
mod preferences_commands;
pub mod rag;
mod retrieval_commands;
mod storage;
use tauri::Manager;

pub mod ai;

mod ai_commands;
