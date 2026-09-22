use super::*;
use crate::rag::contracts::RetrievalSearchRequest;
use crate::rag::embeddings::{current_fingerprint, DIMENSION};
use crate::storage::retrieval_scheduler::{DEBOUNCE_MS, MAX_WAIT_MS};

fn enable(db: &mut Database, enabled: bool) {
    let version = db.index_schedule_status(None).unwrap()["databaseVersion"]
        .as_i64()
        .unwrap();
    db.save_index_preferences(SaveIndexPreferences {
        enabled,
        expected_database_version: version,
    })
    .unwrap();
}

fn dirty_times(db: &Database) -> (i64, i64) {
    db.connection
        .query_row(
            "SELECT min(first_changed),max(last_changed) FROM retrieval_dirty_sources",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap()
}

#[test]
fn schedule_is_off_by_default_and_debounces_committed_changes() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let chapter = fixture(&mut db);
    db.save_chapter(chapter.clone()).unwrap();
    db.connection
        .execute(
            "UPDATE retrieval_dirty_sources SET first_changed=1000,last_changed=1000",
            [],
        )
        .unwrap();
    let (_, last) = dirty_times(&db);
    assert_eq!(db.index_schedule_status(None).unwrap()["enabled"], false);
    assert!(db.queue_due_sources(last + MAX_WAIT_MS).unwrap().is_empty());
    enable(&mut db, true);
    assert!(db
        .queue_due_sources(last + DEBOUNCE_MS - 1)
        .unwrap()
        .is_empty());
    assert!(db
        .queue_due_sources(last + DEBOUNCE_MS)
        .unwrap()
        .contains(&chapter.book_id));
    let work = db
        .claim_next_retrieval_index_job(&chapter.book_id)
        .unwrap()
        .unwrap();
    assert!(uuid::Uuid::parse_str(&work.job_id).is_ok());
    assert!(db.index_work_current(&work).unwrap());
    enable(&mut db, false);
    assert!(!db.index_work_current(&work).unwrap());
    let vectors = vec![vec![0.0; DIMENSION]; work.chunks.len()];
    assert_eq!(
        db.commit_retrieval_index_job(&work, &vectors).unwrap(),
        super::super::retrieval_index::IndexCommitResult::Stale
    );
    assert!(db
        .claim_next_retrieval_index_job(&chapter.book_id)
        .unwrap()
        .is_none());
}

#[test]
fn failed_save_does_not_schedule_and_maximum_wait_survives_continuous_edits() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let mut chapter = fixture(&mut db);
    db.save_chapter(chapter.clone()).unwrap();
    let before = dirty_times(&db);
    assert!(db.save_chapter(chapter.clone()).is_err());
    assert_eq!(dirty_times(&db), before);
    chapter.expected_database_version = 2;
    chapter.content = chapter.content.replace("Alice", "Alicia");
    db.save_chapter(chapter).unwrap();
    assert_eq!(dirty_times(&db).0, before.0);
    db.connection
        .execute(
            "UPDATE retrieval_dirty_sources SET last_changed=first_changed+?",
            [MAX_WAIT_MS - 1],
        )
        .unwrap();
    enable(&mut db, true);
    assert!(!db
        .queue_due_sources(before.0 + MAX_WAIT_MS)
        .unwrap()
        .is_empty());
}

#[test]
fn schedule_recovers_without_requeuing_failed_or_cancelled_work() {
    let temp = TempDirectory::new();
    let book;
    {
        let mut db = Database::open(&temp.0).unwrap();
        let chapter = fixture(&mut db);
        book = chapter.book_id.clone();
        db.save_chapter(chapter).unwrap();
        enable(&mut db, true);
        let (_, last) = dirty_times(&db);
        db.queue_due_sources(last + DEBOUNCE_MS).unwrap();
        db.claim_next_retrieval_index_job(&book).unwrap().unwrap();
    }
    let mut db = Database::open(&temp.0).unwrap();
    assert!(db.automatic_work_available().unwrap());
    let work = db.claim_next_retrieval_index_job(&book).unwrap().unwrap();
    db.fail_retrieval_index_job(&work.job_id, "Synthetic model failure")
        .unwrap();
    let count: i64 = db
        .connection
        .query_row("SELECT count(*) FROM retrieval_index_jobs", [], |r| {
            r.get(0)
        })
        .unwrap();
    db.queue_due_sources(i64::MAX / 2).unwrap();
    assert_eq!(
        count,
        db.connection
            .query_row("SELECT count(*) FROM retrieval_index_jobs", [], |r| r
                .get::<_, i64>(0))
            .unwrap()
    );
    assert_eq!(
        db.index_schedule_status(Some(&book)).unwrap()["lastError"],
        "Synthetic model failure"
    );
}

#[test]
fn fresh_policy_controls_lexical_fallback_without_building_vectors() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let chapter = fixture(&mut db);
    db.save_chapter(chapter.clone()).unwrap();
    let request = |fallback| {
        serde_json::from_value::<RetrievalSearchRequest>(json!({
            "scope":{"bookId":chapter.book_id},"query":"Alice","task":"continuation",
            "freshnessPolicy":{"freshOnly":true,"allowLexicalFallback":fallback,"maxWaitMs":0}
        }))
        .unwrap()
    };
    let allowed = db.search_retrieval(request(true), None, None).unwrap();
    assert!(!allowed["hits"].as_array().unwrap().is_empty());
    let blocked = db.search_retrieval(request(false), None, None).unwrap();
    assert!(blocked["hits"].as_array().unwrap().is_empty());
    assert_eq!(
        db.connection
            .query_row("SELECT count(*) FROM retrieval_index_jobs", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn only_changed_sources_are_queued_and_books_stay_isolated() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let first = fixture(&mut db);
    let second = fixture(&mut db);
    db.save_chapter(first.clone()).unwrap();
    db.save_chapter(second.clone()).unwrap();
    db.queue_retrieval_index(
        QueueRetrievalIndex {
            book_id: first.book_id.clone(),
        },
        &current_fingerprint(),
    )
    .unwrap();
    while let Some(work) = db.claim_next_retrieval_index_job(&first.book_id).unwrap() {
        let vectors = vec![vec![0.0; DIMENSION]; work.chunks.len()];
        db.commit_retrieval_index_job(&work, &vectors).unwrap();
    }
    enable(&mut db, true);
    let books = db.queue_due_sources(i64::MAX / 2).unwrap();
    assert!(!books.contains(&first.book_id));
    assert!(books.contains(&second.book_id));
}
