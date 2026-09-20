use super::embeddings::EmbeddingRuntime;
use crate::storage::{IndexWork, Storage};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
pub struct RetrievalIndexRuntime(Arc<Mutex<HashSet<String>>>);

impl RetrievalIndexRuntime {
    pub fn start(&self, storage: Storage, embedding: EmbeddingRuntime, book_id: String) {
        let should_start = self
            .0
            .lock()
            .map(|mut books| books.insert(book_id.clone()))
            .unwrap_or(false);
        if !should_start {
            return;
        }
        let runtime = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let next = storage
                    .run_typed({
                        let book_id = book_id.clone();
                        move |db| db.claim_next_retrieval_index_job(&book_id)
                    })
                    .await;
                let work = match next {
                    Ok(Some(work)) => work,
                    Ok(None) | Err(_) => break,
                };
                run_one(&storage, &embedding, work).await;
            }
            if let Ok(mut books) = runtime.0.lock() {
                books.remove(&book_id);
            }
        });
    }
}

async fn run_one(storage: &Storage, embedding: &EmbeddingRuntime, work: IndexWork) {
    let job_id = work.job_id.clone();
    let texts = work
        .chunks
        .iter()
        .map(|chunk| chunk.index_text.clone())
        .collect::<Vec<_>>();
    let embedding_result = tauri::async_runtime::spawn_blocking({
        let embedding = embedding.clone();
        move || embedding.with_provider(|provider| provider.embed_documents(&texts))
    })
    .await;
    let embedding_result = match embedding_result {
        Ok(result) => result,
        Err(_) => Err("Embedding worker stopped unexpectedly".to_owned()),
    };
    match embedding_result {
        Ok(vectors) => {
            let commit = storage
                .run_typed(move |db| db.commit_retrieval_index_job(&work, &vectors).map(|_| ()))
                .await;
            if commit.is_err() {
                let _ = storage
                    .run_typed(move |db| {
                        db.fail_retrieval_index_job(&job_id, "Index commit failed")
                    })
                    .await;
            }
        }
        Err(error) => {
            let _ = storage
                .run_typed(move |db| db.fail_retrieval_index_job(&job_id, &error))
                .await;
        }
    }
}
