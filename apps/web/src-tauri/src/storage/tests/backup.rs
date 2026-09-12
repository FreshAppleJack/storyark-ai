use super::*;

#[test]
fn backup_restores_committed_wal_content_to_a_separate_directory() {
    let temp = TempDirectory::new();
    let restore = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let input = fixture(&mut db);
    db.save_chapter(input.clone()).unwrap();
    let backup = db.backup().unwrap();
    std::fs::create_dir_all(&restore.0).unwrap();
    std::fs::copy(
        temp.0
            .join("backups")
            .join(backup["fileName"].as_str().unwrap()),
        restore.0.join("storyark.sqlite3"),
    )
    .unwrap();
    let mut restored = Database::open(&restore.0).unwrap();
    assert_eq!(
        restored.read_book(&input.book_id).unwrap(),
        db.read_book(&input.book_id).unwrap()
    );
}
