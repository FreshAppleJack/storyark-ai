# P1-R1: Shared retrieval context for generation

The continuation and brainstorm flows now use the same retrieval contract. A
page does not read retrieval tables or assemble database rows directly.

## Contract

`RetrievalRequest`, `RetrievalHit`, `RetrievalContext`, and `RetrievalTrace`
are defined in `domain/retrieval/contracts.ts` and mirrored by the Rust
contracts in `src-tauri/src/rag/contracts.rs`. The existing
`RetrievalSearch*` names remain aliases for the search UI during the migration.

Each returned context records:

- task, request/search time, book and optional chapter identity;
- the resolved scope and excluded hit IDs;
- source versions, index version, embedding fingerprint, and retrieval version;
- character/token budgets and assembled counts;
- material labels plus evidence text with hit, source, chunk, quote, freshness,
  and recall-method identity.

The evidence list contains only material that actually passed context budget
assembly. Omitted hit IDs remain available for diagnostics without being
silently inserted into a prompt.

## Generation boundary

`useLocalAiContinue` searches the shared base with the current in-memory draft
as its query and keeps the draft as an explicitly labelled context section.
Previous committed sources are scoped before the current chapter when the
chapter order is known. `useLocalBrainstormGeneration` searches using the
selected chapter, summary, character, and story context, while keeping its
selected chapters, relationships, and planning sections separate.

The retrieved context is passed to `ai_prepare_context` and its trace is passed
to `ai_start_generation`. Rust validates that the retrieval context belongs to
the request book and that the trace still matches the prepared snapshot. The
prompt contains a labelled retrieved-evidence section; it does not claim that
retrieval proved a fact.

If local retrieval is unavailable, the flows keep their already captured
explicit context. They do not call another model to manufacture a summary.
Lexical fallback is requested explicitly and its degraded status is retained on
the candidate.

## Candidate exclusion

The candidate panel displays the evidence actually used. Unchecking an item
marks its hit ID as excluded for the next explicit regeneration. The current
candidate is not rewritten retroactively. Discarding resets exclusions; a
regeneration keeps them and sends them in the next `RetrievalRequest`.

Candidate identity still comes from the existing session, draft revision,
chapter/workspace versions, insertion anchor, and read-only checks. Retrieval
context is transient candidate data and is not written into the saved manuscript
or brainstorm workspace by this change.

