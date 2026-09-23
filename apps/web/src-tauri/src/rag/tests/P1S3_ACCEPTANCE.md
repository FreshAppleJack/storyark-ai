# P1-S3 Semantic Search Acceptance

This record covers the search acceptance boundary for the local-first retrieval
path. Measurements are observations from the listed runs, not universal model
guarantees or acceptance thresholds.

## Fixed Chinese sample

The shared fixture is `p1_e_samples.json`. It includes:

- synonym wording for the same event: `雨夜门扉`
- a character alias: `小岚`
- a cross-chapter event: `旧钥匙打开档案室`
- an explicit no-answer query: `海边灯塔的蓝色汽笛`
- duplicate people sharing an alias
- a future plan that is not a written fact
- an expired chapter summary

The desktop probe used the manuscript part of this sample in an isolated book:

- `雨夜门扉` must locate the current manuscript chapter
- `海边灯塔的蓝色汽笛` must return no evidence cards when the semantic index is ready
- `雨夜档案室` must remain available through Title / Chapter search

## Automated evidence

The storage acceptance test is
`storage::tests::retrieval_p1s3::p1s3_records_semantic_score_separation_for_a_no_answer_case`.
It verifies the current source version, chapter locator, quote locator, positive
semantic result, and the no-answer status after the local index is ready. The
test emits a `P1S3_SCORE` JSON line with index latency, query latency, Recall@1,
locator correctness, and no-answer false recall.

Latest model-configured run of that test:

| Metric | Observation |
| --- | ---: |
| Index latency, including local model loading | `2195.0 ms` |
| Positive semantic query | `13.3604 ms` |
| No-answer semantic query | `3.5612 ms` |
| Positive semantic score before filtering | `0.8692613` |
| Accepted no-answer scores | `0` |

The existing P1-E tests provide the remaining boundary coverage:

- cross-book leakage for duplicate names, aliases, and text: `0` observed
- source-version, chunk, and locator contract: covered
- stale and future-plan visibility: covered
- wrong dimensions, embedding failure, cancellation, late jobs, partial write
  rollback, and restart recovery: covered

## Real desktop acceptance

Run date: 2026-09-21. Platform: Windows. The acceptance used the actual Tauri
WebView target attached through CDP, not a browser substitute or mock result.
SQLite was isolated with a temporary `STORYARK_DATA_DIR`, and the local model
was `fastembed-rs` with `intfloat/multilingual-e5-small`.

The probe passed all of these checks:

1. Local index rebuild completed for the isolated sample.
2. The synonym-style semantic query returned an evidence card.
3. `Open and locate` returned to the expected chapter and preserved its text.
4. Title / Chapter lexical search remained available.
5. The no-answer semantic query returned no evidence cards.
6. The desktop page remained on the local Tauri route throughout the flow.

Observed CDP timings from the passing run:

| Metric | Observation |
| --- | ---: |
| Local index rebuild | `1381 ms` |
| Semantic query | `369 ms` |
| Lexical query | `368 ms` |
| No-answer query | `354 ms` |
| Recall@1 for the fixed positive case | `1.0` |
| Citation locator correctness for the fixed positive case | `1.0` |
| No-answer false recall | `0.0` |
| Cross-book leakage | `0` in the P1-E isolation test |

The index timing is for one small source and a model that was already available
to the desktop runtime. It must not be extrapolated to a full manuscript.

## Resource observation

The user observed approximately `10%` CPU usage on an i5-12600KF during
retrieval and approximately `450–550 MB` process memory in Windows Task
Manager. This is a manual observation from the current machine, not an
automated benchmark and not a promise for other books, model versions, or
hardware.

## Interpretation and boundary

The initial semantic acceptance boundary is
`MIN_SEMANTIC_SCORE = 0.85`. The value separates the fixed sample's positive
score from its no-answer false positive and is a ranking filter, not a
probability. It must be recalibrated against a broader labelled set before any
claim about general semantic quality is made.

When the local embedding or index is unavailable, the product keeps lexical
search available and reports the degraded state. When the index is ready but
the semantic query has no accepted hit, the response is `no_results`; it does
not silently show an unrelated later fact. Future-plan filtering remains a
request policy and is not changed by this acceptance work.

Remote embedding compatibility and cross-platform desktop acceptance are not
claimed by this record.

## P1-R4 broader-scope note — 2026-09-23

The no-answer observation above is specific to its isolated manuscript-only
fixture. A broader R4 scope containing a planning background produced an
additional semantic-only planning hit for the query `海边灯塔的蓝色汽笛`
(`semanticScore` observed near `0.858`). The hit did not contain the later
chapter text or a future-plan record, but it was unrelated to the query. Do not
generalize the earlier zero false-recall result to mixed source scopes; the
R4 report records this as a relevance false positive rather than a temporal
information leak.
