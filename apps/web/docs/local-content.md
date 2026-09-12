# Local work content contract (weeks 11–12)

> Status: contract defined and schema migrated (unit 1); characters are fully
> local (unit 2). Remaining handlers land in their follow-up units (graph,
> foreshadowing/planning, preferences/brainstorm). This document is the
> field-level source of truth; `local-storage.md` covers the weeks 9–10
> foundation.

Scope: characters, the relationship graph, cross-chapter foreshadowing,
story planning, application preferences and the brainstorm workspace become
local-first inside the same SQLite database. No model generation, no JSON
interchange, no vector/AI tables.

## Field inventory (persisted vs derived vs deferred)

### Characters — `characters` table

| Field | Disposition |
| --- | --- |
| id | UUID assigned by Rust on create. Existing mention/foreshadowing opaque IDs in chapter content are preserved as-is, never bulk-rewritten. |
| book_id | Owning book; composite FK with `id` keeps every graph node in the same book. |
| name / role / description / color | Persisted as-is. role ∈ protagonist/antagonist/supporting/mob. |
| aliases_json, tags_json | Persisted as validated JSON arrays. |
| avatar | Optional. First version uses built-in presets/colors; existing paths/URLs are kept but never auto-fetched, and machine-local paths are not a migration promise. |
| handle_config_json | Character-level default handles. A graph node either overrides it or follows it — never both. |
| is_archived | Deletion is archival: mentions, text and graph references stay; archived characters stop new auto-matching. |
| position, database_version, created_at, updated_at | Standard ordering/optimistic-concurrency/time fields. |
| positionX/positionY (legacy Character fields) | NOT persisted on the character — coordinates belong to graph node instances. Legacy imports map them into a first graph layout. |

### Relationship graph — `graphs`, `graph_nodes`, `graph_edges`

| Field | Disposition |
| --- | --- |
| graphs.book_id | One graph per book; `databaseVersion` guards the whole snapshot (nodes + edges + layout). |
| graph_nodes.node_key | Node INSTANCE id (UUID), separate from `character_id`. Multiple nodes per character are allowed and never merged. |
| graph_nodes.position_x/y | Persisted; finite bounds checked. |
| graph_nodes.handle_config_json | NULL follows the character default; non-null is a node override. Editing the character default must not rewrite overrides. |
| graph_edges.source/target_node_key, handles, label | Edge endpoints are node instances, cascade with node deletion, and must belong to the same book/graph (composite FK + transaction checks). |
| Viewport | NOT persisted (session UI state). |

Derived only: React Flow rendering state, edge filtering by handle modes.

### Foreshadowing (in-chapter + board)

Chapter body marks and the complete notes array stay the single source; the
board is a read/aggregate projection over the book's chapters, located by
`(bookId, chapterId, noteId)`. No separate writable note copy is created.
Note IDs are opaque and preserved as-is; uniqueness is only required per
chapter.

### Story planning — `planning` table

storySummary, storyBackground, chapterSummaries (each `{chapterId, summary,
updatedAt, sourceChapterVersion}`), plotSettings (each `{id, title, details,
chapterIds, createdAt, updatedAt}`) persist as Rust-validated JSON inside one
per-book row with its own `databaseVersion`. Chapter references are validated
in the write transaction. AI never auto-fills; summaries are human-authored.

### Application preferences — `application_preferences` (single row, id = 1)

darkMode, editorMarginPx, editorLineHeight, aiContinue context/output chars
and auto-highlight disabled roles persist here, independent of any book and
unaffected by book locks. NULL means "not set" (frontend defaults apply).
Secrets never enter this table; whole-book JSON will not include it. The
style library stays in localStorage for now and is documented as not covered
by SQLite backups.

### Brainstorm workspace — `brainstorm_workspaces` (one per book)

selectedChapterIds (live selection), contextSnapshot (historical snapshot
carrying its own source versions inside the JSON), generatedOptions,
selectedOptionId, finalContent, plus `databaseVersion`/timestamps. Manual
use only in this stage: generation is explicitly unavailable.

Deferred (not in 0002): vector indexes, AI task tables, whole-book JSON
schemaVersion, legacy-ID mapping tables (designed, not yet built).

## IPC contract (names fixed at implementation time)

Business commands only — no arbitrary SQL or path access. All mutations take
expected versions and return the committed record(s) inside the existing
`{ ok, value/error }` envelope with distinct codes (NOT_FOUND,
OWNERSHIP_MISMATCH, VERSION_CONFLICT, READ_ONLY, INVALID_INPUT,
CONTENT_INCOMPATIBLE, STORAGE_FAILURE).

| Command | Shape | Semantics |
| --- | --- | --- |
| local_list_characters | `{ bookId }` → `LocalCharacter[]` | Active + archived, ordered. |
| local_create_character | `{ input: { bookId, name, role, aliases, description, color, tags, avatar?, handleConfig? } }` → character | Rust assigns UUID/position; book must be unlocked. |
| local_update_character | `{ input: { bookId, characterId, expectedDatabaseVersion, ...fields } }` → character | Version-guarded partial update; never touches chapter content. |
| local_archive_character | `{ input: { bookId, characterId, expectedDatabaseVersion, isArchived } }` → character | Archive/unarchive; references preserved. |
| local_reorder_characters | `{ input: { bookId, expectedDatabaseVersion?/per-item versions, items } }` → characters | Same complete-set rules as volume reorder. |
| local_read_graph | `{ bookId }` → `{ graph, nodes, edges } \| null` | `null` means "not initialized yet" — never an empty-graph lie. Load failure is an error, not null. |
| local_initialize_graph | `{ input: { bookId } }` → `{ graph, nodes: [], edges: [] }` | Explicit first-time creation, persisted; seeding from characters is a separate explicit call, not an automatic side effect of opening the page. |
| local_save_graph | `{ input: { bookId, expectedGraphVersion, nodes, edges } }` → `{ graph, nodes, edges }` | Whole-snapshot write in one transaction: endpoint ownership, dangling edges, coordinate/handle validation; stale version rejected. |
| local_read_planning / local_save_planning | `{ bookId }` / `{ input: { bookId, expectedDatabaseVersion, ...aggregate } }` | Per-book aggregate; chapterIds validated in-transaction. |
| local_list_foreshadowings | `{ bookId }` → aggregated notes with chapter location | Read projection over chapters; ordered by volume/chapter position. |
| local_update_foreshadowing_note | `{ input: { bookId, volumeId, chapterId, noteId, expectedChapterVersion, note?, isRecovered? } }` → chapter | Reads the chapter in-transaction, changes only the target note, preserves body, other notes and unknown fields, returns the new chapter version. |
| local_read_preferences / local_save_preferences | none / `{ input: { expectedDatabaseVersion, ...fields } }` | Single-row application preferences, optimistic version. |
| local_read_brainstorm / local_save_brainstorm | `{ bookId }` / `{ input: { bookId, expectedDatabaseVersion, ...workspace } }` | Workspace aggregate; selected chapter IDs validated in-transaction. |

## Locking, versions and deletion impact

- Book lock protects everything inside the book (characters, graph,
  planning, workspace); chapter lock protects in-chapter foreshadowing
  edits; application preferences are unaffected by work locks.
- Unlock rules mirror the foundation: a record's own lock never blocks
  unlocking itself; ancestors' locks do.
- Whole-book delete cascades through every dependent table (volumes,
  chapters, characters, graph, planning, workspace) in one transaction and
  respects locks and unsaved drafts.
- Chapter delete additionally handles dependent references in the same
  transaction: its chapter summary is removed after explicit confirmation,
  plotSettings keep their text with the dangling reference removed and
  surfaced, the workspace live selection drops the chapter, and historical
  context snapshots are kept and marked as coming from a deleted source.
  A locked or version-guarded dependency rejects the whole operation.
- Node delete removes only that instance and its edges — never the
  character. Character archive keeps graph nodes and marks them.

## Schema upgrade strategy

`user_version` is now 2. Upgrades are additive numbered migrations applied
in one immediate transaction per version step (`0001` is frozen). Before any
upgrade from an existing versioned database, a consistent online backup is
written into `<app-data>/backups`; a failed backup stops the upgrade and the
old database keeps its version and rows. A failed migration rolls the
transaction back — the database is never dropped or rebuilt to recover.
Regression evidence: a seeded v1 library upgrades with content, original
recovery copies, IDs, unknown foreshadowing fields and lock states intact;
a poisoned upgrade path leaves the v1 database fully readable; fresh
databases initialize at version 2 with no pre-upgrade backup.

Version spaces stay separate: SQLite `user_version` (schema), record
`databaseVersion` (optimistic concurrency), chapter `contentVersion`
(format), and the future interchange `schemaVersion` (exchange).

## Unit 2 implementation: characters local with mention compatibility

Commands `local_list_characters`, `local_create_character` (returns the
character plus the bumped book, like volume creation), `local_update_character`
and `local_archive_character` are registered with the usual envelope,
ownership, lock and optimistic-concurrency rules; field validation covers
name/role/color/description/aliases/tags/avatar and the four-side handle
config. Deletion maps to archiving: the record stays cached with
`isArchived`, and unarchiving is the same command with `false`.

Character data reaches the editor through the shared `characterData`
extension storage (`characters` = everyone incl. archived for mention
reconcile and tooltips; `autoHighlightCharacters` = not archived and roles
not disabled for new matches). Extension options are only the initial
fallback. The editor's `useEditor` no longer takes characters in its
dependency list, so creating, renaming or archiving a character never
rebuilds the Tiptap instance — caret, undo history, selection and drafts are
untouched, verified in the desktop smoke (typing and undo continue right
after a character save, and the fresh mention appears in place). Mentions
reference the stable character ID; renaming never rewrites chapter text, and
the reconcile pass updates only label/color drift. Archived characters keep
their mentions and graph references, disappear from `@` suggestions and new
auto-matches, and show an "Archived" badge in the list.

The character settings page is back on its own route and loads the book
detail plus characters through the local queries; the editor's world-
building button and mention clicks navigate there through the existing
flush-protected navigation. Avatars stay audit-compliant with the contract:
no upload UI exists, the built-in color swatches are the only visual
identity, and stored avatar paths/URLs are never auto-fetched. Character
reordering remains an explicit stub until its command lands (book-level
management is tracked in unit 6).

### Verification record (2026-09-12, unit 2)

Real Windows desktop run via WebView2 CDP: character created through the
settings page commits with a Rust UUID and bumped book version; returning to
the editor auto-highlights the name in place without a rebuild; typing and
undo continue across the refresh; archiving shows the badge, keeps the
existing mention, and produces no new matches; a second book never matches
the first book's character. Frontend: 259 tests (provider CRUD/archive,
projection mapping, storage-driven highlight, archived mention preservation,
cross-book isolation fixtures), zero-warning lint, production build. Rust:
20 tests (character CRUD/archive concurrency, validation, locks), Clippy and
`cargo fmt --check` clean. Secret scan clean. Not yet covered: character
reorder persistence (stubbed by design) and unarchive UI (the command
already accepts `isArchived: false`).
