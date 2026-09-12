# Desktop shell

StoryArk uses Tauri 2 to display the existing React application. The frontend
directories and hash router are shared with the web development build.

During localization, follow the fixed [frontend preservation baseline](frontend-baseline.md).
Backend changes must not introduce unsolicited layout or interaction redesigns.

```text
apps/web/
  src/, pages/, features/     Existing React UI
  vite.config.ts             Shared Vite configuration
  src-tauri/
    Cargo.toml, Cargo.lock   Rust dependencies and resolved versions
    build.rs                 Tauri build integration
    tauri.conf.json          Window, frontend hooks, app identity
    capabilities/default.json  No native IPC permissions in this stage
    src/main.rs              Desktop executable entry
    src/lib.rs               Tauri application builder
    icons/                   Generated Tauri placeholder icons
```

## Prerequisites

On Windows, install Rust with the MSVC host toolchain, Microsoft C++ build
tools with a Windows SDK, and WebView2. Node must satisfy package.json.
Restart your terminal after installing Rust so `cargo` is on PATH. Rust
1.98.1 with `stable-x86_64-pc-windows-msvc` was detected during integration.

## Run the desktop window

From `apps/web` in PowerShell:

```powershell
npm.cmd install
npm.cmd run desktop:dev
```

The Tauri CLI starts `dev:desktop` itself, then compiles and opens the native
window. Do not start that Vite server separately. The first compilation
downloads Rust dependencies and takes longer than subsequent runs. Keep
this terminal running; Ctrl+C stops the development session.

Desktop development uses `http://127.0.0.1:1420`, matching `devUrl` in
`src-tauri/tauri.conf.json`. The script overrides the web host/port settings
and fails if the port is occupied. Web development still uses `npm.cmd run
dev` and the existing `STORYARK_WEB_*` settings. Vite ignores Cargo output,
while Tauri watches Rust changes. This initial configuration targets desktop;
physical mobile devices need a separately validated dev-host configuration.

## Build an executable

```powershell
npm.cmd run desktop:build
```

This runs the existing frontend build (including typecheck), embeds `dist`,
and creates `src-tauri/target/release/storyark-desktop.exe` on Windows.
It skips installer bundling and signing. The executable does not need Vite
to serve its frontend. Installer distribution, final icons, signing, and
other operating systems are separate follow-up work.

`npm.cmd run tauri -- info` reports the local Tauri environment. Native
build output and generated schemas are ignored; Cargo.lock is tracked.
No Tauri JavaScript API package is needed until the UI calls native commands.

## Scope and existing backend

The desktop now initializes local SQLite and exposes create/read/save/backup
commands, documented in [local-storage.md](local-storage.md). The current login
page and authentication routes are preserved. Books and AI in the UI still use
the existing HTTP services; an anonymous bookshelf and native save-on-close
handling have not been implemented. Native storage is tested independently.

In development, Vite's existing `/api` proxy still applies. In an embedded
production build there is no Vite proxy: `/api` is not the Spring backend.
Displaying the login screen therefore does not prove that packaged login or
server writes work. Testing the legacy backend from the executable requires
an explicit build-time API base URL and matching backend CORS/authentication;
this stage does not change that contract or launch Java automatically.

The generated CSP remains unset for compatibility with the existing UI,
including its remote Google Fonts stylesheet. Only the seven local storage
commands are granted to the local main window; no arbitrary SQL, filesystem or
remote-origin permissions are exposed. Define the final asset/network policy
before connecting the local UI and model providers. Remote fonts use system
fallbacks when unavailable; full offline asset packaging is a later task.

The app identifier is `io.github.freshapplejack.storyark`. Treat it as stable
before introducing persisted data, since it affects platform app identity.

## Local data location

The SQLite database lives in the platform app-data directory, never in the
repository, the install directory, or a cloud-synced folder:

```text
Windows: %APPDATA%\io.github.freshapplejack.storyark\storyark.sqlite3
         %APPDATA%\io.github.freshapplejack.storyark\backups\storyark-<time>-<uuid>.sqlite3
```

Consistency backups are created through the SQLite online backup API
(`local_backup`); never copy the live main file as a backup. Deleting the
app-data directory resets the local library entirely — there is no account
recovery because there is no account.

Setting the `STORYARK_DATA_DIR` environment variable before
`npm.cmd run desktop:dev` redirects the database directory. Use it only for
controlled smoke tests against disposable data; production runs must rely on
the platform app-data directory.

## Verification

Use the existing frontend tests, lint, and build. Run `cargo fmt --check`
from `src-tauri`, and compile through the desktop command. Verify the real
window renders and a route transition works; a successful Rust compilation
alone does not prove WebView rendering. Do not enter real credentials just
to validate this shell.

Integration check on 2026-09-11: all 234 frontend tests (35 files), lint with
zero warnings, frontend production build, Cargo formatting, and the existing
secret scan passed. Both `desktop:dev` and the Windows release executable
built and visibly rendered the existing login page in WebView2. Authentication,
editor persistence, and other platforms were not validated in this shell step.
The existing large frontend chunk warning remains. Rust also reported MSVC's
import-library creation message as a linker warning; both builds completed.
