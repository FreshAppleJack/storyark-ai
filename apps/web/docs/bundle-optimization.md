# Route and export loading comparison

Measured on 2026-09-11 against commit `d1eebd3`, using the same installed
dependencies and `npm run build` before and after this change.
Sizes are decimal kB. Gzip figures use Vite's per-file build output, summed
without counting shared files twice.

| JavaScript scope | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Entry file only | 1,333.37 | 236.03 | 82.3% |
| Entry plus static shared dependencies | 1,333.37 | 394.96 | 70.4% |
| Login route including entry and shared dependencies | 1,333.37 | 427.10 | 68.0% |
| Login route including shared dependencies, gzip | 411.67 | 139.57 | 66.1% |

The entry-file reduction alone overstates the startup improvement. Static
imports in the emitted JavaScript were recursively inspected to obtain the
complete dependency sets. The initial shell uses the entry, Rolldown runtime,
Lucide helper, preload helper and SessionContext chunks. Login additionally
uses its own chunk plus Button and Input. None of these static import chains
includes the editor, relationship map or export conversion libraries.

The editor now has a 537.25 kB route chunk (168.57 kB gzip), and the relationship
map has a 246.55 kB route chunk (80.05 kB gzip). These sizes exclude shared
dependencies. Their CSS also loads with the respective routes.

The export entry itself is deferred until the user exports. Word conversion
and PDF conversion remain separate dynamic imports; PDF is 935.51 kB
(265.60 kB gzip). The editor and PDF still trigger Vite's 500 kB chunk warning.
No warning threshold was raised and no artificial vendor splitting was used.

## Navigation and verification

React Router loads route modules after navigation blockers permit leaving.
Existing authentication checks still wrap protected pages. During a pending
route load, the current page stays mounted but is inert, preventing edits after
the final save while the destination downloads. Loading is visually silent;
route failures offer reload and bookshelf recovery controls. Export snapshots,
duplicate-operation protection and conversion cleanup remain in place.

- Before editing: 17 existing navigation, save acceptance and export tests passed.
- After editing: 228 tests across 33 files passed, including two additional
  delayed/failed route loading regression tests.
- Production build and ESLint for all changed TypeScript files passed.
- Gitleaks self-test, workspace scan and 42-commit history scan passed.

This is a production artifact size comparison, not a browser timing benchmark.
It excludes API traffic, remote fonts, HTTP headers and cache effects. Routing
splits when code is downloaded; it does not remove the code needed by users
who later open every feature.
