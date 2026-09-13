import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSchema, createEmptyDatabase, snapshotPath } from './sync-schema.mjs';

test('snapshot reconstructs all migrated objects and version without rows', () => {
    const { sql, objects, version } = buildSchema();
    assert.equal(readFileSync(snapshotPath, 'utf8').replace(/\r\n/g, '\n'), sql);
    const db = new DatabaseSync(':memory:');
    try {
        db.exec(sql);
        const rebuilt = db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END, rowid").all();
        assert.deepEqual(rebuilt, objects);
        assert.equal(db.prepare('PRAGMA user_version').get().user_version, version);
        for (const object of objects.filter(item => item.type === 'table')) {
            assert.equal(db.prepare(`SELECT count(*) AS count FROM "${object.name.replaceAll('"', '""')}"`).get().count, 0);
        }
        assert.equal(db.prepare('PRAGMA table_info(books)').all().some(column => column.name === 'cover_color'), true);
        assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { db.close(); }
});

test('new database creation refuses existing files and cleans failed creations', () => {
    const directory = mkdtempSync(join(tmpdir(), 'storyark-schema-test-'));
    try {
        const path = join(directory, 'empty.sqlite3');
        createEmptyDatabase(path, buildSchema().sql);
        const original = readFileSync(path);
        assert.throws(() => createEmptyDatabase(path, buildSchema().sql), /EEXIST/);
        assert.deepEqual(readFileSync(path), original);
        const broken = join(directory, 'broken.sqlite3');
        assert.throws(() => createEmptyDatabase(broken, 'BEGIN; CREATE TABLE x(id); invalid sql;'));
        assert.throws(() => readFileSync(broken), /ENOENT/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
