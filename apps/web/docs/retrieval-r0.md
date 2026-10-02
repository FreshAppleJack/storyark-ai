# Retrieval freshness and automatic local indexing

## Contract

`RetrievalSearchRequest.freshnessPolicy` accepts `freshOnly`,
`allowLexicalFallback`, and `maxWaitMs` (0 by default, at most 2000).
The wait budget covers existing index readiness after query embedding, not a
deadline on model inference or SQLite access. Searches never enqueue indexing.
Continuation, brainstorm, and consistency requests always exclude stale source
snapshots. A strict fresh scope falls back when any nonempty visible source lacks
the current index version and model fingerprint. Disabling fallback returns no
context evidence until semantic retrieval is ready. Current saved lexical text
can be used with explicit degradation even when its vector is stale.

Background indexing reads committed SQLite sources only. This restriction does
not remove the existing continuation context captured from the in-memory draft:
that context must retain its own session, revision and anchor, and must never be
labelled as a saved indexed source. See [retrieval-r1.md](retrieval-r1.md)
for shared generation context.

## Scheduling

- SQLite migration 12 adds an application-level preference (off by default), a
  durable dirty-source outbox, and automatic/manual job ownership. None is part
  of the portable work format. Existing databases are backed up before migration.
- Changed sources enter the outbox in the save transaction. Failed saves roll
  back the outbox too. The first change time survives subsequent saves; the last
  change time implements a 60-second debounce with a 5-minute maximum delay.
- Rust checks the durable outbox every two seconds. It processes only due source
  IDs and already registered chunks, without synchronizing/rebuilding a book.
- One global index dispatcher prefers the focused book at source boundaries.
  Embedding runs in batches of eight chunks; queued queries receive an opportunity
  between batches. An in-progress native inference call is not preempted. This
  limits concurrency, not CPU percentage or memory usage.
- Disabling automatic indexing pauses its queued/running jobs and rejects late
  commits. Manual build/retry remains available. Failed and cancelled jobs are
  not repeatedly retried automatically. Enabling resumes only jobs paused by
  the automatic preference. An explicit user pause remains a user pause.
- Startup restores interrupted jobs to queued. The coordinator resumes them
  only when automatic indexing is enabled and the local model is available.
  Missing/failed model status is cached; the coordinator does not redownload or
  repeatedly initialize a failed model. Restart after fixing model resources.
- Version checks occur before each batch and transactionally at commit. Changes
  during inference cannot replace a newer source. Already computed vectors are
  committed together per source, never as a partially ready source.
- Settings and the semantic sidebar expose the preference, pending count,
  last completed task timestamp and last task failure. The timestamp is not a
  promise that every source is fresh; existing scoped index status remains the
  authority. Status polling no longer re-chunks books with registered sources.
