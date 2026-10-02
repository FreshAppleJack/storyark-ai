-- P1-D: metadata-only retrieval and generation traces.
-- Raw queries, prompts, network responses, and credentials are intentionally
-- excluded; source versions and stable hashes are enough to explain a run.
CREATE TABLE retrieval_search_events (
    event_id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(event_id)) BETWEEN 1 AND 128),
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    retrieval_version TEXT NOT NULL CHECK(length(trim(retrieval_version)) BETWEEN 1 AND 128),
    task TEXT NOT NULL CHECK(length(trim(task)) BETWEEN 1 AND 64),
    requested_mode TEXT NOT NULL,
    effective_mode TEXT NOT NULL,
    status TEXT NOT NULL,
    query_hash TEXT NOT NULL CHECK(length(trim(query_hash)) BETWEEN 1 AND 256),
    embedding_fingerprint TEXT,
    source_versions_json TEXT NOT NULL CHECK(json_valid(source_versions_json)),
    hit_ids_json TEXT NOT NULL CHECK(json_valid(hit_ids_json)),
    created_at INTEGER NOT NULL CHECK(created_at >= 0)
) STRICT;

CREATE INDEX retrieval_search_events_book_time_idx
    ON retrieval_search_events(book_id, created_at, event_id);

CREATE TABLE ai_generation_events (
    event_id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(event_id)) BETWEEN 1 AND 128),
    request_id TEXT NOT NULL UNIQUE CHECK(length(trim(request_id)) BETWEEN 1 AND 128),
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL CHECK(length(trim(session_id)) BETWEEN 1 AND 4096),
    prompt_version TEXT NOT NULL CHECK(length(trim(prompt_version)) BETWEEN 1 AND 128),
    retrieval_version TEXT,
    config_id TEXT NOT NULL CHECK(length(trim(config_id)) BETWEEN 1 AND 128),
    model_id TEXT NOT NULL CHECK(length(trim(model_id)) BETWEEN 1 AND 256),
    source_versions_json TEXT NOT NULL CHECK(json_valid(source_versions_json)),
    created_at INTEGER NOT NULL CHECK(created_at >= 0)
) STRICT;

CREATE INDEX ai_generation_events_book_time_idx
    ON ai_generation_events(book_id, created_at, event_id);
