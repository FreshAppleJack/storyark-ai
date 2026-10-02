CREATE TABLE retrieval_preferences (
    id INTEGER PRIMARY KEY CHECK(id=1),
    auto_index INTEGER NOT NULL DEFAULT 0 CHECK(auto_index IN (0,1)),
    database_version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO retrieval_preferences(id) VALUES(1);
CREATE TABLE retrieval_dirty_sources (
    source_id TEXT PRIMARY KEY REFERENCES retrieval_sources(source_id) ON DELETE CASCADE,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    source_version INTEGER NOT NULL,
    first_changed INTEGER NOT NULL,
    last_changed INTEGER NOT NULL
);
CREATE INDEX retrieval_dirty_book ON retrieval_dirty_sources(book_id);
INSERT INTO retrieval_dirty_sources
    SELECT source_id,book_id,source_version,updated_at,updated_at FROM retrieval_sources
    WHERE source_status='active' AND index_status<>'ready' AND trim(source_text)<>'';
ALTER TABLE retrieval_index_jobs ADD COLUMN automatic INTEGER NOT NULL DEFAULT 0 CHECK(automatic IN (0,1));
