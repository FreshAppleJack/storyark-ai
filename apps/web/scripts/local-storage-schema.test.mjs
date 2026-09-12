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
