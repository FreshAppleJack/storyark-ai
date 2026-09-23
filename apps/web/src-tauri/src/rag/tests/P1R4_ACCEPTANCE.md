# P1-R4 Continue and Brainstorm RAG Acceptance

Run: `2026-09-23 11:03:39 UTC`  
Platform: `windows`  
Sample: `p1_e_samples.json` v1, plus the confirmed-setting case added for R4.

## Execution boundary

The fixed-sample retrieval test used the bundled local `fastembed-rs` provider
and `intfloat/multilingual-e5-small` (384 dimensions). No text-generation
service, provider protocol, generation model ID, API key, or network request was
used; those fields are therefore **not observed** in this run. The synthetic
frontend fixtures use an internal GenerationEvent contract and placeholder
configuration/model data only; they are not provider compatibility evidence.

Per user instruction, the real Tauri WebView/CDP and live OpenAI-native,
Anthropic-native, and OpenAI-compatible provider runs were skipped. Their
results remain pending. No claim is made that these routes passed live desktop
or provider acceptance.

## Fixed-sample retrieval result

The automated test is
`storage::tests::retrieval_r4::fixed_sample_continue_and_brainstorm_obey_their_distinct_source_ranges`.
It indexed the short Chinese fixture into an isolated SQLite database, then
queried the Continue and Brainstorm scopes separately using the local bundled
embedding model plus FTS/alias recall.

| Case | Continue expected/observed | Brainstorm expected/observed |
| --- | --- | --- |
| Character name / alias `小岚` | Allowed; character and manuscript hits returned | Allowed; character and selected-chapter hits returned |
| Confirmed setting `档案门只能在雨夜开启` | Allowed through the author planning background | Allowed through the author planning background |
| Prior event `旧钥匙打开档案室` | Prior manuscript chapter returned | Selected manuscript chapter returned |
| Text after Continue anchor | Current chapter's later manuscript text excluded | Not applicable as an insertion anchor; the whole selected chapter is in range |
| Unselected later chapter | Excluded by Continue's before-anchor/order scope | Excluded by selected chapter IDs |
| Future plan `尚未发生的地下室停电` | `future_plan` evidence excluded | `future_plan` retrieval evidence excluded; Brainstorm separately supplies stored plot plans in a `[Future plans]` prompt section |
| Expired chapter summary | Stale summary excluded | Stale summary excluded from retrieval; stale explicit summaries now fall back to bounded current chapter text |

Positive cases contained the expected source kind and sample fact. The same
hybrid search also returned extra, semantically similar allowed sources; for
example, the confirmed-setting query included manuscript/story-summary hits in
addition to `planning/story-background`.

Book-level `planning` and `character` sources are intentionally visible within
the selected book even when `allowedChapterIds` is set. Chapter-scoped
manuscript and summary sources are restricted to the selected chapters. In
Continue, the current chapter contributes only locator-backed text before the
anchor; its chapter summary is not used as evidence.

### Relevance limitation observed

Temporal and ownership guards passed: no later-chapter manuscript, stale
summary, or `future_plan` hit was returned in the forbidden ranges. The test
also recorded **one unrelated semantic-only hit per consumer** for several
negative-style queries:

- later/unselected text query → book-level `planning/story-background`, score
  about `0.8576`;
- future-plan query → the same allowed background, score about `0.8528`;
- expired-summary query → a fresh manuscript hit, score about `0.8601`.

These are relevance false positives, not future-plan, unselected-chapter, or
stale-source leaks. Their scores are ranking signals, not probabilities. This
sample is too small to recalibrate the shared threshold; do not report zero
false recall for mixed-source scopes. The earlier P1-S3 zero false-recall
observation was from a manuscript-only fixture and has been scoped accordingly.

The confirmed setting used here is the author's `planning.storyBackground`,
currently indexed as a `planning` source and explicitly supplied to Brainstorm
as `authorSetting`. The `confirmed_setting` kind is permitted by the retrieval
contract but currently has no separate source-registry producer.

The test emits one `P1R4_RETRIEVAL_ONLY` JSON line with the timestamp,
platform, embedding provider/model, exact request scopes, per-query source
kind/entity/version/recall method/scores, and false-recall counts. UUIDs are
per-run temporary test identities.

## Candidate protection and local-only boundaries

Automated tests passed for both features:

- Continue: current in-memory draft, session, revision, anchor, lock, and
  retrieved source versions remain bound to the candidate. Synthetic
  GenerationEvents verify candidate-only streaming and stale-source rejection;
  the synthetic candidate passed the local version/lock validator and the
  captured-anchor insertion callback was called exactly once. Cancellation or
  failure left the original draft untouched.
- Brainstorm: explicit future-plan labeling, frozen selected chapter/planning/
  graph/retrieval source versions, malformed JSON retention, preservation of
  the previous candidate and manual Editable Result, and save through the
  versioned workspace persistence path. The synthetic JSON candidate became
  workspace data only after an explicit direction choice; the mocked save
  acknowledged its version. A source change makes an unadopted candidate stale.
- Local mode: workspace read, hand editing, and save remain available without
  a configured model; the local route does not invoke the legacy brainstorm
  HTTP API. This is unit-level evidence, not a physical old-server shutdown or
  CDP run.
- Cross-book leakage remains covered by the P1-E isolation test (zero observed
  in its fixed cases); source locator/version integrity remains covered by
  P1-S3 and P1-R2 storage tests.

These tests verify scope and candidate safety. They do not establish prose
quality or prove that a live model will never drift from the supplied context.
