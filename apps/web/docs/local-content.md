# Local work content contract (weeks 11–12)

> Status: contract defined and schema migrated (unit 1); characters (unit 2),
> the relationship graph (unit 3), foreshadowing/planning (unit 4) and
> preferences/brainstorm (unit 5) are fully local. This document is the
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
| local_reorder_characters | `{ input: { bookId, expectedBookVersion, items: [{ characterId, expectedDatabaseVersion }] } }` → ordered characters | Complete set including archived characters; validate ownership, book lock and all versions, then commit positions atomically. Only character versions advance. |
| local_read_graph | `{ bookId }` → `{ graph, nodes, edges } \| null` | `null` means "not initialized yet" — never an empty-graph lie. Load failure is an error, not null. |
| local_initialize_graph | `{ input: { bookId } }` → `{ graph, nodes: [], edges: [] }` | Explicit first-time creation, persisted; seeding from characters is a separate explicit call, not an automatic side effect of opening the page. |
| local_save_graph | `{ input: { bookId, expectedGraphVersion, nodes, edges } }` → `{ graph, nodes, edges }` | Whole-snapshot write in one transaction: endpoint ownership, dangling edges, coordinate/handle validation; stale version rejected. |
| local_read_planning / local_save_planning | `{ bookId }` / `{ input: { bookId, expectedDatabaseVersion, ...aggregate } }` | Per-book aggregate; chapterIds validated in-transaction. |
| local_read_book | `{ bookId }` → full chapter snapshots | Board aggregates notes from this consistent SQLite read; ordered by volume/chapter position. |
| local_update_note | `{ input: { bookId, chapterId, noteId, expectedDatabaseVersion, note?, isRecovered? } }` → committed chapter | Patch only the target note in a transaction; preserve body and unknown fields. |
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

## Unit 3 implementation: relationship graph local

Commands `local_read_graph`, `local_initialize_graph` and `local_save_graph`
implement the contract exactly: a missing graph row is `null` (distinct from
a load error and from an initialized empty map), initialization is explicit
and idempotent, and saving replaces nodes, edges and the graph version
compare-and-swap inside one immediate transaction. Validation rejects
cross-book characters, dangling endpoints, duplicate keys, non-finite or
out-of-range coordinates, invalid handles and edges whose port mode the
owning node's effective config (node override, else the character default)
does not allow. Node keys are instance IDs independent of character IDs, so
multiple nodes per character coexist. Saving writes the node's complete
handle configuration — character defaults are copied when a node is added or
loaded and are never written back from the graph, which keeps one owner per
config. The viewport stays session UI state.

The canvas page is back on its route, loads book detail, characters and the
graph through local queries, and opens an uninitialized book straight into an
empty canvas (matching the legacy page): the page issues the idempotent
initialize command itself — reads still never seed graphs, failures still
surface as errors, and saved empty maps stay empty forever. Drag
edits debounce through a revision/acknowledgement scheduler that drains
drags made while a commit is pending (an older ack never clears newer
drags); route changes and the native window close wait for that flush via
`useGraphSaveGuards` (blocker + close guard + beforeunload). Node deletion
removes the instance and its edges, never the character; archived characters
keep their nodes with an "Archived" badge and leave the palette; port
changes that would drop edges ask for confirmation first. Changing a
character's default handles is validated against inheriting nodes so
connections cannot silently break (and bumps the graph version).

### Verification record (2026-09-12, unit 3)

Real Windows desktop run via WebView2 CDP, no backend: character created
through the settings UI; a mention inserted through the editor's real
command pipeline and saved; the map initialized explicitly; the same
character dropped twice as two instances with distinct positions; a
right-source to top-target edge labeled "另一个自己" connected through real
handle mouse events and saved. A normal window close reopened with both node
positions, the edge and its label intact; a second reopen after another save
confirmed the same. The chapter with its mention stayed intact throughout.
Frontend: 264 tests (projection round-trips, pending-commit drains,
conflict layout retention, port-change confirmation, missing-character edit
block), zero-warning lint, production build. Rust: 25 tests (round-trip
with archival and saved-empty graphs, validation rejections, transactional
rollback with an injected trigger, stale-version and lock rejections,
inherited-port protection, IPC registration), Clippy and `cargo fmt --check`
clean. Secret scan clean.

## Unit 4 implementation: foreshadowing and planning

The board uses `local_read_book`, not a second notes store. Its identity is
`(bookId, chapterId, noteId)`; a missing body mark is shown as unlocated but
never removes the note. Source links use chapter and mark IDs, not indexes.
`local_update_note` checks chapter ownership, ancestor locks and the expected
chapter version inside an immediate transaction. Only the target note and
chapter version/time change; body, other notes and unknown note keys survive.
An editor departure flushes pending writes, and returning mounts the editor
only after a fresh chapter query. Board drafts serialize their own writes;
conflicts retain edits and never adopt a newer version to force a retry.

`local_read_planning` returns an empty aggregate with databaseVersion 0 only
when the row genuinely does not exist. Errors remain errors. The first save
expects 0; subsequent saves expect the persisted version. `local_save_planning`
takes the complete aggregate plus `sessionKey` and `revision`, and returns
`{planning, sessionKey, revision}` after commit. Array order and unknown entry
fields survive. Live chapter references must belong to this book. No new SQL
migration is needed: these fields use the existing schema version 2 tables.

Story background holds author-defined setting; plot settings hold future
intent; chapter summaries describe existing chapters. Editing a summary records
its sourceChapterVersion. A later chapter version mismatch (including a note
edit) produces a conservative stale-source hint, never an automatic rewrite.
Missing source versions are also treated as unverified. No model is called.
Planning drafts drain newer edits after pending saves; route departure and
normal native close wait for successful commits. Load failures, storage errors
and version conflicts cannot replace drafts with empty defaults.

Chapter/volume deletion uses the existing confirmation, with explicit summary
and reference consequences. The same transaction removes chapter summaries
and live plot links, retaining plot text and adding `missingChapterIds` for
inline missing-link feedback. Existing brainstorm live selections are cleaned;
opaque historical snapshots survive with `deletedChapterIds` annotations.
Changed planning/workspace versions advance atomically with deletion. A failed
step rolls back all of these changes. Full JSON interchange remains deferred.

### Verification record (2026-09-12, unit 4)

Frontend: 269 tests pass, typecheck/build and lint pass. Rust: 29 tests pass,
Clippy with warnings denied passes. Tests cover opaque note preservation,
composite identities, stale versions, foreign chapter references, persistence
across reopening, injected transaction failures and atomic deletion cleanup.
A temporary `.mjs` CDP script exercised an isolated real Tauri/SQLite instance:
board note edit/recovery preserved rich body and other chapter notes; orphan
notes stayed visible; the editor reread committed notes. Planning form values,
chapter summary source version and plot links persisted. An injected SQLite
failure retained the visible draft and blocked route departure; retry worked.
Closing the native window with an unsaved planning field flushed it, and a new
process recovered all fields. No production user database was used.

## Unit 5 implementation: application preferences and the brainstorm workspace

`local_read_preferences` returns null only when the single row was never
initialized; that alone authorizes the one-time import. The import reads this
origin's four known localStorage keys, validates each through the existing
normalizers, and commits the write expecting version 0 — a row created
meanwhile makes the import fail with a conflict, and the importer adopts the
stored row instead of overwriting it. Unreadable entries fall back to
defaults with a one-time notice, and their raw localStorage values survive
(launch-cache writes skip preserved keys until the user replaces them through
the UI). The style library stays in localStorage as before and is not covered
by SQLite backups; secrets never enter the preferences table, and whole-book
JSON will not include application preferences.

SQLite is the persistence authority on desktop; `storyark_dark_mode` and the
other keys remain only a launch cache against theme flicker. While the row is
loading nothing writes back (no default can race ahead — cache effects skip
their first run), and a change made during loading wins over the arriving row
and is persisted. Every UI change applies instantly as a visual preview and
is serialized through a save queue with the optimistic version; failures are
announced, never shown as saved, and leave the visible choice for retry.
Preferences are unaffected by book locks. The settings page is back at
`/settings` without login/register/account sections.

The brainstorm workspace splits the local repository from any future
generation provider. `local_read_brainstorm` returns the empty aggregate with
version 0 only when the row genuinely does not exist; `local_save_brainstorm`
takes the whole workspace with sessionKey/revision acknowledgement and
validates live selected chapter IDs against the book in-transaction.
Generation is explicitly unavailable: both generate buttons are disabled with
an honest note, and no legacy AI endpoint is touched. Chapter selection,
context review, handwritten final content and previously saved options all
work. The editable result area is always present so final content can be
written by hand. The context snapshot is rebuilt at every save with chapter
source versions, and a later chapter edit or summary drift surfaces a
conservative stale hint. Draft saves drain edits made while a commit was
pending; route departure and native close wait for the flush; a failed read
can never be overwritten by an empty workspace. Saving the workspace never
writes into chapter content.

### Verification record (2026-09-12, unit 5)

Frontend: 281 tests (+12), typecheck, zero-warning lint and production build
pass. Rust: 37 tests (+8) covering NULL-field round-trips, stale-importer and
version conflicts, invalid ranges, lock immunity for preferences and lock
enforcement plus book-delete cascade for the workspace, and IPC registration;
Clippy and `cargo fmt --check` clean. Secret scan clean. Real Windows desktop
CDP smoke: first launch imported localStorage preferences into version 1;
theme toggle persisted (version 2) with the launch cache updated; a real
restart restored settings without re-importing. The brainstorm workspace
opened from the outline with generation disabled, accepted a chapter
selection and handwritten final content, saved and recovered after restart;
the snapshot carried the chapter source version and a later chapter edit
surfaced the stale hint.

## Unit 6 implementation: bookshelf management and acceptance coverage

Bookshelf management is fully wired: the context menu works in local mode,
`local_update_book` renames and toggles lifecycle status in one
version-checked write (locks and stale versions refuse), and deleting a book
cascades volumes, chapters, characters, the graph, planning and the
brainstorm workspace in the existing transaction — the confirmation dialog
now names those attachments. New books receive one accent from the fixed
legacy palette (blue/emerald/rose/amber/purple 600), persisted in the
`cover_color` column added by migration 0003 (additive, backup-first like
0002). The editor's settings button is enabled again now that `/settings`
exists. `local_list_characters` reports NOT_FOUND for deleted books, matching
every other read. A real-desktop probe on an isolated data directory
verified: same-named characters stay distinct across books; book B reads
contain nothing of book A; wrong-book IDs are rejected for notes, brainstorm
selections, graph nodes and planning references; deleting book A removes
every attachment while book B stays intact. Legacy migration tooling is
deliberately skipped (the legacy project holds no real data).

### Verification record (2026-09-13, unit 6)

Frontend: 284 tests (+3), typecheck, zero-warning lint and production build
pass. Rust: 38 tests (+1), Clippy and `cargo fmt --check` clean. Secret scan
clean. Full user-acceptance walkthroughs (long manual flows) are performed
by the maintainer by decision; probe-level checks above ran on a throwaway
`STORYARK_DATA_DIR`, never the real database.

## Preparing whole-book JSON interchange (next stage, not started)

This list is a design inventory only — **JSON round-trip is NOT implemented
or verified in this stage**, and nothing below may be claimed as working.

Snapshot entity set (one document per book, `schemaVersion` stamped):
book record (title/author/status/cover color/position/lock), volumes with
positions, chapters with typed bodies (`format`/`version`/`content`,
`originalContent`/`originalFormat`, word count, foreshadowing notes with all
unknown fields preserved verbatim), characters (including archived ones and
their handle defaults), the relationship graph (graph version, node
instances keyed by `nodeKey` with per-node handle overrides, edges with
handles/labels), the planning aggregate (story summary/background, chapter
summaries with source versions, plot settings with chapter references and
missing-link annotations), and the brainstorm workspace (live selection,
historical context snapshot, generated options, selection, final content).
Application preferences are explicitly excluded; API keys never appear.

Reference checks on import: chapter→volume, everything→book, graph node
→character (same book), graph edge→node instances, chapter summary→chapter,
plot setting chapterIds, workspace selectedChapterIds, and foreshadowing
mark IDs↔chapter note IDs. Violations are reported, never silently dropped.

Asset boundary: avatar presets/colors are inline values and travel with the
document; machine-local file paths are never required and never written into
the snapshot. The style library stays outside (localStorage today).

ID rewriting when adding a copy: every entity ID (book/volume/chapter/
character/nodeKey/edge/note/plot entry) is re-allocated on import so the
copy can never collide with the original; every reference above is rewritten
through the same mapping in one transaction, and content strings that embed
IDs (mentions, foreshadowing marks) are rewritten with documented coverage
— unknown content formats keep their original text untouched.
