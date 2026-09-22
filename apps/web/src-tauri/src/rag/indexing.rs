use super::embeddings::EmbeddingRuntime;
use crate::storage::{IndexWork, Storage};
use std::collections::BTreeSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Default)]
struct Queue {
    books: BTreeSet<String>,
    active_book: Option<String>,
    running: bool,
}

#[derive(Clone, Default)]
pub struct RetrievalIndexRuntime(Arc<Mutex<Queue>>);

impl RetrievalIndexRuntime {
    pub fn focus(&self, book: Option<String>) {
        if let Ok(mut queue) = self.0.lock() {
            queue.active_book = book;
        }
    }

    pub fn coordinate(&self, storage: Storage, embedding: EmbeddingRuntime) {
        let runtime = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(2)).await;
                if !storage
                    .run_typed(|db| db.automatic_work_available())
                    .await
                    .unwrap_or(false)
                {
                    continue;
                }
                let model = embedding.clone();
                let available =
                    tauri::async_runtime::spawn_blocking(move || model.status().available)
                        .await
                        .unwrap_or(false);
                if !available {
                    continue;
                }
                let time = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as i64;
                if let Ok(books) = storage
                    .run_typed(move |db| db.queue_due_sources(time))
                    .await
                {
                    for book in books {
                        runtime.start(storage.clone(), embedding.clone(), book);
                    }
                }
            }
        });
    }

    pub fn start(&self, storage: Storage, embedding: EmbeddingRuntime, book_id: String) {
        {
            let Ok(mut queue) = self.0.lock() else {
                return;
            };
            queue.books.insert(book_id);
            if queue.running {
                return;
            }
            queue.running = true;
        }
        let runtime = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let book = {
                    let Ok(mut queue) = runtime.0.lock() else {
                        return;
                    };
                    let book = queue
                        .active_book
                        .as_ref()
                        .filter(|id| queue.books.contains(*id))
                        .cloned()
                        .or_else(|| queue.books.first().cloned());
                    match book {
                        Some(book) => {
                            queue.books.remove(&book);
                            book
                        }
                        None => {
                            queue.running = false;
                            return;
                        }
                    }
                };
                let next = storage
                    .run_typed({
                        let book = book.clone();
                        move |db| db.claim_next_retrieval_index_job(&book)
                    })
                    .await;
                if let Ok(Some(work)) = next {
                    run_one(&storage, &embedding, work).await;
                    if let Ok(mut queue) = runtime.0.lock() {
                        queue.books.insert(book);
                    }
                }
            }
        });
    }
}

async fn run_one(storage: &Storage, embedding: &EmbeddingRuntime, work: IndexWork) {
    let mut vectors = Vec::new();
    for batch in work.chunks.chunks(8) {
        let snapshot = work.clone();
        if !storage
            .run_typed(move |db| db.index_work_current(&snapshot))
            .await
            .unwrap_or(false)
        {
            let id = work.job_id.clone();
            let _ = storage
                .run_typed(move |db| {
                    db.fail_retrieval_index_job(&id, "Index source changed or task stopped")
                })
                .await;
            return;
        }
        // Yield between batches to let interactive queries acquire the model.
        while embedding.queries_waiting() {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        let texts = batch
            .iter()
            .map(|chunk| chunk.index_text.clone())
            .collect::<Vec<_>>();
        let model = embedding.clone();
        match tauri::async_runtime::spawn_blocking(move || {
            model.with_provider(|provider| provider.embed_documents(&texts))
        })
        .await
        {
            Ok(Ok(batch)) => vectors.extend(batch),
            _ => {
                let id = work.job_id.clone();
                let _ = storage
                    .run_typed(move |db| {
                        db.fail_retrieval_index_job(
                            &id,
                            "Local embedding batch failed; retry manually",
                        )
                    })
                    .await;
                return;
            }
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    let id = work.job_id.clone();
    if storage
        .run_typed(move |db| db.commit_retrieval_index_job(&work, &vectors).map(|_| ()))
        .await
        .is_err()
    {
        let _ = storage
            .run_typed(move |db| db.fail_retrieval_index_job(&id, "Index commit failed"))
            .await;
    }
}
