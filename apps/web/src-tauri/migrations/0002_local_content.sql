-- 0002: local work content (characters, relationship graph, planning,
-- application preferences, brainstorm workspace).
-- Applied after 0001 inside the versioned upgrade transaction. The released
-- 0001 file is never edited; upgrades are additive only. Composite foreign
-- keys keep every row inside its owning book at the schema level.

CREATE TABLE characters (
    id TEXT PRIMARY KEY NOT NULL,
    book_id TEXT NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    aliases_json TEXT NOT NULL DEFAULT '[]' CHECK (
        CASE WHEN json_valid(aliases_json) THEN json_type(aliases_json) = 'array' ELSE 0 END
    ),
    role TEXT NOT NULL DEFAULT 'supporting' CHECK (role IN ('protagonist', 'antagonist', 'supporting', 'mob')),
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    tags_json TEXT NOT NULL DEFAULT '[]' CHECK (
        CASE WHEN json_valid(tags_json) THEN json_type(tags_json) = 'array' ELSE 0 END
    ),
    -- Optional: built-in avatar presets or colors only. Machine-local paths
    -- are not a migration promise and are never required.
    avatar TEXT,
    -- The character-level default handle configuration. A graph node either
    -- overrides it (its own non-null value) or follows this one — never both.
    handle_config_json TEXT CHECK (handle_config_json IS NULL OR json_valid(handle_config_json)),
    -- Deletion is archival: mentions, text and graph references stay.
    is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
    position INTEGER NOT NULL CHECK (position >= 0),
    database_version INTEGER NOT NULL DEFAULT 1 CHECK (database_version >= 1),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    UNIQUE (book_id, id),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
) STRICT;

-- One graph per book; node/edge/layout integrity is guarded by the graph
-- version, not by per-row versions. The viewport is session UI state and is
-- deliberately not persisted.
CREATE TABLE graphs (
    book_id TEXT PRIMARY KEY NOT NULL,
    database_version INTEGER NOT NULL DEFAULT 1 CHECK (database_version >= 1),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
) STRICT;

-- node_key is the node INSTANCE id; character_id is the person. Multiple
-- nodes may reference the same character and must never be merged.
CREATE TABLE graph_nodes (
    node_key TEXT PRIMARY KEY NOT NULL,
    book_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    position_x REAL NOT NULL CHECK (position_x BETWEEN -1000000 AND 1000000),
    position_y REAL NOT NULL CHECK (position_y BETWEEN -1000000 AND 1000000),
    -- NULL means "follow the character default"; non-null is a node override.
    handle_config_json TEXT CHECK (handle_config_json IS NULL OR json_valid(handle_config_json)),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    UNIQUE (book_id, node_key),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    FOREIGN KEY (book_id, character_id) REFERENCES characters(book_id, id) ON DELETE CASCADE
) STRICT;

-- Edges reference node instances, and deleting a node cascades its edges.
CREATE TABLE graph_edges (
    id TEXT PRIMARY KEY NOT NULL,
    book_id TEXT NOT NULL,
    source_node_key TEXT NOT NULL,
    target_node_key TEXT NOT NULL,
    source_handle TEXT,
    target_handle TEXT,
    label TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    FOREIGN KEY (book_id, source_node_key) REFERENCES graph_nodes(book_id, node_key) ON DELETE CASCADE,
    FOREIGN KEY (book_id, target_node_key) REFERENCES graph_nodes(book_id, node_key) ON DELETE CASCADE
) STRICT;

-- One planning aggregate per book. Chapter summaries keep the source chapter
-- version inside the JSON so staleness can be shown; chapter references are
-- validated inside the write transaction.
CREATE TABLE planning (
    book_id TEXT PRIMARY KEY NOT NULL,
    story_summary TEXT NOT NULL DEFAULT '',
    story_background TEXT NOT NULL DEFAULT '',
    chapter_summaries_json TEXT NOT NULL DEFAULT '[]' CHECK (
        CASE WHEN json_valid(chapter_summaries_json) THEN json_type(chapter_summaries_json) = 'array' ELSE 0 END
    ),
    plot_settings_json TEXT NOT NULL DEFAULT '[]' CHECK (
        CASE WHEN json_valid(plot_settings_json) THEN json_type(plot_settings_json) = 'array' ELSE 0 END
    ),
    database_version INTEGER NOT NULL DEFAULT 1 CHECK (database_version >= 1),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
) STRICT;

-- Application-level preferences: exactly one row, independent of any work.
-- NULL means "not set" and lets the frontend fall back to its defaults.
CREATE TABLE application_preferences (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    dark_mode INTEGER CHECK (dark_mode IS NULL OR dark_mode IN (0, 1)),
    editor_margin_px INTEGER CHECK (editor_margin_px IS NULL OR editor_margin_px BETWEEN 24 AND 72),
    editor_line_height REAL CHECK (editor_line_height IS NULL OR editor_line_height BETWEEN 1.2 AND 1.8),
    ai_continue_context_chars INTEGER CHECK (ai_continue_context_chars IS NULL OR ai_continue_context_chars BETWEEN 500 AND 6000),
    ai_continue_output_chars INTEGER CHECK (ai_continue_output_chars IS NULL OR ai_continue_output_chars BETWEEN 120 AND 800),
    auto_highlight_json TEXT CHECK (auto_highlight_json IS NULL OR json_valid(auto_highlight_json)),
    database_version INTEGER NOT NULL DEFAULT 1 CHECK (database_version >= 1),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;

-- One brainstorm workspace per book. The context snapshot keeps its own
-- source versions inside the JSON so staleness can be reported; live chapter
-- selection is validated inside the write transaction.
CREATE TABLE brainstorm_workspaces (
    book_id TEXT PRIMARY KEY NOT NULL,
    selected_chapter_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (
        CASE WHEN json_valid(selected_chapter_ids_json) THEN json_type(selected_chapter_ids_json) = 'array' ELSE 0 END
    ),
    context_snapshot_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(context_snapshot_json)),
    generated_options_json TEXT NOT NULL DEFAULT '[]' CHECK (
        CASE WHEN json_valid(generated_options_json) THEN json_type(generated_options_json) = 'array' ELSE 0 END
    ),
    selected_option_id TEXT,
    final_content TEXT NOT NULL DEFAULT '',
    database_version INTEGER NOT NULL DEFAULT 1 CHECK (database_version >= 1),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX characters_book_order ON characters(book_id, position, id);
CREATE INDEX graph_nodes_book ON graph_nodes(book_id, node_key);
CREATE INDEX graph_edges_book ON graph_edges(book_id, id);
