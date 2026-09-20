-- P1-A: versioned, book-owned retrieval source registry.
-- Chunks and embeddings are derived later; source text and normalized index
-- text remain separate so display evidence is never replaced by index data.
CREATE TABLE retrieval_sources (
    source_id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(source_id)) BETWEEN 1 AND 8192),
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    entity_id TEXT NOT NULL CHECK(length(trim(entity_id)) BETWEEN 1 AND 4096),
    source_kind TEXT NOT NULL CHECK(source_kind IN (
        'manuscript', 'chapter_summary', 'planning', 'confirmed_setting',
        'character', 'relationship', 'foreshadowing_note', 'future_plan'
    )),
    source_status TEXT NOT NULL CHECK(source_status IN ('active', 'stale', 'pending', 'discarded')),
    source_version INTEGER NOT NULL CHECK(source_version > 0),
    origin TEXT NOT NULL CHECK(origin IN ('author', 'generated')),
    authoring_status TEXT NOT NULL CHECK(authoring_status IN ('author_confirmed', 'ai_suggestion', 'discarded')),
    visibility_scope_json TEXT NOT NULL CHECK(json_valid(visibility_scope_json)),
    source_text TEXT NOT NULL CHECK(length(source_text) <= 8388608),
    index_text TEXT NOT NULL CHECK(length(index_text) <= 8388608),
    updated_at INTEGER NOT NULL CHECK(updated_at >= 0),
    index_status TEXT NOT NULL CHECK(index_status IN ('not_configured', 'queued', 'indexing', 'ready', 'partial', 'stale', 'failed')),
    index_version INTEGER CHECK(index_version IS NULL OR index_version > 0),
    embedding_fingerprint TEXT CHECK(embedding_fingerprint IS NULL OR length(embedding_fingerprint) <= 4096),
    entity_metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(entity_metadata_json)),
    UNIQUE(book_id, source_kind, entity_id)
) STRICT;

CREATE INDEX retrieval_sources_book_kind ON retrieval_sources(book_id, source_kind, source_status);
CREATE INDEX retrieval_sources_book_status ON retrieval_sources(book_id, source_status, index_status);
