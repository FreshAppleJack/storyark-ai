ALTER TABLE retrieval_chunks ADD COLUMN embedding_blob BLOB;

CREATE VIRTUAL TABLE retrieval_chunks_fts USING fts5(
    chunk_id UNINDEXED,
    book_id UNINDEXED,
    source_id UNINDEXED,
    source_version UNINDEXED,
    index_version UNINDEXED,
    search_text,
    tokenize = 'unicode61'
);

CREATE TABLE retrieval_index_jobs (
    job_id TEXT PRIMARY KEY NOT NULL,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES retrieval_sources(source_id) ON DELETE CASCADE,
    source_version INTEGER NOT NULL CHECK (source_version > 0),
    index_version INTEGER NOT NULL CHECK (index_version > 0),
    embedding_fingerprint TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('queued','indexing','paused','cancelled','completed','failed')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(source_id, source_version, index_version, embedding_fingerprint)
) STRICT;

CREATE INDEX retrieval_index_jobs_book_state_idx
    ON retrieval_index_jobs(book_id, state, updated_at, job_id);

CREATE INDEX retrieval_index_jobs_source_idx
    ON retrieval_index_jobs(source_id, source_version, index_version);
