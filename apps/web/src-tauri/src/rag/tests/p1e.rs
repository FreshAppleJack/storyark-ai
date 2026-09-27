use crate::rag::chunking::{chunk_id, stable_text_hash, CHUNK_INDEX_VERSION};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SampleSet {
    version: i64,
    documents: Vec<SampleDocument>,
    cases: Vec<SampleCase>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SampleDocument {
    id: String,
    kind: String,
    state: String,
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SampleCase {
    id: String,
    query: String,
    expected_sources: Vec<String>,
}

#[test]
fn chunk_ids_are_stable_and_include_all_identity_inputs() {
    let text_hash = stable_text_hash("同一段中文文本");
    let first = chunk_id("book:manuscript:chapter", 4, 2, &text_hash);
    let second = chunk_id("book:manuscript:chapter", 4, 2, &text_hash);
    assert_eq!(first, second);
    assert!(first.contains(&format!(":v4:i{}:o2:", CHUNK_INDEX_VERSION)));
    assert_ne!(first, chunk_id("book:manuscript:chapter", 5, 2, &text_hash));
    assert_ne!(first, chunk_id("book:manuscript:chapter", 4, 3, &text_hash));
    assert_ne!(
        first,
        chunk_id(
            "book:manuscript:chapter",
            4,
            2,
            &stable_text_hash("另一段中文文本")
        )
    );
    assert!(first.contains(&format!(":i{}:", CHUNK_INDEX_VERSION)));
}

#[test]
fn fixed_chinese_sample_declares_all_p1e_coverage_categories() {
    let sample: SampleSet = serde_json::from_str(include_str!("p1_e_samples.json")).unwrap();
    assert_eq!(sample.version, 1);
    assert!(sample.documents.iter().all(|document| {
        !document.id.is_empty()
            && !document.kind.is_empty()
            && !document.state.is_empty()
            && !document.text.trim().is_empty()
    }));
    assert!(sample
        .documents
        .iter()
        .any(|document| document.kind == "future_plan" && document.state == "future"));
    assert!(sample
        .documents
        .iter()
        .any(|document| document.kind == "chapter_summary" && document.state == "stale"));
    let mut ids = sample
        .cases
        .iter()
        .map(|case| case.id.as_str())
        .collect::<Vec<_>>();
    ids.sort_unstable();
    assert_eq!(
        ids,
        vec![
            "alias",
            "confirmed-setting",
            "cross-chapter-event",
            "duplicate-people",
            "expired-summary",
            "future-plan",
            "no-answer",
            "synonym"
        ]
    );
    assert!(sample
        .cases
        .iter()
        .all(|case| !case.query.trim().is_empty()));
    assert!(sample
        .cases
        .iter()
        .any(|case| case.id == "no-answer" && case.expected_sources.is_empty()));
    let sample_json: Value = serde_json::from_str(include_str!("p1_e_samples.json")).unwrap();
    assert!(sample_json["cases"].is_array());
}
