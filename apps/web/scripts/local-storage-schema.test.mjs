import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const migration = readFileSync(new URL('../src-tauri/migrations/0001_library.sql', import.meta.url), 'utf8');
const doc = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'mention', attrs: { id: 'old-character', label: 'Alice', color: '#123456', unknown: 'keep' }, marks: [{ type: 'foreshadowing', attrs: { id: 'old-note' } }] },
] }] });
const notes = JSON.stringify([{ id: 'old-note', excerpt: 'Alice', note: 'Return later', createdAt: 1, updatedAt: 2, extra: { keep: true } }]);

function fixture(t) {
    const db = new DatabaseSync(':memory:');
    t.after(() => db.close());
    db.exec('PRAGMA foreign_keys = ON; BEGIN IMMEDIATE');
    db.exec(migration);
    db.exec('PRAGMA user_version = 1; COMMIT');
    // Short IDs intentionally show that UUID validation belongs to Rust.
    db.exec("INSERT INTO books(id,title,position,created_at,updated_at) VALUES ('b','Book',0,1,1), ('other','Other',1,1,1)");
    db.exec("INSERT INTO volumes(id,book_id,title,position,created_at,updated_at) VALUES ('v','b','Volume',0,1,1)");
    db.prepare(`INSERT INTO chapters(id,book_id,volume_id,title,position,content_format,content_version,content,foreshadowings_json,created_at,updated_at)
        VALUES ('c','b','v','Chapter',0,'tiptap-json',1,?,?,1,1)`).run(doc, notes);
    return db;
}

test('migration preserves rich content and complete notes without a user account', t => {
    const db = fixture(t);
    const row = db.prepare('SELECT * FROM chapters').get();
    assert.equal(row.content, doc);
    assert.equal(row.foreshadowings_json, notes);
    assert.equal(row.database_version, 1);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
});

test('composite ownership and cascade deletion protect the hierarchy', t => {
    const db = fixture(t);
    assert.throws(() => db.exec("UPDATE chapters SET book_id = 'other' WHERE id = 'c'"), /FOREIGN KEY/);
    db.exec("DELETE FROM books WHERE id = 'b'");
    assert.equal(db.prepare('SELECT count(*) AS n FROM chapters').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM volumes').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM books').get().n, 1);
});

test('invalid content, notes and record values cannot replace stored data', t => {
    const db = fixture(t);
    for (const content of ['', '{broken', 'null', '[]', '{}', '{"type":"text"}']) {
        assert.throws(() => db.prepare('UPDATE chapters SET content = ?').run(content));
    }
    for (const expression of ["word_count = -1", "is_read_only = 2", "database_version = 0", "position = -1", "status = 'unknown'", "foreshadowings_json = '{}'", "foreshadowings_json = 'broken'"]) {
        assert.throws(() => db.exec(`UPDATE chapters SET ${expression}`));
    }
    assert.equal(db.prepare('SELECT content FROM chapters').get().content, doc);
});

test('legacy source is required and survives conversion to JSON', t => {
    const db = fixture(t);
    const raw = '<p><span data-unknown="keep">Old text</span></p>';
    assert.throws(() => db.exec("UPDATE chapters SET content_format='legacy-html',content_version=0"));
    db.prepare("UPDATE chapters SET content_format='legacy-html',content_version=0,content=?,original_content=?,original_format='legacy-html'").run(raw, raw);
    db.prepare("UPDATE chapters SET content_format='tiptap-json',content_version=1,content=?").run(doc);
    assert.equal(db.prepare('SELECT original_content FROM chapters').get().original_content, raw);
});

test('compare-and-swap and rollback preserve the last complete snapshot', t => {
    const db = fixture(t);
    const save = db.prepare('UPDATE chapters SET title=?,database_version=database_version+1 WHERE id=? AND database_version=?');
    assert.equal(save.run('New', 'c', 1).changes, 1);
    assert.equal(save.run('Stale', 'c', 1).changes, 0);
    db.exec('BEGIN IMMEDIATE');
    save.run('Partial', 'c', 2);
    assert.throws(() => db.exec("UPDATE chapters SET foreshadowings_json='invalid'"));
    db.exec('ROLLBACK');
    const row = db.prepare('SELECT * FROM chapters').get();
    assert.equal(row.title, 'New');
    assert.equal(row.database_version, 2);
    assert.equal(row.foreshadowings_json, notes);
});

test('failed migration rolls back both tables and schema version', t => {
    const db = new DatabaseSync(':memory:');
    t.after(() => db.close());
    db.exec('BEGIN IMMEDIATE');
    db.exec(migration);
    db.exec('PRAGMA user_version = 1');
    assert.throws(() => db.exec('INSERT INTO missing_table VALUES (1)'));
    db.exec('ROLLBACK');
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get().n, 0);
});

// --- 0002 local content schema ------------------------------------------------

const migration0002 = readFileSync(new URL('../src-tauri/migrations/0002_local_content.sql', import.meta.url), 'utf8');

function fixtureV2(t) {
    const db = new DatabaseSync(':memory:');
    t.after(() => db.close());
    db.exec('PRAGMA foreign_keys = ON; BEGIN IMMEDIATE');
    db.exec(migration);
    db.exec('PRAGMA user_version = 1');
    db.exec(migration0002);
    db.exec('PRAGMA user_version = 2; COMMIT');
    db.exec("INSERT INTO books(id,title,position,created_at,updated_at) VALUES ('b','Book',0,1,1), ('other','Other',1,1,1)");
    db.exec("INSERT INTO characters(id,book_id,name,position,created_at,updated_at) VALUES ('char','b','Hero',0,1,1), ('villain','other','Villain',0,1,1)");
    return db;
}

test('0002 character rows enforce role, JSON fields and non-empty names', t => {
    const db = fixtureV2(t);
    assert.throws(() => db.exec("INSERT INTO characters(id,book_id,name,position,created_at,updated_at) VALUES ('x','b','  ',1,1,1)"));
    assert.throws(() => db.exec("UPDATE characters SET role = 'narrator' WHERE id = 'char'"));
    assert.throws(() => db.exec("UPDATE characters SET aliases_json = '{}' WHERE id = 'char'"));
    assert.throws(() => db.exec("UPDATE characters SET tags_json = 'broken' WHERE id = 'char'"));
    assert.throws(() => db.exec("UPDATE characters SET handle_config_json = 'broken' WHERE id = 'char'"));
    db.exec("UPDATE characters SET aliases_json = '[\"H\"]', tags_json = '[\"lead\"]', is_archived = 1 WHERE id = 'char'");
    assert.equal(db.prepare('SELECT is_archived FROM characters WHERE id = ?').get('char').is_archived, 1);
});

test('graph nodes and edges stay inside one book and cascade correctly', t => {
    const db = fixtureV2(t);
    db.exec("INSERT INTO graphs(book_id,created_at,updated_at) VALUES ('b',1,1)");
    // A node cannot reference a character from another book (composite FK).
    assert.throws(() => db.exec("INSERT INTO graph_nodes(node_key,book_id,character_id,position_x,position_y,created_at,updated_at) VALUES ('n1','b','villain',0,0,1,1)"), /FOREIGN KEY/);
    // Out-of-range coordinates are rejected.
    assert.throws(() => db.exec("INSERT INTO graph_nodes(node_key,book_id,character_id,position_x,position_y,created_at,updated_at) VALUES ('n1','b','char',2000000,0,1,1)"));
    db.exec("INSERT INTO graph_nodes(node_key,book_id,character_id,position_x,position_y,created_at,updated_at) VALUES ('n1','b','char',10,20,1,1), ('n2','b','char',30,40,1,1)");
    // The same character may back multiple node instances.
    assert.equal(db.prepare('SELECT count(*) AS n FROM graph_nodes WHERE character_id = ?').get('char').n, 2);
    // An edge endpoint must be a node of the same book.
    assert.throws(() => db.exec("INSERT INTO graph_edges(id,book_id,source_node_key,target_node_key,created_at,updated_at) VALUES ('e','b','n1','missing',1,1)"), /FOREIGN KEY/);
    db.exec("INSERT INTO graph_edges(id,book_id,source_node_key,target_node_key,source_handle,target_handle,label,created_at,updated_at) VALUES ('e','b','n1','n2','right-source','left-target','rivals',1,1)");
    // Deleting a node removes its edges; deleting the book removes everything.
    db.exec("DELETE FROM graph_nodes WHERE node_key = 'n1'");
    assert.equal(db.prepare('SELECT count(*) AS n FROM graph_edges').get().n, 0);
    db.exec("INSERT INTO planning(book_id,created_at,updated_at) VALUES ('b',1,1)");
    db.exec("INSERT INTO brainstorm_workspaces(book_id,created_at,updated_at) VALUES ('b',1,1)");
    db.exec("DELETE FROM books WHERE id = 'b'");
    // Only book b's rows cascade; the other book's character stays.
    for (const table of ['characters', 'graphs', 'graph_nodes', 'planning', 'brainstorm_workspaces']) {
        assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE book_id = 'b'`).get().n, 0, table);
    }
    assert.equal(db.prepare("SELECT count(*) AS n FROM characters WHERE book_id = 'other'").get().n, 1);
});

test('planning, workspace and preferences validate JSON and singleton shape', t => {
    const db = fixtureV2(t);
    db.exec("INSERT INTO planning(book_id,created_at,updated_at) VALUES ('b',1,1)");
    assert.throws(() => db.exec("UPDATE planning SET chapter_summaries_json = '{}' WHERE book_id = 'b'"));
    assert.throws(() => db.exec("UPDATE planning SET plot_settings_json = 'broken' WHERE book_id = 'b'"));
    db.exec("INSERT INTO brainstorm_workspaces(book_id,created_at,updated_at) VALUES ('b',1,1)");
    assert.throws(() => db.exec("UPDATE brainstorm_workspaces SET selected_chapter_ids_json = '{}' WHERE book_id = 'b'"));
    assert.throws(() => db.exec("UPDATE brainstorm_workspaces SET context_snapshot_json = 'broken' WHERE book_id = 'b'"));
    assert.throws(() => db.exec("INSERT INTO application_preferences(id,dark_mode,created_at,updated_at) VALUES (2,1,1,1)"));
    assert.throws(() => db.exec("INSERT INTO application_preferences(id,editor_margin_px,created_at,updated_at) VALUES (1,500,1,1)"));
    db.exec("INSERT INTO application_preferences(id,dark_mode,editor_margin_px,editor_line_height,created_at,updated_at) VALUES (1,1,48,1.5,1,1)");
    assert.equal(db.prepare('SELECT count(*) AS n FROM application_preferences').get().n, 1);
});
