-- P1-B: immutable, versioned chunks and deterministic source locators.
-- Historical chunk rows remain available for evidence identity; consumers
-- select the current source version when they need fresh retrieval material.
CREATE TABLE retrieval_chunks (
    chunk_id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(chunk_id)) BETWEEN 1 AND 8192),
    source_id TEXT NOT NULL REFERENCES retrieval_sources(source_id) ON DELETE CASCADE,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    source_version INTEGER NOT NULL CHECK(source_version > 0),
    index_version INTEGER NOT NULL CHECK(index_version > 0),
    ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
    source_text TEXT NOT NULL CHECK(length(source_text) <= 8388608),
    index_text TEXT NOT NULL CHECK(length(index_text) <= 8388608),
    text_hash TEXT NOT NULL CHECK(length(trim(text_hash)) BETWEEN 1 AND 256),
    short_quote TEXT NOT NULL CHECK(length(short_quote) <= 4096),
    locator_json TEXT NOT NULL CHECK(json_valid(locator_json)),
    created_at INTEGER NOT NULL CHECK(created_at >= 0),
    UNIQUE(source_id, source_version, index_version, ordinal, text_hash)
) STRICT;

CREATE INDEX retrieval_chunks_book_version
    ON retrieval_chunks(book_id, source_id, source_version, index_version, ordinal);
CREATE INDEX retrieval_chunks_hash
    ON retrieval_chunks(book_id, text_hash);
