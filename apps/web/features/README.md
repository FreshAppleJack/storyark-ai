# Feature boundaries

`pages/` owns routing, navigation and page composition. Book-scoped workspaces are
keyed by book ID so local drafts and pending-operation state cannot leak into
another book.

| Feature | Ownership |
| --- | --- |
| `characters` | Character form drafts and actions; list search and drag interactions stay with the list. |
| `planning` | One planning draft shared by summaries, overview and plot panels; panel searches remain local. |
| `relationships` | One node/edge draft and graph editing lifecycle under ReactFlowProvider; graph conversion and port rules live in graphModel. |
| `brainstorm` | Chapter selection, generated options and editable result; context construction is separate from transport and rendering. |
| `books` | Bookshelf actions and inline rename drafts; the page keeps its search and navigation. |
| `foreshadowing` | Card derivation and recovery/retry state; writes still use BooksContext's shared chapter queue. |
| `settings` | Profile form state and preference controls; persistence stays in the existing providers. |

Desktop data remains owned by LocalBooksProvider and its shared Query cache.
Session and preferences remain in their focused providers. Feature hooks do not
create new book caches, chapter queues or IPC clients. Brainstorm transport and
wire conversion live in `data/`, separate from temporary candidate state.

Pure rules belong in `domain/` when they are shared across features. Feature-only
selectors and form/graph models stay beside their consumers. Character list and
graph palette reuse character search scoring, but keep their different actions.

Save indicators confirm only the submitted draft revision. Pending operations
must not overwrite subsequent typing or update an unmounted workspace. The
local repositories acknowledge committed versions. Native validation and
transactions enforce storage concurrency; feature hooks preserve drafts when
those writes fail or conflict.
