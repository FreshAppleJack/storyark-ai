# AI configuration and generation contract (work unit 1)

Initial unit-1 scope: schema and Rust wire types only. Unit 2 implements settings and
credential storage. Unit 3 implements provider transport and task ownership; prose
adoption remains reserved for the next work unit.

## Persistence

Migration 0004 adds `ai_model_configs` and `ai_generation_settings`. The latter
is an optional singleton: no row means `defaultConfigId: null`, version 0.
The former stores generation-only configuration, never embedding configuration.
No vectors, models, user accounts, API keys or generated content are seeded.

IDs and credential references are canonical UUID strings. Rust must validate
UUIDs before writes (the SQL length constraint is only defense in depth).
Credential references are generated internally, never accepted in ConfigInput.
Timestamps are UTC Unix milliseconds. Config versions start at 1 and increase
on every successful configuration or credential-reference change. The default
selection has its own databaseVersion. PRAGMA user_version is migration version
4; future JSON schemaVersion and editor revision/session are unrelated values.

All writes use the existing serialized worker and an IMMEDIATE transaction.
Create generates the UUID in Rust. Update checks expectedConfigVersion in the
transaction and increments it once. The first default write expects version 0;
subsequent writes compare and increment the singleton version. Delete checks
both config and default-selection versions; if selected, clear the default and
advance its version in the same transaction before deletion. Never silently
select another provider. Missing records and stale versions are distinct errors.
Credential cleanup occurs after commit; failed cleanup must remain recoverable.
Cross-store secret staging and compensation belong to work unit 2.

## Reserved IPC signatures

All commands return a typed success or AiError. Config reads omit credentials
and credential references; saved keys must never be returned to the WebView.

| Command | Input | Success |
| --- | --- | --- |
| ai_list_configs | none | ConfigList |
| ai_save_config | SaveConfig | ConfigRecord with committed configVersion |
| ai_delete_config | ConfigVersion plus expectedDefaultDatabaseVersion | ConfigList after commit |
| ai_set_default | SetDefault | ConfigList after commit |
| ai_test_connection | requestId and ConfigVersion | matching requestId, configVersion; validated text response only |
| ai_prepare_context | bookId, target, sessionId, draftRevision, bounded draft text | opaque contextSnapshotId plus source versions |
| ai_start_generation | GenerateRequest and caller-scoped output channel | accepted requestId (not saved content) |
| ai_cancel_generation | CancelRequest | requestId and cancelled/alreadyFinished/notFound outcome |

The context preparer is separate from generation. It validates the bounded,
typed sections supplied by the caller, binds them to the book/session/draft
revision and target, and stores an opaque Rust-owned snapshot. The local
brainstorm caller freezes workspace, planning, graph and selected chapter
versions; the SQLite boundary verifies ownership and exact versions before the
snapshot is accepted and again before network work starts. The current transport
does not pretend that a caller-supplied section list is RAG. Generation resolves
the snapshot and saved config by ID. It accepts neither arbitrary URLs/headers
nor a client-supplied prompt labeled trusted. Snapshots are consumed once and
expire after the in-memory retention window; request IDs cannot be reused for a
second active task.

## Events and adoption

GenerationEvent carries requestId, sessionId, monotonic sequence and a tagged
payload: started, delta, completed, failed or cancelled. Exactly one terminal
event is permitted. A terminal completed payload contains the full candidate;
clients must replace their candidate buffer, not append it to existing deltas.
An accepted request only means task registration, not network success.

The caller window owns the task and snapshot. Cancellation must validate both
owner and session. Switching config cannot retarget an already running request.
Chapter targets carry chapter databaseVersion; brainstorm targets carry the
workspace, planning, graph and selected source chapter versions. Book ID identifies
its single brainstorm workspace. Session/revision remain frontend draft guards,
not replacements for SQLite optimistic concurrency. At adoption, recheck the
current draft/anchor/lock; continuation and brainstorming keep separate adoption
handlers and reuse their existing save paths. Generation never writes prose.

## Validation and errors

ConfigInput rejects unexpected fields, URL credentials/query/fragment, invalid
protocol/host, control characters and out-of-range limits. HTTPS is supported;
HTTP is restricted to loopback. Custom proxy paths are retained. Actual endpoint
joining and provider parameter support belong to provider adapters. Do not
forward credentials across redirect origins. Model IDs are user supplied; no
prefix-based key validation or fixed model catalogue is part of this contract.

AiErrorCode distinguishes VALIDATION_ERROR, CREDENTIAL_UNAVAILABLE,
AUTHENTICATION_FAILED, MODEL_NOT_FOUND, RATE_LIMITED, TIMEOUT, CANCELLED,
PROTOCOL_ERROR, TRUNCATED, STORAGE_FAILURE, NOT_FOUND, VERSION_CONFLICT,
CONTEXT_CHANGED, LOCKED and UNAVAILABLE. Its closed payload contains only code,
optional requestId and optional retryAfterMs. UI text maps from the code.
Do not pass provider bodies, Rust debug errors, headers or keys through errors.
Provider errors must be classified rather than echoed; automatic inference
retries after output are not allowed.

## Module boundaries and follow-up

`src/ai/config.rs`, `error.rs`, and `generation.rs` are public, serializable
contracts. `credentials`, `providers`, `stream`, `tasks` and `context` keep
credential lookup, provider-specific payloads, SSE parsing, task ownership and
context validation separate; `mod.rs` only wires those modules together. The
existing storage owner implements config operations in a dedicated storage module,
and dedicated Tauri commands delegate to it.

`migrations/schema_snapshot.sql` is generated by `npm run schema:sync`.
It has no numeric migration prefix and must never enter the runtime registry.
Run `schema:check` and `schema:test` after changing registered migrations.

## Work unit 2 implementation

Configuration commands are now registered in `ai_commands.rs`. `ai_save_config`
accepts `SaveSettings` (id/null, expectedConfigVersion, config, credential action).
The credential action is `keep` or `replace` with key and remember. A changed
base URL or protocol requires replacement; a blank input never erases a key.
Success acknowledges the committed ID/version; list reads return metadata and
credential status only. No key or credential reference is returned to JavaScript.
The generation/context commands above are implemented in the unit 3 transport
layer; they do not save generated content.

Migration 0005 adds credential_mode and the metadata-only cleanup queue. A new
reference's cleanup intent is committed first. An IMMEDIATE transaction then
rechecks the intent and configuration version, stages the new credential, and
commits its reference and config together. Another process cannot clean the
reference during staging. Failed writes retain/clean the unused new reference;
old credentials are queued only in the successful config transaction. Cleanup
checks active references under a write lock and never deletes one in use.
Deletion and clearing the selected default commit together. Cleanup failure
keeps the queue and is visible on list reads; it does not undo a committed save.
Startup and list reads retry cleanup. The queue contains no credential material.

Keys are trimmed and reject embedded controls, with no vendor-prefix assumption.
Secrets use zeroizing Rust buffers where owned by this module; OS/network library
buffers and the transient WebView input are not claimed to be perfectly erasable.
The frontend clears its key field on submit, including failed submissions.
Session credentials live only in the process. System mode uses keyring 3.6 with
explicit windows-native and apple-native backends. Unsupported platforms reject
system mode rather than falling through to keyring's mock backend; the UI offers
session mode. There is no plaintext fallback and no secret-read IPC.

Connection tests resolve a saved config/version and key on the storage worker,
then send a bounded non-streaming synthetic request on a separate worker. The
HTTP response is capped at 256 KiB; the test is capped at 60 seconds and 256
output tokens (or the configured smaller limit). HTTPS validation stays enabled,
redirects are refused and authorization headers are sensitive. Tests require
completed, nonempty protocol-specific text; a 200 response alone is insufficient.
Provider bodies and generated text never return through the test IPC. Model or
endpoint 404 is displayed as such rather than claiming which one was missing.

Each probe uses an immutable config/key snapshot. Editing/deleting that config
invalidates the completion by version check. Changing the default does not
retarget a running probe. This bounded probe may finish its network call after
leaving Settings, but its late UI result is discarded. No automatic retries or
background generation are introduced by the settings page.

## Work unit 3 implementation

The three transport adapters are independent: OpenAI Responses uses `input`,
`max_output_tokens`, `store: false` and `response.output_text.delta`; OpenAI-
compatible Chat Completions uses `messages`, `max_tokens`, usage-enabled stream
options and `choices[0].delta.content`; Anthropic Messages uses its API-version
and `content_block_delta` text events. Tool calls, reasoning/thinking deltas,
unknown metadata events and provider heartbeats never enter the candidate text.
Provider-specific fields are not flattened into a pretend common request model.

The SSE parser buffers bytes until complete UTF-8 lines, joins repeated `data`
fields, ignores comments/heartbeats, rejects invalid UTF-8 and bounds both an
event and the whole response. The stream layer applies connect/first-response,
idle and total deadlines, an 8 MiB response cap and a two-task semaphore. A
length/max-token termination is reported as `TRUNCATED`; no automatic replay is
attempted after any delta has been emitted.

`AiRuntime` owns one-time context snapshots and active request IDs. The caller
registers the task and output sink before network I/O; cancellation uses a
request/session pair and interrupts the actual response future. Terminal output
is emitted once by the task owner, late provider events are ignored, and the
window-targeted Tauri event uses the initiating WebviewWindow rather than a
broadcast event. `aiGenerationRepository.ts` is only a typed IPC/event thin
layer; no editor or brainstorming state is written by unit 3.

Unit 3 validation covers all three adapter event formats, ignored tool/reasoning
blocks, OpenAI usage aliases, fragmented UTF-8/multiline SSE, Unicode-safe
context budgets, one-time snapshot consumption, and cancellation after a first
delta. Live paid provider compatibility and frontend adoption are intentionally
not claimed by these tests.

Settings reuse SettingShell, Button and SaveStatusIndicator. Tests have separate
feedback from local saves; no duplicate toast is emitted. Unsaved edits prevent
navigation/close until Save or Cancel. Credential-store failure leaves edits and
previous configuration intact; the key must be re-entered after a failed submit.
A list refresh failure after commit is not represented as a failed database save.

Validation: Rust regression/compensation tests, Node schema reconstruction tests,
frontend build, and a temporary CDP script against an isolated Tauri WebView.
Native Windows vault verification uses an isolated synthetic credential in a
separate child process and deletes it afterwards. macOS Keychain behavior and
real paid OpenAI/Anthropic services remain unverified on this Windows machine.
The local HTTP probe fixture is not evidence of live vendor compatibility.

Windows desktop acceptance additionally verified normal application close/reopen:
session credentials became unavailable, system credentials remained configured,
and deleting both fixtures cleared the default and pending credential cleanup.
The native fixture and the isolated test configuration were removed after testing.

## Work unit 4 implementation: AI Continue adoption boundary

The local editor now uses `aiGenerationRepository` and Tauri IPC directly. The
local path no longer imports the legacy HTTP continuation service and does not
retry or fall back to it when local generation fails.

Each request captures the book/chapter identity, editor session, draft
revision, bounded context from the current in-memory draft, the insertion
anchor/selection, and the lock state. The context section is labeled
`Current in-memory draft`; no database body is reread and relabeled as the
current draft. Deltas stay in a session-only candidate buffer. A completed
candidate is distinct from a saved chapter.

Continue generation uses a dedicated prompt that asks for only the new
manuscript prose after the draft, matching its language, voice, tense,
viewpoint, formatting and established facts. Reviews, critiques, summaries,
corrections, labels and other meta-commentary are explicitly excluded from the
continuation output. The draft is delimited as input context and is never
treated as generated text. The author-facing output character target is
captured with the generation request and added to this prompt; provider token
limits remain a technical safety cap rather than the writing-length control.

Adoption rechecks the chapter/session/revision, lock, editor selection and
document size. A changed source preserves the candidate and requires
regeneration or restoring the original insertion position. Successful
adoption uses one structured Tiptap insertion command, so the editor's normal
serialization, revision tracking and autosave queue handle persistence without
flattening the document or parsing generated text as HTML. Existing nodes,
marks, mentions, foreshadowing data and unknown content outside the insertion
range are not rewritten.

Failures, cancellation, empty output and truncation leave the original body
untouched and never show it as saved. The candidate panel provides preview,
stop, adopt, regenerate, discard and close actions; closing an adopted panel
does not undo the inserted text. Adopted text remains subject to the existing
navigation and native-close save guards. Frontend tests cover the candidate
lifecycle, stale revisions/anchors, read-only adoption, terminal failure
states, structured insertion and undo. Real provider and packaged desktop
acceptance remain separate evidence items.

## Work unit 5 implementation: brainstorm candidate boundary

The local brainstorm page reuses its chapter picker, character and relationship
context, candidate cards and editable final-content area, but generation now
uses the configured-model IPC path. The prompt requests exactly three minimal
structured options (`title`, `conflict`, `motivation`, `consequences` and
`development`) as JSON. The frontend validates field types and bounded lengths;
invalid or incomplete JSON remains a safe, session-only raw candidate and never
becomes a saved option. No automatic repair request is sent.

Streaming deltas remain in the candidate buffer. Generation, candidate choice
and workspace/database save are separate states. Choosing a valid direction
copies it into the existing workspace, preserves manual `finalContent`, records
only non-secret metadata (config ID, model ID, time, prompt version and source
versions), and reuses the existing revisioned save queue. Regeneration or a
changed source cannot replace the working draft. Missing summaries are labeled;
the context may contain only a bounded excerpt of the currently loaded chapter
text and never triggers a hidden model call. Relationship edges retain their
source and target node instance keys, so duplicate nodes for one character are
not merged.

## P1-SUM2: chapter summary suggestion boundary

Story Outline keeps summary generation beside each chapter card. The local
provider path captures the current chapter and planning versions, sends only
the selected chapter body as the event source, and requests a chapter-scoped
retrieval context for confirmed settings and character profiles. Relationships
and foreshadowing notes are excluded from summary retrieval. Future plans,
other chapters, stale sources, and generated sources are
excluded. Retrieved evidence is presented as terminology context, not evidence
that an event happened.

The previous summary remains untouched while the suggestion streams into
temporary state. Review shows the saved text beside the suggestion and identifies
the selected chapter excerpt and actual retrieval evidence. Invalid, empty,
truncated, cancelled, failed, or late responses never enter the planning row.
Accept rechecks the chapter, planning version and retrieved source versions,
then persists as one normal optimistic planning save with AI provenance. A
conflict keeps the draft and does not retry against a newer version. No default
model or retrieval source leaves reading and manual editing/saving available;
no alternate model is invoked.
