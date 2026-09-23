use crate::rag::embeddings::{
    current_fingerprint, decode_vector, encode_vector, EmbeddingRuntime,
    BUNDLED_MODEL_RESOURCE_PATH, DIMENSION,
};
use serde_json::Value;
use std::path::PathBuf;

#[test]
fn fingerprint_contains_the_full_local_embedding_contract() {
    let fingerprint: Value = serde_json::from_str(&current_fingerprint()).unwrap();
    assert_eq!(fingerprint["providerId"], "fastembed-rs");
    assert_eq!(fingerprint["modelId"], "intfloat/multilingual-e5-small");
    assert_eq!(fingerprint["dimension"], DIMENSION);
    assert_eq!(fingerprint["pooling"], "mean");
    assert_eq!(fingerprint["normalization"], "l2");
    assert_eq!(fingerprint["queryPrefix"], "query: ");
    assert_eq!(fingerprint["documentPrefix"], "passage: ");
    assert_eq!(fingerprint["maxInputLength"], 512);
}

#[test]
fn vector_storage_round_trip_preserves_dimension_and_values() {
    let original = (0..DIMENSION)
        .map(|value| value as f32 / 100.0)
        .collect::<Vec<_>>();
    let encoded = encode_vector(&original).unwrap();
    assert_eq!(decode_vector(&encoded).unwrap(), original);
}

#[test]
fn bundled_local_model_emits_normalized_bilingual_vectors() {
    let model_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(BUNDLED_MODEL_RESOURCE_PATH);
    assert!(model_dir.is_dir(), "bundled model resource is missing");
    let runtime = EmbeddingRuntime::with_model_dir(Some(model_dir));
    let status = runtime.status();
    assert!(status.available, "local model status failed: {status:?}");
    let result = runtime.with_provider(|provider| {
        let documents = provider.embed_documents(&[
            "中文故事中的人物关系与冲突".to_owned(),
            "A short English scene about a hidden door".to_owned(),
        ])?;
        assert_eq!(documents.len(), 2);
        assert!(documents.iter().all(|vector| vector.len() == DIMENSION));
        assert!(documents.iter().all(|vector| {
            (vector.iter().map(|value| value * value).sum::<f32>().sqrt() - 1.0).abs() < 0.01
        }));
        let query = provider.embed_query("隐藏的门").unwrap();
        assert_eq!(query.len(), DIMENSION);
        Ok(())
    });
    assert!(result.is_ok(), "local model validation failed: {result:?}");
}
