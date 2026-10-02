# Large books and working memory

## Editor reads

The editor requests `local_read_book_directory`. One read transaction returns the
book, ordered volumes and chapter metadata. Chapter bodies, migration originals
and foreshadowing notes are excluded. Empty `body.content` / `foreshadowings`
fields are compatibility shells, **not evidence of an empty chapter**.
`bodyMode: "directory"` projects to `Chapter.contentLoaded: false`.

Only the selected chapter is read through `local_read_chapter`, which checks book
ownership. Until it loads, the page shows a loading state instead of creating an
editable empty draft. Load failures expose a retry action. Full work export still
reads its authoritative snapshot in native storage.

Saved bodies use an LRU cache shared by the query client, across books:

- At most **8 chapters**, with an additional **16 MiB estimated string budget**.
- Body, migration-original and note string lengths count toward the budget.
- A single oversized chapter is usable in the editor but is not retained in the LRU.
- Chapter versions must match directory metadata before reuse.
- An older asynchronous read cannot replace a newer cached save.
- Inactive chapter queries have `gcTime: 0`; React Query is not a second body cache.

The active draft is owned by `useChapterDraft`, separately from this saved-body
cache. LRU eviction cannot discard it. Chapter switching, route navigation, export
and window close retain their existing flush/failed-save guards. Saves update the
directory with metadata only, while the active query and LRU receive the saved body.
Chapter reordering also requests metadata-only results.

Summary generation, brainstorm source validation and the Foreshadowing Board
currently use separate full-book queries because they depend on complete source
snapshots or notes. These queries have `gcTime: 0` and are released when their
workspace closes. They are not the editor's directory cache.

## Directory rendering

One virtual scroll surface contains volume, chapter, empty-volume and creation
rows. It renders the visible range with a small overscan. Scroll offsets use a
prefix layout and binary search; search navigation can reveal an unmounted row.
Rows being renamed or dragged remain mounted until that interaction finishes.
Directory projection and active-chapter lookup are linear to build, with indexed
lookup during editing. Metadata itself still scales with the chapter count.

## Retrieval

Search moves loaded chunks into its ID map instead of cloning all their strings.
Semantic recall scans stored vectors one at a time and keeps only the best `K`
scores in a bounded heap. Score descending and chunk ID ascending determine the
order, including ties; the minimum semantic score is unchanged. `K` is at most
200, and primary result count remains at most 50 (requests may choose less).
Adjacent context follows the existing separate assembly rules.

Index batch freshness checks copy only work identity, not every chunk in the
source. Embeddings are still committed atomically for a complete source.

## Limits and verification

These are working-set reductions, **not a global process RAM limit**. The shared
embedding model, active editor, WebView, directory metadata and analysis
workspaces have additional allocations. Retrieval still synchronizes sources and
loads eligible chunk text; it does not yet page all source/chunk reads. Indexing
still retains the current source's generated vectors until atomic commit.

Regression coverage includes 10,000 chapter entries, distant selection and rename
pinning, body request counts, LRU count/byte/version bounds, failed-save draft
protection, native ownership checks and bounded ranking equivalence to full sort
with 10,000 candidates and tied scores. Record process-memory measurements
separately; these tests do not establish a universal RSS ceiling.
