use super::*;
use crate::ai::generation::{
    GenerateRequest, GenerationRetrievalTrace, GenerationTarget, SourceVersion,
};

#[test]
fn generation_audit_records_versions_and_model_without_prompt_or_credentials() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let chapter = fixture(&mut db);
    let request_id = Uuid::new_v4().to_string();
    let config_id = Uuid::new_v4().to_string();
    let request = GenerateRequest {
        request_id: request_id.clone(),
        book_id: chapter.book_id.clone(),
        session_id: "audit-session".into(),
        draft_revision: 4,
        config: crate::ai::config::ConfigVersion {
            id: config_id.clone(),
            expected_config_version: 1,
        },
        target: GenerationTarget::Continue {
            chapter_id: chapter.chapter_id.clone(),
            database_version: 1,
        },
        context_snapshot_id: Uuid::new_v4().to_string(),
        output_chars: 300,
        retrieval_trace: Some(GenerationRetrievalTrace {
            retrieval_version: "p1-d-v1".into(),
            source_versions: vec![SourceVersion {
                chapter_id: chapter.chapter_id.clone(),
                database_version: 1,
            }],
        }),
    };
    db.record_ai_generation_start(&request, "local-test-model")
        .unwrap();

    let row: (String, Option<String>, String, String) = db
        .connection
        .query_row(
            "SELECT prompt_version,retrieval_version,config_id,model_id FROM ai_generation_events WHERE request_id=?",
            [&request_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();
    assert_eq!(row.0, "ai-tasks-v1");
    assert_eq!(row.1.as_deref(), Some("p1-d-v1"));
    assert_eq!(row.2, config_id);
    assert_eq!(row.3, "local-test-model");
    let columns = db
        .connection
        .prepare("PRAGMA table_info(ai_generation_events)")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    assert!(!columns.iter().any(|column| column.contains("prompt_body")));
    assert!(!columns.iter().any(|column| column.contains("api_key")));
}
