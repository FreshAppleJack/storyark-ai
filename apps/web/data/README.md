# Data boundary

Desktop persistence uses the typed repositories in `local/` and Tauri commands.
The local provider stack owns the shared query cache and coordinates chapter
writes. Repositories do not create independent draft stores or save queues.

- `domain/` contains shared normalization and content rules without React,
  storage or network access.
- `local/repository.ts` unwraps native results, preserves error codes and exposes
  readable recovery messages. Original diagnostics are logged without arguments,
  credentials or authored content. Browser preview rejects desktop-only operations.
- Feature repositories own IPC payloads and result types. Validation, ownership,
  locks and optimistic version checks also run in Rust before persistence.
- Reads distinguish failure from valid empty data. Writes acknowledge committed
  versions; dispatching a request alone cannot mark a draft saved.
- Chapter saves, locking and deletion share the write queue. Parent deletion drains
  affected drafts first. Late completions cannot clear a newer draft revision.
- `export/` defines the portable work envelope, validation and import/export
  boundaries. It does not export SQLite rows, credentials or transient requests.
- AI generation repositories own transport and events. Feature hooks own temporary
  candidates; adopting a result uses the normal writing or planning save path.

Legacy HTTP API modules and `mappers.ts` remain for compatibility/reference. Their
DTOs are separate from the native contracts and do not authorize desktop operations
to fall back to a server. HTTP errors reject to the caller without forcing a page
reload that could discard a draft.

See the [maintenance documentation](../docs/README.md) for storage, AI and exchange
contracts.
