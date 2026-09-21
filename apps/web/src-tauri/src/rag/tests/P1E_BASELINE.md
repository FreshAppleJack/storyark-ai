# P1-E Retrieval Baseline

This file records the repeatable P1-E verification boundary. Values below are
observations from one Windows run on 2026-09-21, not acceptance thresholds.

## Local semantic path

- Provider: `fastembed-rs`
- Model: `intfloat/multilingual-e5-small`
- Dimension: `384`
- Sample chunks: `2`
- Stored embedding bytes: `3072`
- Model resource bytes: `487850043`
- Index latency: `2560.3571 ms`
- Sample Recall@1: `1.0`
- Citation consistency: `1.0`
- Stale hit rate on the fresh sample: `0.0`
- Platform: `windows`

The model resource size is the size of the files in the configured local model
directory. It is not a resident-memory measurement. The latency includes local
model loading/embedding and SQLite index commits for the sample work.

## Fixed sample coverage

`p1_e_samples.json` contains deterministic Chinese cases for synonym wording,
aliases, a cross-chapter event, no answer, duplicate people, future planning,
and an expired chapter summary. The persistence tests additionally verify the
same-book boundary, source locators, stale/future status, and source-version
invalidation.

## Failure and degradation coverage

The P1-E storage tests cover wrong vector dimensions, synthetic embedding
failure, cancellation, late source-version results, partial write rollback,
restart recovery, and strict cross-book filtering. Lexical FTS remains usable
when the local model is unavailable; the response reports lexical degradation
or an unavailable/not-ready status instead of claiming semantic freshness.

Remote embedding is not part of this baseline or the local-first P1
implementation. No network call is needed for the semantic test when the local
model directory is configured.

## Verification commands

```text
cargo test --lib
cargo test --lib storage::tests::retrieval_p1e::local_semantic_path_records_p1e_baseline_when_model_is_configured -- --nocapture --test-threads=1
```

The Tauri retrieval IPC is registered and has one retrieval contract. There is
not yet a dedicated frontend retrieval-result panel in this work unit, so UI
click-through locator verification remains part of the P1 consumer work rather
than being claimed by this backend completion record.
