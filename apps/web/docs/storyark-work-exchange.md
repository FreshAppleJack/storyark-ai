# StoryArk work exchange format

This document defines the version 1 whole-work JSON envelope. It is the
contract for the P0-A exchange stage, the P0-B local export flow and the P0-C
plus P0-D import flow. Import preflight, conflict handling and transactional
ID remapping consume this contract instead of serializing SQLite rows directly.

## Import preflight boundary

The Dashboard's **Import** action selects a `.storyark.json` file and runs the
file through `apps/web/data/export/importPreflight.ts` before the import IPC
command runs. Native selection checks the file size with `stat` before reading
the bytes. Browser fallback checks `File.size` before reading the file. Both
paths require strict UTF-8, then use the exchange validator for JSON depth,
object count, string and asset limits, allowed runtime state, Tiptap safety,
deterministic ordering, duplicate IDs and same-work references.

The report distinguishes validation errors from preservation warnings for
legacy or read-only chapter bodies and shows field paths such as
`chapters[2].body.content`. A successful preflight holds the validated value in
memory only and makes no SQLite change. The Rust preparation command then
reports target and imported versions, timestamps, content statistics, same-ID
conflicts and same-title conflicts. A failed preflight, file read failure or
user cancellation cannot create an empty book or partial related records.

## Conflict and recovery policy (P0-D)

When the imported `book.id` already exists, the dialog offers **Replace**,
**Create copy** and **Cancel**. Replace never merges records. It rechecks the
target book's `databaseVersion` inside the write boundary, creates a verified
SQLite online backup with a `quick_check` and foreign-key check, and only then
replaces the complete book cascade in one immediate transaction. A backup
failure, version conflict, lock, validation error or SQLite failure leaves the
target readable; SQLite rollback also removes any uncommitted rows.

Create copy allocates a new UUID for every book, volume, chapter, character,
graph node instance, graph edge, note, plot entry and brainstorm option. The
mapping rewrites chapter/character/book references, Tiptap Mention IDs,
foreshadowing marks, graph endpoints, planning links and saved brainstorm
references. `nodeKey` and `characterId` are mapped independently. The book
author text and body prose are preserved; only the display title receives a
deterministic `Book (1)`, `Book (2)` suffix when needed. Same-title books with
different IDs are therefore name conflicts, not replacement targets.

Version `1` has no imported asset table. Non-empty embedded assets are rejected
before the transaction with an explicit unsupported-asset error, so an asset
write cannot leave a partial work. Recovery is never automatic over a live
database: the verified backup is retained for a controlled restore after all
StoryArk instances have stopped, or for an explicitly controlled external
SQLite restore procedure.

## Version boundaries

The format keeps several independent versions:

| Field | Meaning | Not a replacement for |
| --- | --- | --- |
| `schemaVersion` | Whole-work exchange envelope version. Version `1` is supported. | SQLite migration version or a merge algorithm |
| `snapshot.databaseVersion` | SQLite `PRAGMA user_version` captured by the exporter. | A target device's only concurrency token |
| `snapshot.contentVersion` | Export representation version. Version `1` means the content contract in this document. | Installed Tiptap package version |
| Entity `databaseVersion` | Per-record or aggregate optimistic version copied from local storage. | Import identity, merge authority or a globally monotonic version |
| Chapter `body.version` | `1` for supported Tiptap JSON and `0` for legacy content. | `schemaVersion` |

An importer must allocate or reconcile its own local versions in a transaction.
It must not use an exported entity `databaseVersion` as the new device's sole
concurrency value.

## Top-level envelope

All fields below are required in version 1. `extensions` is the only optional
top-level field. Unknown JSON fields may be retained for forward compatibility,
but an implementation must never use them to bypass the required core fields or
cross-reference checks. Application state with a reserved meaning is rejected
when it appears as a top-level field.

| Field | Type and limit | Meaning |
| --- | --- | --- |
| `schemaVersion` | integer, exactly `1` | Exchange contract version |
| `exportId` | canonical lowercase UUID | Unique ID for this export run |
| `exportedAt` | ISO-8601 UTC timestamp | Time of export, not a record update time |
| `producer` | object | `appVersion` (1-64 chars), `platform` (`windows`, `macos`, `linux`, `unknown`) |
| `snapshot` | object | `databaseVersion` (safe integer >= 0), `contentVersion` exactly `1` |
| `book` | object | The one exported book |
| `volumes` | array | All volumes belonging to `book.id` |
| `chapters` | array | All chapters belonging to a listed volume and the book |
| `characters` | array | All characters belonging to the book, including archived characters |
| `graphs` | array | Zero or one relationship graph for the book in version 1 |
| `foreshadowings` | array | All chapter notes, including recovered/unknown fields |
| `planning` | object | The planning aggregate for the book, including empty planning |
| `brainstormWorkspaces` | array | Zero or one saved workspace for the book; session candidates are excluded |
| `assets` | array | Only embedded, supported assets |
| `extensions` | object, optional | Non-secret application or plugin data that is safe to preserve |

The current runtime validator is exported from
`apps/web/data/export/exchange/index.ts`. Types are intentionally accompanied
by runtime checks; TypeScript declarations alone are not an import boundary.

## Common object rules

All canonical entity IDs are lowercase RFC 4122 UUID strings. Export arrays are
deterministically ordered:

- `volumes`: `position`, then `id`.
- `chapters`: parent volume order, chapter `position`, then `id`.
- `characters`: `position`, then `id`.
- `graphs`: `bookId`; graph `nodes`: `nodeKey`; graph `edges`: `id`.
- `foreshadowings`: parent chapter order, then note `id`.
- `planning.chapterSummaries`: parent chapter order, then `chapterId`.
- `planning.plotSettings`: `createdAt`, then `id`.
- `brainstormWorkspaces`: `bookId`.

Duplicate IDs and unsorted arrays are validation errors. ID arrays such as a
chapter's `foreshadowingIds` and a plot's `chapterIds` are unique; the latter
retain their author-facing order. `position` is a non-negative safe integer up
to `1,000,000`. Timestamps are non-negative safe integers in Unix
milliseconds. `updatedAt` cannot precede `createdAt` when both are present.

Every object may carry an `extensions` object. Extension keys are JSON data,
not a way to add credentials: credential references, API keys, secrets,
passwords, authorization values and private keys are rejected there. Unknown
Tiptap marks and attributes are a separate preservation case described below.

## Entity contract

### `book`

Required fields:

```text
id, title, author, status, position, isReadOnly,
databaseVersion, createdAt, updatedAt
```

`title` is 1-4096 characters; `author` is 0-1024; `status` is `serializing` or
`completed`. `coverColor` is optional and is at most 64 characters.

### `volumes`

Each volume requires:

```text
id, bookId, title, status, position, isReadOnly,
databaseVersion, createdAt, updatedAt
```

`bookId` must equal `book.id`; `title` is 1-4096 characters; `status` is
`draft` or `published`.

### `chapters`

Each chapter requires:

```text
id, bookId, volumeId, title, status, position, isReadOnly,
wordCount, body, foreshadowingIds,
databaseVersion, createdAt, updatedAt
```

`bookId` and `volumeId` must resolve to the same exported book and volume.
`title` is 1-4096 characters and `wordCount` is a non-negative safe integer.
`foreshadowingIds` must enumerate exactly the notes whose `chapterId` is this
chapter. A mark that points at a note in another chapter is invalid.

### `characters`

Each character requires:

```text
id, bookId, name, aliases, role, description, color, tags,
avatar, handleConfig, isArchived, position,
databaseVersion, createdAt, updatedAt
```

`name` is 1-4096 characters; each alias is at most 256 characters and there
may be at most 256 aliases. `description` is at most 65,536 characters;
`color` is 1-64; each tag is at most 256 and there may be at most 256 tags;
`avatar` is text up to 1,024 characters or `null`. `role` is one of
`protagonist`, `antagonist`, `supporting`, or `mob`.

`handleConfig` is an object or `null`. Its optional keys are `top`, `right`,
`bottom`, and `left`; each value is `source`, `target`, `both`, or `none`.
Archived characters remain in the export so old Mention and graph references
do not disappear.

### `graphs`

Version 1 permits at most one graph. A graph requires:

```text
bookId, databaseVersion, createdAt, updatedAt, nodes, edges
```

Each node requires `nodeKey`, `characterId`, `positionX`, `positionY`, and
`handleConfig`. `nodeKey` identifies a graph node instance. `characterId`
identifies the character represented by that instance. Multiple nodes may have
the same `characterId`, and an importer must not merge them.

Each edge requires `id`, `sourceNodeKey`, `targetNodeKey`, `sourceHandle`,
`targetHandle`, and `label`. Edge endpoints are node instance IDs, never
character IDs. Both endpoint node keys must be present in the same graph and a
self-edge is rejected. Node/edge timestamps are optional because the current
read projection does not expose them; a future exporter should include them
when available.

Node coordinates must be finite and within `-1,000,000..1,000,000`. Graphs
are limited to 10,000 nodes and 50,000 edges. Labels and handle references are
limited to 4,096 characters.

### `foreshadowings`

Each note requires:

```text
id, chapterId, excerpt, note,
databaseVersion, createdAt, updatedAt
```

Note IDs are intentionally non-empty opaque strings up to 4,096 characters;
historical local data can contain non-UUID note IDs. `chapterId` must resolve to
an exported chapter. `excerpt` and `note` are each limited to 1,048,576
characters. `isRecovered` is optional and boolean. Unknown note fields are
preserved.

### `planning`

The planning object requires:

```text
bookId, databaseVersion, storySummary, storyBackground,
chapterSummaries, plotSettings
```

`bookId` must equal `book.id`. The two story text fields are each limited to
1,048,576 characters. A chapter summary requires `chapterId`, `summary`, and
`updatedAt`; `sourceChapterVersion` is optional but, when present, cannot be
newer than the exported chapter record. A plot setting requires `id`, `title`,
`details`, `chapterIds`, `createdAt`, and `updatedAt`; `missingChapterIds` is
optional. All planning chapter references must resolve to this book.

### `brainstormWorkspaces`

The saved aggregate requires:

```text
bookId, databaseVersion, createdAt, updatedAt,
selectedChapterIds, contextSnapshot, generatedOptions,
finalContent
```

`selectedOptionId` is optional and may be `null`; when present it must resolve
to a saved `generatedOptions[].id`. Options require `id`, `title`, `conflict`,
`motivation`, `consequences`, and `development`. Their limits are 4,000
characters for each detail field and 240 for the title. `contextSnapshot` is
bounded JSON, not a credential or a running task. `finalContent` is limited to
1,048,576 characters.

`generationMetadata` is optional. If present, it records only `configId`,
`modelId`, `generatedAt`, `promptVersion`, and source versions. It does not
contain a key, credential reference, HTTP body or session-only candidate.
Its source `bookId` and selected chapter IDs must resolve to the export; its
chapter versions cannot be newer than the exported chapter records.

## Chapter content and preservation

The `body` object is a tagged content value:

```text
Tiptap:  { format: "tiptap-json", version: 1, content, contentState }
Legacy:  { format: "legacy-*", version: 0, content,
           contentState, originalContent, originalFormat }
```

For `tiptap-json`, `content` is a JSON object whose root has `type: "doc"`.
The document is stored as JSON rather than as a JSON-encoded string. The
validator checks the known Tiptap tree shape, but it does not discard unknown
JSON fields. Mention nodes retain their complete `attrs`, including the
character association ID. A canonical UUID association is checked against the
exported characters; a historical opaque association is retained for the
future import ID map.

Known marks such as `bold`, `italic`, `underline`, `textStyle` and
`foreshadowing` remain in the document. A foreshadowing mark must have a note
ID and must resolve to a note in the same chapter. Notes are also exported as
full objects, including unknown keys.

Unknown nodes, marks or attributes are not converted to plain text. The body
must set `contentState` to `read-only` or `pending-migration` when such content
is present. `editable` means the current editor schema can safely edit the
document; it does not override the chapter's `isReadOnly` lock.

If the source is old HTML, old JSON, malformed JSON-like data or another
unsupported representation, the exporter must emit `legacy-html`,
`legacy-json` or `unrecognized`, with `version: 0`, the exact raw `content`,
the exact `originalContent`, and the matching `originalFormat`. A failed
conversion must never produce an empty `tiptap-json` body.

## Excluded state

The following are not part of a work export:

- application preferences and editor defaults;
- AI model settings, system credential-store state, API keys and credential references;
- temporary candidates, active requests, cancellation state and running tasks;
- absolute machine-local paths;
- derived search indexes, index tasks, vectors, embedding models and caches.

If the user later needs application preferences, that must use a different
versioned format and an explicit settings entry point. It must not be added to
this envelope under an ambiguous field.

## Restricted assets

Version 1 supports only self-contained assets. An asset requires:

```text
id, mimeType, size, sha256, bytes, encoding: "base64"
```

`bytes` is the actual embedded payload; `size` must equal its decoded byte
length; `sha256` is 64 lowercase hexadecimal characters. A single asset is at
most 16 MiB, the total is at most 64 MiB, and there may be at most 1,000
assets. `name` is optional and limited to 255 characters. Paths, `filePath`,
`absolutePath`, URLs and URI-only assets are invalid. The future exporter must
preflight unsupported attachments and either list/block them or ask for an
explicit author confirmation; it must not save a path that works only on the
old device.

## Validation and sample

Use `validateStoryArkWorkExport` for already parsed data,
`parseStoryArkWorkExport` for UTF-8 JSON text and
`serializeStoryArkWorkExport` before writing a file. Validation returns paths
such as `$.chapters[0].body.content` and cross-reference errors without
returning secrets or network payloads.

## P0-B runtime export

Local mode exposes `StoryArk work (.storyark.json)` in the existing editor
Export menu. The export operation has two boundaries:

1. Before reading, the frontend flushes the active chapter, characters,
   planning, relationship graph and brainstorm page drafts that are still
   mounted. Existing route guards flush drafts before those pages unmount; the
   editor also supplies a direct chapter fallback for the registration window.
   Flushes run in a stable order and any false result or thrown save error
   stops the operation while the draft remains visible.
2. `local_read_work_export_snapshot` reads the requested book through one
   SQLite read transaction. It loads the book, volumes, chapters, characters,
   graph node instances and edges, planning aggregate, and saved brainstorm
   workspace from that boundary. It rechecks ownership, chapter/body
   compatibility, note marks, mentions, graph endpoints and planning/
   brainstorm references before returning the snapshot. The frontend does not
   assemble the file from TanStack Query caches.

The frontend maps that result to this envelope, serializes and validates it,
then shows a preview with the book name, object counts, schema version,
generation time, supported asset count, exclusions and the rebuildable derived
index policy. Preferences, model configurations, credentials, keys, session
candidates, active requests, absolute paths and retrieval indexes are not
read by the snapshot command and cannot enter the output. Version 1 currently
has no embedded file assets; unsupported attachments or local-path assets are
reported as excluded and require a later explicit preflight policy.

After preview confirmation, desktop Save As supplies the destination. The
export is first written to a unique sibling temporary file. The file is read
back and checked for UTF-8 decoding, byte length, SHA-256 and envelope
validation before the temporary file is renamed over the selected destination.
Cancellation is a normal result and does not show success; failed writes keep
the preview available and never claim that a file was saved. The browser-only
fallback remains for non-desktop tests/previews and is not the persistence
authority.

The minimal preservation sample is kept in
`apps/web/docs/samples/storyark-work-export-v1.json`. It includes a Mention,
bold/italic text, a foreshadowing mark and note, aliases, duplicate graph node
instances for one character, planning references and a saved brainstorm
workspace.
