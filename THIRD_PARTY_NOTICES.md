# Third-party components and resources

StoryArk uses third-party software and model resources. They retain their own
copyrights and licenses independently of the [MIT License](LICENSE) for StoryArk's source.
Keep upstream license and attribution texts when redistributing covered material.

This source-level inventory was checked against lockfiles and locally installed
package/crate metadata. It is not a complete license-text collection for a binary
release. Versions below are locked versions, not the latest upstream releases.
Review changes when updating dependencies.

## Frontend runtime dependencies

| Component | Locked version | Declared license |
| --- | --- | --- |
| `@dagrejs/dagre` | 3.1.1 | MIT |
| `@tanstack/react-query` | 5.102.8 | MIT |
| `@tauri-apps/api` | 2.11.1 | Apache-2.0 OR MIT |
| `@tauri-apps/plugin-dialog` | 2.7.3 | MIT OR Apache-2.0 |
| `@tauri-apps/plugin-fs` | 2.5.2 | MIT OR Apache-2.0 |
| Tiptap: core, extension-mention, extension-placeholder, extension-text-align, extension-text-style, extension-underline, pm, react, starter-kit | 3.30.1 | MIT |
| `@xyflow/react` | 12.11.3 | MIT |
| `axios` | 1.19.0 | MIT |
| `clsx` | 2.1.1 | MIT |
| `file-saver` | 2.0.5 | MIT |
| `html-docx-js-typescript` | 0.1.5 | MIT |
| `html2pdf.js` | 0.14.0 | MIT |
| `lucide-react` | 1.31.0 | ISC |
| `react`, `react-dom` | 19.2.8 | MIT |
| `react-hot-toast` | 2.6.0 | MIT |
| `react-router-dom` | 7.18.2 | MIT |
| `tailwind-merge` | 3.6.0 | MIT |
| `tippy.js` | 6.3.7 | MIT |

`apps/web/package-lock.json` records the full dependency resolution, including
transitive and development packages. License identifiers are not complete
notices; retain applicable upstream LICENSE/NOTICE texts too.

## Native runtime dependencies

| Component | Locked version | Declared license |
| --- | --- | --- |
| `tauri` | 2.11.5 | Apache-2.0 OR MIT |
| `tauri-plugin-dialog`, `tauri-plugin-fs` | 2.7.3, 2.5.2 | Apache-2.0 OR MIT |
| `rusqlite` | 0.32.1 | MIT |
| `serde`, `serde_json` | 1.0.229, 1.0.151 | MIT OR Apache-2.0 |
| `sha2` | 0.10.9 | MIT OR Apache-2.0 |
| `uuid` | 1.26.1 | Apache-2.0 OR MIT |
| `keyring` | 3.6.3 | MIT OR Apache-2.0 |
| `zeroize` | 1.9.0 | Apache-2.0 OR MIT |
| `reqwest` (direct dependency) | 0.12.28 | MIT OR Apache-2.0 |
| `futures-util` | 0.3.34 | MIT OR Apache-2.0 |
| `tokio` | 1.53.1 | MIT |
| `fastembed` | 6.1.0 | Apache-2.0 |
| `ort`, `ort-sys` (embedding dependencies) | 2.0.0-rc.13 | MIT OR Apache-2.0 |

`apps/web/src-tauri/Cargo.lock` is authoritative for the complete native graph.
Bundled SQLite and ONNX Runtime are separate upstream components; a Rust wrapper
license must not be treated as their binary notice. Build-time components include
`tauri-build` and native toolchain dependencies.

## Bundled embedding model

- Model: [`intfloat/multilingual-e5-small`](https://huggingface.co/intfloat/multilingual-e5-small).
- Upstream model license: MIT, with original text in
  [the resource LICENSE](apps/web/src-tauri/resources/embedding/multilingual-e5-small/LICENSE).
- Attribution, resource files and pinned hashes:
  [MODEL-NOTICE.md](apps/web/src-tauri/resources/embedding/multilingual-e5-small/MODEL-NOTICE.md).
- Weights are tracked through Git LFS and shipped as platform resources. Keep the
  upstream license and notice with redistributed model files.

## Preparing a distribution

Review the exact locked graph and shipped artifacts, including transitive
packages, native runtimes, fonts/icons and model resources. Collect their required
copyright, license and NOTICE texts with the distribution; do not replace them
with StoryArk's license. `OR` offers alternative licenses, not a requirement to
select both.

The resource directory includes the model license and notice. A complete binary
notice pack and installer inclusion must be checked for each release; this
inventory does not certify that step. Follow the
[release checklist](apps/web/docs/releasing.md).
