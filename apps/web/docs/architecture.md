# Architecture and code map

StoryArk's normal runtime is a desktop application. The browser renders the UI;
the native process owns persisted work, credentials, provider requests and local
retrieval. No separate backend service is required for desktop use.

```text
React pages and feature hooks
    │ shared providers, drafts and query cache
    ▼
Typed local repositories → Tauri IPC commands
    ├─ storage worker → SQLite / backups / work import-export
    ├─ AI runtime → configured external generation provider
    │                  └─ streamed, temporary candidates → explicit adoption
    └─ retrieval runtime → bundled embedding model + SQLite search/index data
```

## Frontend

| Directory | Responsibility |
| --- | --- |
| `pages/` | Routed page composition and navigation. |
| `features/` | Editor, books, characters, relationships, planning, brainstorming, retrieval, settings and help behavior. |
| `components/` | Shared controls and presentation. |
| `InteractionContent/` | Shared session, preferences, book providers and persistence lifecycle. |
| `data/local/` | Typed native repositories; IPC input/output boundaries. |
| `data/export/` | Portable work envelopes, validation and exchange orchestration. |
| `domain/` | Shared rules and data contracts. |
| `test/` | Repeatable frontend and boundary tests with isolated fixtures. |

See [feature ownership](../features/README.md) and [data ownership](../data/README.md)
before adding state or an IPC client. Legacy HTTP modules remain for reference;
they are not a fallback when native desktop operations fail.

## Native process (`src-tauri/`)

| Location | Responsibility |
| --- | --- |
| `src/storage/` | SQLite ownership, serialized writes, version/lock checks, backups and import/export. |
| `src/ai/` | Configuration, credential access, context snapshots, provider adapters, streaming and task cancellation. |
| `src/rag/` | Embedding resources, retrieval and indexing runtime. |
| `src/storage/retrieval_*.rs` | Persisted retrieval sources, chunks, search and indexing scheduler state. |
| `src/diagnostics.rs` | Native diagnostic capture, redaction, log destinations and retention. |
| `migrations/` | Immutable numbered migrations and the generated schema snapshot. |
| `capabilities/`, `build.rs` | Native permissions and custom command registration. |
| `resources/embedding/` | Git LFS model weights, tokenizer files and upstream notices. |

## Ownership and lifecycle

SQLite is authoritative for saved work. The editor owns the current in-memory
draft until its versioned save is acknowledged. A late acknowledgement cannot
clear a newer edit. Navigation and normal window close flush registered drafts;
failed saves preserve them for retry.

AI requests freeze their source/context and configuration. Streamed output stays
temporary until the author adopts it through the normal writing/planning save
path. Choosing a brainstorm direction and saving its workspace are separate from
generation. Provider credentials never enter saved work or JSON exports.

Search chunks and embeddings are derived from committed content. A missing or
stale index must not erase authored content. Local search and generation context
share freshness checks, but a draft is not relabeled as a committed indexed source.

Whole-work export flushes drafts and reads one validated SQLite snapshot. Import
validates the envelope and references before a transaction; replacement requires
a verified backup, while a copy remaps identities. Neither operation copies the
application's preferences, credentials or derived search index.

## Follow the contract for the change

- Library writes and concurrency: [local-storage.md](local-storage.md).
- Characters, graph, planning and workspaces: [local-content.md](local-content.md).
- Provider configuration, context and adoption: [ai-contracts.md](ai-contracts.md).
- Index freshness and scheduling: [retrieval-r0.md](retrieval-r0.md).
- Evidence used by generation: [retrieval-r1.md](retrieval-r1.md).
- Portable files and recovery: [storyark-work-exchange.md](storyark-work-exchange.md).
- Error presentation and private diagnostics: [user-facing-errors.md](user-facing-errors.md).
