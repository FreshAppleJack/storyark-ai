use super::*;

#[test]
fn serialized_worker_keeps_the_async_caller_free_and_returns_committed_data() {
    let temp = TempDirectory::new();
    let storage = Storage::open(&temp.0).unwrap();
    tauri::async_runtime::block_on(async {
        let worker = storage.clone();
        let first = tauri::async_runtime::spawn(async move {
            worker
                .run(|db| {
                    db.create_book(CreateBook {
                        title: "First".into(),
                        author: "".into(),
                    })
                })
                .await
        });
        let second = storage
            .run(|db| {
                db.create_book(CreateBook {
                    title: "Second".into(),
                    author: "".into(),
                })
            })
            .await
            .unwrap();
        first.await.unwrap().unwrap();
        assert!(second["id"].is_string());
        assert_eq!(
            storage
                .run(|db| db.list_books())
                .await
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            2
        );
    });
}
