# SQLite migrations and schema snapshot

These SQL files describe one database, not separate databases.

- `0001_library.sql`, `0002_local_content.sql`, `0003_book_cover.sql`, `0004_ai_model_configs.sql`, `0005_ai_credentials.sql`, `0006_content_state.sql`, `0007_retrieval_sources.sql`, `0008_retrieval_chunks.sql`, `0009_retrieval_indexing.sql`, `0010_retrieval_audit.sql`, `0011_retrieval_search_task.sql`, and `0012_retrieval_scheduler.sql` are
  immutable incremental migrations registered in `src/storage/database.rs`.
  The application applies missing versions automatically and backs up an
  existing versioned database before upgrading it.
- `schema_snapshot.sql` is a generated, standalone schema for a NEW EMPTY
  database. It is not an incremental migration. Currently
its `PRAGMA user_version` is 12, matching the application. Do not register it
  as a migration and do not run every SQL file in this directory as a batch.
  Future upgrades need their own incremental migration; this snapshot continues
  to be regenerated from the registered migrations.

The snapshot includes tables, indexes, foreign keys, CHECK constraints and
defaults (and views/triggers if future migrations define them), but no rows.
It is generated from a temporary in-memory database, never from personal data.
SQLite internal indexes are recreated by table constraints rather than exported.
WAL, busy timeout and other connection settings remain the application's job.

## Cross-platform commands

Use Node.js 24 LTS on Windows and macOS. These `.mjs` commands use built-in
`node:sqlite`; Node 20 is not supported by this developer tool. No PowerShell
or external SQLite executable is required. Run from `apps/web`:

```sh
npm run schema:sync
npm run schema:check
npm run schema:test
```

`schema:sync` regenerates the tracked SQL snapshot from the Rust migration
registry. Commit both the incremental migration and regenerated snapshot when
the schema changes. `schema:check` fails if they differ, without modifying files.
The script rejects an unrecognized/nonsequential registry rather than guessing.

Optionally create a separate empty database for inspection in an IDE:

```sh
npm run schema:sync -- --create ./tmp/schema-preview/storyark.sqlite3
```

The parent directory is created if needed. Any existing destination file is
refused, including an empty one. This command never alters an existing works
database, copies data, or synchronizes data across devices. To create a database
manually, run ONLY the complete snapshot against an empty SQLite database; do
not run it after the incremental scripts.

## Developing on another computer

Pull the same Git revision, install Node/Rust/platform build prerequisites,
then run `npm ci` and `npm run desktop:dev` from `apps/web`. The application
creates its own database automatically on first launch; manual schema import
is unnecessary. `schema:check` verifies the shared schema snapshot. Existing
application databases upgrade through the normal versioned migration path;
the synchronization tool intentionally does not rewrite them.

For a disposable development database, set `STORYARK_DATA_DIR` to a separate
directory in the process environment before launching. Do not point schema
preview tools at your works database. Schema synchronization does not transfer
stories between Windows and macOS.
