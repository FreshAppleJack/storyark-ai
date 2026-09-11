# Frontend engineering checks

Run commands from `apps/web`:

```sh
npm ci
npm run typecheck
npm run lint -- --max-warnings 0
npm test
npm run build
```

`build` includes `typecheck`, so a local production build cannot silently bypass
TypeScript. CI uses lint, tests and build without running typecheck twice.
The lockfile is tracked so `npm ci` can reproduce the dependency resolution.
CI uses Node 24 on GitHub-hosted Ubuntu and needs no database or provider keys.
The workflow follows the official [checkout](https://github.com/actions/checkout)
and [setup-node](https://github.com/actions/setup-node) usage, with read-only
repository permissions and no persisted checkout credentials.

## Type and lint policy

`strict: true` covers application code and Vite/Vitest configuration. The
standalone check follows `tsconfig.json` project references. Test files run
through Vitest and ESLint; they are not a separate TypeScript build project.
`skipLibCheck` skips dependency declaration internals, not our calls into those
dependencies. `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are
separate future evaluations, not prerequisites for the local-first work.

HTTP bodies default to `unknown`, with named DTO contracts or validation at the
data boundary. Authentication identity, numeric write IDs, AI continuation
results and chapter notes have explicit checks. Malformed chapter notes fail
loading instead of silently becoming an empty list that could later be saved.
Legacy notes without timestamps use zero; graph handles normalize field by
field. DTOs do not claim complete runtime schema validation of every endpoint.

Prefer inferred callback types or the library's Editor, Node, Mark and
JSONContent types over `any`. Explicit `any` is not a release gate: three local
exceptions remain in partial Tiptap suggestion test fixtures, with inline
reasons. The lint rule remains enabled elsewhere. Two editor effects also have
local, explained exceptions because they restore external localStorage focus
and selection requests after chapter data arrives. Existing provider/hook
Fast Refresh exceptions remain scoped to their files.

`React.FC<Props>` is valid and does not by itself make a component unsafe.
Existing usages can remain. New or substantially edited components can use
plain functions with explicit props; avoid unrelated style-only conversions.

## Environment configuration

Copy `apps/web/.env.example` to `apps/web/.env.local` and restart Vite after
changes. The repository-root example is not Vite's environment directory.

| Setting | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `/api` | Public browser API base path or HTTP(S) URL |
| `VITE_API_TIMEOUT_MS` | `10000` | Ordinary request timeout |
| `VITE_AI_TIMEOUT_MS` | `60000` | Continuation and brainstorm timeout |
| `STORYARK_WEB_HOST` | `0.0.0.0` | Development bind address |
| `STORYARK_WEB_PORT` | `3000` | Development port; fail if occupied |
| `STORYARK_API_PROXY_TARGET` | `http://localhost:8080` | Development backend target |

Vite forwards `/api` requests to the configured backend during development,
preserving the browser-facing Host. For production, serve `/api` behind a
same-origin reverse proxy or set `VITE_API_BASE_URL` before building and
configure the backend's credentialed CORS policy for that frontend origin.
The dev proxy is not a production deployment configuration.

`VITE_*` settings are embedded in the browser bundle at build time. Never put
AI keys or other secrets in them. HTTP errors, including 401, reject back to
the caller without forcing navigation and discarding a draft. The editor shows
save failure and keeps its retry path; a full reauthentication flow is separate.

Run `scripts/scan-secrets.ps1` from the repository root before committing. This
local check scans the workspace and Git history; the frontend CI above covers
typechecking, lint, behavior tests and bundling.
