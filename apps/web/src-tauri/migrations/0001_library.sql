-- The runner enables foreign_keys before BEGIN IMMEDIATE, checks user_version,
-- executes this migration, sets user_version = 1, and commits atomically.
-- UUID syntax and command-level validation belong to the Rust boundary.
CREATE TABLE books (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    author TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'serializing' CHECK (status IN ('serializing', 'completed')),
    position INTEGER NOT NULL CHECK (position >= 0),
    is_read_only INTEGER NOT NULL DEFAULT 0 CHECK (is_read_only IN (0, 1)),
    database_version INTEGER NOT NULL DEFAULT 1 CHECK (database_version >= 1),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;

CREATE TABLE volumes (
    id TEXT PRIMARY KEY NOT NULL,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    position INTEGER NOT NULL CHECK (position >= 0),
    is_read_only INTEGER NOT NULL DEFAULT 0 CHECK (is_read_only IN (0, 1)),
    database_version INTEGER NOT NULL DEFAULT 1 CHECK (database_version >= 1),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    UNIQUE (book_id, id)
) STRICT;

CREATE TABLE chapters (
    id TEXT PRIMARY KEY NOT NULL,
    book_id TEXT NOT NULL,
    volume_id TEXT NOT NULL,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    position INTEGER NOT NULL CHECK (position >= 0),
    content_format TEXT NOT NULL CHECK (content_format IN ('tiptap-json', 'legacy-json', 'legacy-html', 'unrecognized')),
    content_version INTEGER NOT NULL CHECK (
        (content_format = 'tiptap-json' AND content_version = 1) OR
        (content_format != 'tiptap-json' AND content_version = 0)
    ),
    content TEXT NOT NULL,
    -- Exact source retained before any legacy conversion. Never editor output.
    original_content TEXT,
    original_format TEXT CHECK (original_format IN ('legacy-json', 'legacy-html', 'unrecognized')),
    word_count INTEGER NOT NULL DEFAULT 0 CHECK (word_count >= 0),
    -- Keep complete notes, including unknown keys and historical non-UUID IDs.
    foreshadowings_json TEXT NOT NULL DEFAULT '[]' CHECK (
        CASE WHEN json_valid(foreshadowings_json) THEN json_type(foreshadowings_json) = 'array' ELSE 0 END
    ),
    is_read_only INTEGER NOT NULL DEFAULT 0 CHECK (is_read_only IN (0, 1)),
    database_version INTEGER NOT NULL DEFAULT 1 CHECK (database_version >= 1),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    FOREIGN KEY (book_id, volume_id) REFERENCES volumes(book_id, id) ON DELETE CASCADE,
    CHECK ((original_content IS NULL) = (original_format IS NULL)),
    CHECK (content_format = 'tiptap-json' OR original_content IS NOT NULL),
    CHECK (content_format != 'tiptap-json' OR CASE WHEN json_valid(content)
        THEN json_type(content) = 'object' AND json_extract(content, '$.type') IS 'doc'
        ELSE 0 END)
) STRICT;

-- Stable tie-breaking permits transactional reordering without temporary negatives.
CREATE INDEX books_order ON books(position, id);
CREATE INDEX volumes_order ON volumes(book_id, position, id);
CREATE INDEX chapters_order ON chapters(book_id, volume_id, position, id);
