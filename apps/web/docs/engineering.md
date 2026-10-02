# Engineering checks and configuration

## Frontend checks

Use Node.js 24 and run commands from `apps/web`:

```sh
npm ci
npm run lint -- --max-warnings 0
npm test
npm run schema:check
npm run schema:test
node --test scripts/local-storage-schema.test.mjs
npm run build
```

`build` includes `npm run typecheck`, so a production build cannot silently bypass
TypeScript. Run `npm run typecheck` separately for a quicker feedback cycle. The
tracked lockfile makes `npm ci` reproducible. Schema tools use Node's built-in
SQLite and temporary databases, never a personal database.

## Native and desktop checks

From `apps/web/src-tauri`, run `cargo fmt --check` and `cargo test --locked`.
Hydrate Git LFS resources before native/resource tests. See
[desktop.md](desktop.md) for actual WebView checks with disposable data.

| CI workflow | Environment | Checks |
| --- | --- | --- |
| `.github/workflows/frontend.yml` | Ubuntu, Node 24 | Lint, Vitest, local SQLite schema contract and production build/typecheck. |
| `.github/workflows/desktop.yml` | Windows, Rust stable, Git LFS checkout | Rust formatting and locked native tests. |

Provider keys and a server database are not required for those fixture-based
checks. CI does not establish live-provider support, installer behavior, signing
or rendering on every platform. Run schema snapshot checks locally when changing
migrations; follow the [migration guide](../src-tauri/migrations/README.md).

## Type and lint policy

`strict: true` covers application code and Vite/Vitest configuration. The
standalone check follows `tsconfig.json` project references. Test files run
through Vitest and ESLint; they are not a separate TypeScript build project.
`skipLibCheck` skips dependency declaration internals, not our calls into them.

Validate untrusted payloads at data boundaries. Native writes must follow strict
record/content validation; a permissive legacy read is not permission to write
unvalidated data. Malformed notes must fail loading rather than become an empty
list that could overwrite the original. HTTP adapters remain legacy code and do
not replace the native desktop boundary.

Prefer inferred callbacks and the library's Editor, Node, Mark and JSONContent
types over `any`. Keep any necessary lint/hook/Fast Refresh exceptions local and
explain their reason inline. Avoid recording counts of exceptions here because
they drift as files change. Preserve editor identity when synchronizing external
character data or restoring focus/selection.

`React.FC<Props>` is valid. New or substantially edited components can use plain
functions with explicit props; avoid unrelated style-only conversions.

## Desktop configuration

`npm run desktop:dev` starts Vite at `127.0.0.1:1420` through the Tauri
configuration. Desktop storage, AI and retrieval use native commands, not `/api`.
Configure generation providers in Settings. New provider configurations default
to a 300,000 ms timeout; existing saved configurations keep their limit.
OpenAI-compatible protocols may omit the output cap; Anthropic Messages requires
one. These provider settings are separate from the legacy environment below.

Data/log overrides are intended for isolated diagnostics; see
[desktop.md](desktop.md) and [user-facing-errors.md](user-facing-errors.md).

## Legacy HTTP/browser environment

The retained HTTP adapters and browser preview use the following settings; they
do not control native desktop AI requests. Copy `apps/web/.env.example` to
`apps/web/.env.local` only when working on that path, and restart Vite after
changes. The repository-root example is not Vite's environment directory.

| Setting | Default | Legacy purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `/api` | Browser API base path or HTTP(S) URL. |
| `VITE_API_TIMEOUT_MS` | `10000` | Ordinary HTTP request timeout. |
| `VITE_AI_TIMEOUT_MS` | `60000` | Legacy HTTP continuation/brainstorm timeout; not native generation. |
| `STORYARK_WEB_HOST` | `0.0.0.0` | Browser-preview development bind address. |
| `STORYARK_WEB_PORT` | `3000` | Browser-preview development port; fail if occupied. |
| `STORYARK_API_PROXY_TARGET` | `http://localhost:8080` | Legacy development backend target. |

Vite forwards `/api` to that backend in browser development. Its dev proxy is
not a production deployment configuration. A separate HTTP deployment needs a
same-origin reverse proxy or an explicit API base/CORS configuration; desktop
users do not need to deploy that backend.

`VITE_*` settings are public build-time values: never place API keys in them.
Retained HTTP errors reject to the caller rather than forcing navigation and
discarding a draft. Native save/error handling remains separate.

## Before publication

Run `scripts/scan-secrets.ps1` from the repository root, supplying `-GitleaksPath`
if necessary. It scans the workspace and Git history. Resolve findings and report
failed/unavailable checks honestly. Documentation-only changes need link and
factual validation; do not imply the full application was retested.
