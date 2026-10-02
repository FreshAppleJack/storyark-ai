# Maintenance documentation

For an overview and setup, start at the [repository README](../../../README.md).
The in-app **Settings → Help** guide is written for authors; these documents are
for contributors and maintainers. They describe current behavior and contracts,
not dated acceptance reports.

## Getting oriented

1. [Architecture and code map](architecture.md): runtime boundaries and code entry points.
2. [Desktop development and recovery](desktop.md): prerequisites, Git LFS, builds and local data.
3. [Engineering checks](engineering.md): verification and legacy browser settings.
4. [Contributing](../../../CONTRIBUTING.md): change boundaries and PR evidence.

## Contracts

| Document | Use it when changing |
| --- | --- |
| [Local storage](local-storage.md) | Records, rich text, locks, versions, transactions or draft saves. |
| [Local content](local-content.md) | Characters, graphs, foreshadowing, planning, preferences or saved brainstorms. |
| [AI contracts](ai-contracts.md) | Configuration, credentials, context, transport or candidate adoption. |
| [Indexing and freshness](retrieval-r0.md) | Index scheduling, committed sources or stale evidence. |
| [Generation retrieval context](retrieval-r1.md) | Evidence scope, budgets, generation inputs or exclusions. |
| [Work exchange](storyark-work-exchange.md) | Portable JSON, copy/replace, export writes or recovery. |
| [Errors and diagnostics](user-facing-errors.md) | Readable errors, private logs, redaction or retention. |

The `retrieval-r0.md` and `retrieval-r1.md` filenames remain stable for existing
links. Their contents document current indexing and generation behavior.
Command payloads must agree with the typed repositories and native DTOs; update
the contract and boundary tests together when behavior changes.

## Support and releases

- [Troubleshooting](troubleshooting.md)
- [Release checklist](releasing.md)
- [Third-party components and resources](../../../THIRD_PARTY_NOTICES.md)

Module ownership is documented in [data/README.md](../data/README.md) and
[features/README.md](../features/README.md). See the
[migration guide](../src-tauri/migrations/README.md) for schema reconstruction.
The [work export sample](samples/storyark-work-export-v1.json) and retrieval
fixtures stay in the repository: tests must run from a clean checkout without
access to a maintainer's private archive. Personal plans and dated run evidence
belong outside the source tree.
