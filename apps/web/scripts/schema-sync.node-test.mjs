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

test('AI schema rejects invalid limits and dangling defaults without storing credentials', () => {
    const db = new DatabaseSync(':memory:');
    try {
        db.exec(buildSchema().sql);
        const columns = db.prepare('PRAGMA table_info(ai_model_configs)').all().map(row => row.name);
        assert.equal(columns.includes('credential_ref'), true);
        assert.equal(columns.some(name => /api_key|secret|password/.test(name)), false);
        assert.throws(() => db.exec("INSERT INTO ai_generation_settings VALUES (1, 'missing', 1, 0)"));
        const insert = db.prepare(`INSERT INTO ai_model_configs
            (id,name,protocol,base_url,model_id,timeout_ms,max_output_tokens,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?)`);
        const id = '00000000-0000-4000-8000-000000000001';
        assert.throws(() => insert.run(id,'Example','embedding','https://example.com','model',30000,1000,0,0));
        assert.throws(() => insert.run(id,'Example','openai-responses','https://example.com','model',0,1000,0,0));
        insert.run(id,'Example','openai-responses','https://example.com','model',30000,1000,0,0);
        db.prepare('INSERT INTO ai_generation_settings VALUES (1, ?, 1, 0)').run(id);
        assert.throws(() => db.prepare('DELETE FROM ai_model_configs WHERE id=?').run(id));
        db.exec('BEGIN; UPDATE ai_generation_settings SET default_config_id=NULL,database_version=2; DELETE FROM ai_model_configs; COMMIT;');
        assert.equal(db.prepare('SELECT database_version FROM ai_generation_settings').get().database_version, 2);
    } finally { db.close(); }
});
