#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    with_storage_commands(tauri::Builder::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            app.manage(ai::tasks::AiRuntime::default());
            // STORYARK_DATA_DIR redirects the database directory for controlled
            // smoke tests; production runs always use the platform app-data dir.
            let directory = match std::env::var_os("STORYARK_DATA_DIR") {
                Some(custom) if !custom.is_empty() => std::path::PathBuf::from(custom),
                _ => app.path().app_data_dir()?,
            };
            // Initialize on a worker before showing a usable application.
            let storage = std::thread::spawn(move || storage::Storage::open(&directory))
                .join()
                .map_err(|_| std::io::Error::other("Storage initialization worker failed"))??;
            app.manage(storage);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running StoryArk");
}

fn with_storage_commands<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.invoke_handler(tauri::generate_handler![
        ai_commands::ai_list_configs,
        ai_commands::ai_save_config,
        ai_commands::ai_set_default,
        ai_commands::ai_delete_config,
        ai_commands::ai_test_connection,
        ai_commands::ai_prepare_context,
        ai_commands::ai_start_generation,
        ai_commands::ai_cancel_generation,
        commands::local_list_books,
        commands::local_read_book,
        commands::local_read_work_export_snapshot,
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
    ])
}
mod brainstorm_commands;
mod commands;
mod graph_commands;
mod planning_commands;
mod preferences_commands;
mod storage;
use tauri::Manager;

pub mod ai;

mod ai_commands;
