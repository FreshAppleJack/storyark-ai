fn main() {
    let attributes = tauri_build::Attributes::new();
    let msvc = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    let attributes = if msvc {
        // Embed at link time so Cargo's test executables receive Common Controls v6 too.
        println!("cargo:rerun-if-changed=windows-app-manifest.xml");
        let manifest = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("windows-app-manifest.xml");
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
        attributes.windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest())
    } else {
        attributes
    };
    tauri_build::try_build(
        attributes.app_manifest(tauri_build::AppManifest::new().commands(&[
            "local_list_books",
            "local_read_book",
            "local_create_book",
            "local_create_volume",
            "local_create_chapter",
            "local_save_chapter",
            "local_rename",
            "local_set_read_only",
            "local_reorder",
            "local_delete",
            "local_list_characters",
            "local_create_character",
            "local_update_character",
            "local_archive_character",
            "local_backup",
            "local_update_note",
            "local_read_planning",
            "local_save_planning",
            "local_read_graph",
            "local_initialize_graph",
            "local_save_graph",
        ])),
    )
    .expect("Failed to build the application permission manifest")
}
