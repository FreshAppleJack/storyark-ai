# AI configuration and generation contract (work unit 1)

Status: schema and Rust wire types only. No UI, credential implementation,
provider networking, or fake successful IPC handlers are introduced here.
The commands below are reserved contracts, not registered callable commands.

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

The context preparer is separate from generation. It validates every chapter's
book ownership and workspace/planning versions using SQLite, binds the bounded
in-memory draft to that session/revision, and produces an opaque Rust-owned
snapshot. Generation resolves that snapshot and saved config by ID. It accepts
neither arbitrary URLs/headers nor a client-supplied prompt labeled trusted.
Snapshots expire on cancellation, completion or session disposal; request IDs
must not be reused to dispatch duplicate provider calls. Implementation follows
in the transport/context work unit; no empty snapshots are fabricated now.

## Events and adoption

GenerationEvent carries requestId, sessionId, monotonic sequence and a tagged
payload: started, delta, completed, failed or cancelled. Exactly one terminal
event is permitted. A terminal completed payload contains the full candidate;
clients must replace their candidate buffer, not append it to existing deltas.
An accepted request only means task registration, not network success.

The caller window owns the task and snapshot. Cancellation must validate both
owner and session. Switching config cannot retarget an already running request.
Chapter targets carry chapter databaseVersion; brainstorm targets carry the
workspace, planning and selected source chapter versions. Book ID identifies
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
contracts. Add `credentials`, `providers`, `stream`, `tasks` and `context` only
when their implementations arrive; do not fill mod.rs with those responsibilities.
The existing storage owner will implement config operations in a dedicated
storage module, and dedicated Tauri commands will delegate to it. Unit 1 defines
these operations; units 2 and 3 implement and register them.

`migrations/schema_snapshot.sql` is generated by `npm run schema:sync`.
It has no numeric migration prefix and must never enter the runtime registry.
Run `schema:check` and `schema:test` after changing registered migrations.
