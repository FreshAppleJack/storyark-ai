# Local work content contract

Characters, relationships, foreshadowing, planning, application preferences and
brainstorm workspaces persist in the same local SQLite database. This document
covers their fields, references and write boundaries; [local-storage.md](local-storage.md)
covers library storage and [ai-contracts.md](ai-contracts.md) covers generation.

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
updatedAt, provenance?, sourceChapterVersion?, sourceSnapshot?,
generationMetadata?, freshnessAcknowledgement?}`), and plotSettings persist as
Rust-validated JSON inside one per-book row with its own `databaseVersion`.
Legacy summaries without a
provenance field are treated as author-written. A source snapshot stores the
chapter ID/title, content format/version, chapter database-version snapshot,
FNV-1a change fingerprints, block fingerprints, Mention character IDs, and
foreshadowing note fingerprints; it does not duplicate the chapter body.
`freshnessAcknowledgement` stores a new source baseline accepted by the author
after reviewing a possible change. It does not replace the original
`sourceSnapshot` or AI generation provenance; later source changes are compared
with the acknowledged baseline and can make the summary stale again. When a
work is copied, its acknowledgement snapshot references are remapped with the
rest of the book's IDs.
Generation metadata is retained only for an adopted AI summary. Unaccepted
suggestions remain candidate state and are not written to the planning row.
Chapter references and metadata shapes are validated in the write transaction.
Story Outline provides card actions for generating a suggestion, reviewing old
versus new text, accepting, or keeping the manual summary. The suggestion is transient
until acceptance; acceptance uses the ordinary optimistic planning save. The
selected chapter body is the only source for events. Retrieved confirmed
settings and character profiles may clarify terminology but cannot supply
events. Relationships and foreshadowing notes are excluded from summary
retrieval because they may carry implications beyond the selected chapter.
Without a configured model or retrieval source, manual read/edit/save remains
available and the missing source is stated explicitly.

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
selectedOptionId, finalContent, plus `databaseVersion`/timestamps. Generated
options arrive through the configured-model Tauri IPC as a session-only
candidate; only a chosen option and its normal workspace save become durable.

The 0002 migration does not create vector indexes, AI task tables or
legacy-ID mapping tables. The versioned whole-work JSON schema and local export
flow are implemented separately. Import ID mappings are transient transaction
state; they are not a database table and are never reused across imports.

## IPC contract

Business commands only — no arbitrary SQL or path access. All mutations take
expected versions and return the committed record(s) inside the existing
`{ ok, value/error }` envelope with distinct codes (NOT_FOUND,
OWNERSHIP_MISMATCH, VERSION_CONFLICT, READ_ONLY, INVALID_INPUT,
CONTENT_INCOMPATIBLE, STORAGE_FAILURE).

| Command | Shape | Semantics |
| --- | --- | --- |
| local_list_characters | `{ bookId }` → `LocalCharacter[]` | Active + archived, ordered. |
| local_create_character | `{ input: { bookId, expectedBookVersion, name, role, aliases, description, color, tags, avatar?, handleConfig? } }` → `{ character, book }` | Rust assigns UUID/position; book must be unlocked. |
| local_update_character | `{ input: { bookId, characterId, expectedDatabaseVersion, ...fields } }` → character | Version-guarded partial update; never touches chapter content. |
| local_archive_character | `{ input: { bookId, characterId, expectedDatabaseVersion, isArchived } }` → character | Archive/unarchive; references preserved. |
| local_reorder_characters | `{ input: { bookId, expectedBookVersion, items: [{ characterId, expectedDatabaseVersion }] } }` → ordered characters | Complete set including archived characters; validate ownership, book lock and all versions, then commit positions atomically. Only character versions advance. |
| local_read_graph | `{ bookId }` → `{ graph, nodes, edges } \| null` | `null` means "not initialized yet" — never an empty-graph lie. Load failure is an error, not null. |
| local_initialize_graph | `{ input: { bookId } }` → `{ graph, nodes: [], edges: [] }` | Explicit first-time creation, persisted; seeding from characters is a separate explicit call, not an automatic side effect of opening the page. |
| local_save_graph | `{ input: { bookId, expectedGraphVersion, nodes, edges } }` → `{ graph, nodes, edges }` | Whole-snapshot write in one transaction: endpoint ownership, dangling edges, coordinate/handle validation; stale version rejected. |
| local_read_planning / local_save_planning | `{ bookId }` → planning / `{ input: { bookId, expectedDatabaseVersion, sessionKey, revision, ...aggregate } }` → `{ planning, sessionKey, revision }` | Per-book aggregate; chapterIds validated in-transaction. |
| local_read_book | `{ bookId }` → full chapter snapshots | Board aggregates notes from this consistent SQLite read; ordered by volume/chapter position. |
| local_update_note | `{ input: { bookId, chapterId, noteId, expectedDatabaseVersion, note?, isRecovered? } }` → committed chapter | Patch only the target note in a transaction; preserve body and unknown fields. |
| local_read_preferences / local_save_preferences | none / `{ input: { expectedDatabaseVersion, ...fields } }` | Single-row application preferences, optimistic version. |
| local_read_brainstorm / local_save_brainstorm | `{ bookId }` → workspace / `{ input: { bookId, expectedDatabaseVersion, sessionKey, revision, ...workspace } }` → `{ workspace, sessionKey, revision }` | Workspace aggregate; selected chapter IDs validated in-transaction. |

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

Schema versions follow the registered numbered migrations. Upgrades are additive
and applied
in one immediate transaction per version step (`0001` is frozen). Before any
upgrade from an existing versioned database, a consistent online backup is
written into `<app-data>/backups`; a failed backup stops the upgrade and the
old database keeps its version and rows. A failed migration rolls the
transaction back — the database is never dropped or rebuilt to recover.

Version spaces stay separate: SQLite `user_version` (schema), record
`databaseVersion` (optimistic concurrency), chapter `contentVersion`
(format), and interchange `schemaVersion` (exchange).

## Characters and mention compatibility

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
untouched. Mentions
reference the stable character ID; renaming never rewrites chapter text, and
the reconcile pass updates only label/color drift. Archived characters keep
their mentions and graph references, disappear from `@` suggestions and new
auto-matches, and show an "Archived" badge in the list.

The character settings page has its own route and loads the book
detail plus characters through the local queries; the editor's world-
building button and mention clicks navigate there through the existing
flush-protected navigation. Avatars stay audit-compliant with the contract:
no upload UI exists, the built-in color swatches are the only visual
identity, and stored avatar paths/URLs are never auto-fetched. Character ordering uses the version-checked local reorder boundary.

## Relationship graph persistence

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

The canvas page has its own route, loads book detail, characters and the
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

## Foreshadowing and planning

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
intent; chapter summaries describe existing chapters. Explicitly editing a
summary captures its source snapshot and provenance. Freshness compares
structured block fingerprints, Mention identities, foreshadowing-note content,
and recorded allowed-source versions; it never uses net character count or a
fixed percentage threshold. A database-version advance alone does not rebase a
summary. Legacy summaries without a verifiable snapshot require author review;
editing one establishes a new baseline. A possible-staleness hint never
rewrites or deletes the summary. FNV fingerprints are change detectors, not
cryptographic integrity checks. On import/copy, `sourceChapterVersion` is
rebased to the receiving database while `sourceSnapshot.chapterDatabaseVersion`
and generation-time versions remain historical provenance; remapped entity IDs
may therefore require review. No model is called in this step.
Planning drafts drain newer edits after pending saves; route departure and
normal native close wait for successful commits. Load failures, storage errors
and version conflicts cannot replace drafts with empty defaults.

Chapter/volume deletion uses the existing confirmation, with explicit summary
and reference consequences. The same transaction removes chapter summaries
and live plot links, retaining plot text and adding `missingChapterIds` for
inline missing-link feedback. Existing brainstorm live selections are cleaned;
opaque historical snapshots survive with `deletedChapterIds` annotations.
Changed planning/workspace versions advance atomically with deletion. A failed
step rolls back all of these changes. Whole-work import/export uses the
[exchange contract](storyark-work-exchange.md). Database restoration is a
controlled backup operation after all running instances have stopped.

## Application preferences and the brainstorm workspace

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
Preferences are unaffected by book locks. The settings page is available at
`/settings` without login/register/account sections.

The brainstorm workspace keeps persistence separate from AI generation.
`local_read_brainstorm` returns the empty aggregate with
version 0 only when the row genuinely does not exist; `local_save_brainstorm`
takes the whole workspace with sessionKey/revision acknowledgement and
validates live selected chapter IDs against the book in-transaction.
Generation uses the configured native AI provider and temporary candidates;
adoption and workspace saving remain separate actions. Chapter selection,
context review, handwritten final content and previously saved options all
work. The editable result area is always present so final content can be
written by hand. The context snapshot is rebuilt at every save with chapter
source versions, and a later chapter edit or summary drift surfaces a
conservative stale hint. Draft saves drain edits made while a commit was
pending; route departure and native close wait for the flush; a failed read
can never be overwritten by an empty workspace. Saving the workspace never
writes into chapter content.

## Bookshelf management

Bookshelf actions use the local context menu;
`local_update_book` renames and toggles lifecycle status in one
version-checked write (locks and stale versions refuse), and deleting a book
cascades volumes, chapters, characters, the graph, planning and the
brainstorm workspace in the existing transaction — the confirmation dialog
names those attachments. New books receive one accent from the fixed
legacy palette (blue/emerald/rose/amber/purple 600), persisted in the
`cover_color` column added by migration 0003 (additive, backup-first like
0002). `local_list_characters` reports NOT_FOUND for deleted books, matching
every other read.

## Whole-book JSON interchange

The authoritative envelope, entity/reference rules, exclusions, copy ID
remapping, replacement backups and export write sequence are documented in
[storyark-work-exchange.md](storyark-work-exchange.md).

Import/export includes saved book content and the brainstorm workspace, but not
application preferences, API credentials, temporary candidates or retrieval
indexes. Export flushes mounted drafts before reading a consistent SQLite
snapshot. The JSON sample stays in this repository because automated exchange
tests import it. Restoration of a database backup requires all instances to stop.
