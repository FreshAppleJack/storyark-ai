# Contributing to StoryArk

Start with the [architecture guide](apps/web/docs/architecture.md) and
[desktop development instructions](apps/web/docs/desktop.md). Keep changes focused
and describe the behavior they change, the checks you ran, and any remaining limits.

## Reporting a problem

Include the application version, operating system, steps to reproduce, expected
behavior and actual behavior. Use a small invented story when providing examples.
For a failure, **Settings → Error log** shows the diagnostic file location.
Inspect logs and screenshots before sharing them; omit API keys, private stories,
personal paths and unrelated data. Do not publish credentials in an issue or PR.

## Development checks

Use Node.js 24 and hydrate the Git LFS model files before native testing. From
`apps/web`:

```sh
npm ci
npm run lint -- --max-warnings 0
npm test
npm run schema:check
npm run schema:test
node --test scripts/local-storage-schema.test.mjs
npm run build
```

From `apps/web/src-tauri`:

```sh
cargo fmt --check
cargo test --locked
```

Choose checks relevant to the change. A Markdown-only change needs link and
factual checks, rather than rerunning the application test suite. UI, IPC,
credential-store and packaging changes need appropriate desktop verification;
a passing browser fixture alone cannot establish native behavior. Use disposable
data via `STORYARK_DATA_DIR` and a separate WebView profile for interaction tests.
Never run migration or restore experiments against a personal works database.

The Windows repository secret scanner is `scripts/scan-secrets.ps1`. It expects
Gitleaks; pass `-GitleaksPath <path>` if it is installed elsewhere. Scan before
publishing and do not treat a missing tool or failed scan as a clean result.

## Change boundaries

- Keep book-scoped state isolated by book ID; reuse the existing query cache and
  save queues instead of introducing a second persistence owner.
- Preserve rich text, mentions, foreshadowing references, draft revisions and
  undo state. Generation must not silently replace authored content.
- Retain unsaved drafts after failed writes or version conflicts. Do not force a
  save by adopting a newer version without resolving the conflict.
- Treat generated candidates and retrieval indexes as distinct from saved work.
- Use English for code comments, maintenance documentation and current UI copy.
  Language-specific fixtures and authored content may use other languages.
- Update the relevant contract when changing a persisted field, command shape,
  provider request or exchange format.
- Keep secrets and private run reports out of the repository. Retain repeatable
  tests and non-sensitive fixtures needed by a clean checkout.

For schema changes, add a new registered migration; do not rewrite an existing
numbered migration. Regenerate and commit `schema_snapshot.sql` with the migration.
See the [migration guide](apps/web/src-tauri/migrations/README.md).

## Pull requests

Explain why the change is needed and how it was checked. Add regression tests for
concrete behavior risks; avoid tests that merely duplicate implementation details.
Include light/dark screenshots for visible layout changes using invented data.
State whether verification used fixtures, the actual WebView, a live provider or
a packaged application. Do not describe unperformed checks as passing.

## License

Contributions to StoryArk are provided under the project's [MIT License](LICENSE).
Preserve the original licenses and notices when adding third-party code or resources.
