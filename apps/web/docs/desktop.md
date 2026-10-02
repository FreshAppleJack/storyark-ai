# Desktop development

StoryArk uses Tauri 2 with React, a hash router and local SQLite storage.
The desktop starts at the bookshelf without requiring an account or a separate
backend. AI generation uses the configured provider through native commands.

## Prerequisites

Use a Node.js version supported by `package.json`. The schema tools require
Node.js 24 with built-in SQLite. Install Git LFS and run `git lfs pull`
from the repository root to hydrate the bundled embedding model. Install Rust
and the native build prerequisites for the target platform. Windows builds
require the MSVC toolchain, Microsoft C++
build tools with a Windows SDK, and WebView2.

## Development

From `apps/web`:

```sh
npm ci
npm run desktop:dev
```

The Tauri CLI starts Vite at `http://127.0.0.1:1420`, builds the native shell
and opens the window. Keep that terminal running. The first Rust build downloads
dependencies and takes longer. The port must be available; do not start a second
Vite server on it. Rust changes require rebuilding the native process; frontend
hot reload cannot register new native commands or permissions.

`npm run dev` starts a browser preview. Local persistence requires Tauri; a browser
preview cannot replace desktop validation. Legacy HTTP modules remain in the source
tree for reference and are separate from the desktop's local provider stack.

## Builds and checks

```sh
npm run desktop:build
npm run tauri -- info
```

`desktop:build` runs the frontend build and `tauri build --no-bundle`. On Windows,
the executable is `src-tauri/target/release/storyark-desktop.exe`. Installer builds
use `npm run tauri -- build` and the platform configuration files. Packaging or
signing success must be checked on each target platform. The Windows and macOS
Tauri configurations include the embedding model resource directory. The model
is tracked through Git LFS and verified against pinned hashes at runtime; see
[MODEL-NOTICE.md](../src-tauri/resources/embedding/multilingual-e5-small/MODEL-NOTICE.md).
The `--no-bundle` executable alone is not an installer or a complete portable
distribution: packaging must include the required resources.

Follow [engineering.md](engineering.md) for frontend checks. From `src-tauri`, run
`cargo fmt --check` and `cargo test --locked`. Native compilation alone does not
verify WebView rendering. The main-window permissions are explicitly listed in
`capabilities/default.json`; custom commands also belong in `build.rs` and the
handler registry. Keep permissions scoped to the operations the application needs.

## Application icons

The source artwork is [`app-icon.png`](../app-icon.png), a square RGBA image with
transparent outer corners. Its flat book-and-star design uses layered pages and
a cover in muted teal, with an apricot star on a pale mint tile. The artwork was
generated with the built-in image generation tool for StoryArk.

From `apps/web`, regenerate both platform variants:

```sh
npm run icons:generate
```

The script uses the installed [Tauri icon command](https://v2.tauri.app/develop/icons/)
and does not require an additional image library. It crops the master's small
outer margin, clips border speckles to a smooth rounded contour, and adds an
opaque underlay to prevent internal transparency artifacts. It then exports:

| Platform | Prepared source | Visual framing | Runtime assets |
| --- | --- | --- | --- |
| Windows | `app-icon.windows.png` | Compact tile filling the 1024px canvas | `icons/icon.ico` and PNGs directly in `icons` |
| macOS | `app-icon.macos.png` | Centered 824px tile on a transparent 1024px canvas | `icons/icon.icns` and `icons/macos/*.png` |

The macOS tile occupies about 80.5% of the canvas width. This is StoryArk's
starting point for visual balance with nearby Dock icons, not a universal Apple
size requirement. The Windows variant gives the book more visual weight by
removing outer padding. Verify its fine page gaps at 16px, 24px and 32px.

The base Tauri configuration uses the Windows PNGs and ICO and the macOS ICNS.
`tauri.macos.conf.json`, loaded automatically for macOS builds, overrides the PNG
paths as well so the Mac window and app use the same framing. Keep the generated
platform sources and desktop assets in version control. Mobile outputs are discarded.
Avoid running `tauri icon app-icon.png` directly into `src-tauri/icons`: it would
overwrite the platform-specific sizing. Edit the master or the framing profiles
in `scripts/generate-app-icons.mjs`, then run `icons:generate` again.

Rebuild and restart the native application after replacing icons. Frontend hot
reload does not update the executable icon. Rebuild installers before distributing
the new artwork; Windows shortcuts may retain a cached icon until refreshed.

Compare the installed Windows app alongside other taskbar icons in light and
dark themes. On a Mac, rebuild the `.app`/DMG and compare its Dock icon with
Finder and Safari. This Windows development environment can validate PNG/ICO/
ICNS contents, but cannot establish the final appearance in a real macOS Dock.

## Local data and recovery

The stable app identifier is `io.github.freshapplejack.storyark`. SQLite lives in
the platform app-data directory, separate from the repository and installation:

```text
Windows: %APPDATA%/io.github.freshapplejack.storyark/storyark.sqlite3
Backups: <app-data>/backups/storyark-<time>-<uuid>.sqlite3
```

Use the SQLite online backup boundary rather than copying a live main database
without its WAL. Do not delete WAL/SHM files to repair storage. Stop all instances
before a controlled database restore. Whole-work import/export follows
[storyark-work-exchange.md](storyark-work-exchange.md).

`STORYARK_DATA_DIR` redirects storage for disposable tests. Use the platform
app-data directory for normal runs. Error log locations, retention and diagnostic
privacy are described in [user-facing-errors.md](user-facing-errors.md).

## Isolated desktop diagnostics

For Windows interaction tests, assign separate temporary directories to
`STORYARK_DATA_DIR` and `WEBVIEW2_USER_DATA_FOLDER`. Set
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9236` before launching
the debug executable, then inspect `http://127.0.0.1:9236/json/list` with a temporary
CDP client. Choose an unused port and keep real user data outside the test.

Access denied during startup can reflect launch permissions or the WebView profile;
check both before treating it as a port conflict. Stop only test-owned processes.
Connection tests use the same provider adapter and configured limits as generation
with a short synthetic prompt. Passing a local fixture does not establish live
provider compatibility. Never include keys, provider bodies or manuscript text in
diagnostic output.
