# Desktop shell

StoryArk uses Tauri 2 to display the existing React application. The frontend
directories and hash router are shared with the web development build.

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

This is a window/container integration, not local persistence. The current
login page and authentication routes are preserved. Books and AI still use
the existing HTTP services; SQLite, an anonymous bookshelf, and native
save-on-close handling have not been implemented.

In development, Vite's existing `/api` proxy still applies. In an embedded
production build there is no Vite proxy: `/api` is not the Spring backend.
Displaying the login screen therefore does not prove that packaged login or
server writes work. Testing the legacy backend from the executable requires
an explicit build-time API base URL and matching backend CORS/authentication;
this stage does not change that contract or launch Java automatically.

The generated CSP remains unset for compatibility with the existing UI,
including its remote Google Fonts stylesheet. No native commands, plugins,
or IPC permissions are exposed. Define the asset/network policy when native
data access and model connections are introduced. Remote fonts use system
fallbacks when unavailable; full offline asset packaging is a later task.

The app identifier is `io.github.freshapplejack.storyark`. Treat it as stable
before introducing persisted data, since it affects platform app identity.

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
