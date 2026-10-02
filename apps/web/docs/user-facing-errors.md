# User-facing errors and local diagnostics

## Scope

This first copy pass removes source/index versions, hashes, recall algorithms,
draft revisions and export schema/index internals from the writing UI. It keeps
chapter names, material types, outdated-summary warnings, unsaved changes,
locks, replacement choices, backups and necessary AI configuration fields.
The underlying source checks, export format and persistence rules are unchanged.

Desktop errors retain their codes internally. The interface displays recovery
advice; original diagnostics are recorded separately. Unknown frontend errors
use a safe operation-specific fallback. Import validation paths and rules remain
in the logs, with grouped, readable messages in the dialog.

## Log location and retention

- Preferred: `storyark-errors.log` next to the running executable. In an installed
  app this is the installation directory; in development it is normally the
  debug executable directory, not the repository root.
- If that directory cannot be written, including a later write failure: the app
  data directory's `logs/storyark-errors.log`. Windows normally uses
  `%APPDATA%/io.github.freshapplejack.storyark/logs/`.
- If startup fails before the app-data path can be resolved, the final fallback
  is `%TEMP%/StoryArk/logs/`.
- Settings → Error log displays the selected path. It is selectable for copying.
- The current file rotates at 1 MiB. Two previous files are kept as `.log.1` and
  `.log.2`. Entries are JSON lines with Unix millisecond timestamps, app version,
  operation, error code and bounded diagnostics.
- Logs stay on this device. They are not uploaded or included in work exports.

## What is captured

Native storage and AI errors, original SQLite/filesystem errors, IPC failures,
route errors, unhandled browser exceptions/rejections, caught exceptions sent
to `console.error`, invalid brainstorm response rules and import validation
failures. Native errors include their source location; frontend exceptions include
their stack. Panics include location/stack, with the panic payload omitted.
Normal cancellation is not an error.

Command arguments, credentials, manuscript text, prompts, full AI responses and
arbitrary error objects must never be passed to the logger. Only diagnostic
metadata is accepted by callers. Credential-looking diagnostic lines are redacted
as a second safeguard, and each message is capped. Logging failure is best effort:
it cannot turn a failed save into success or break error handling.

## Development console

WebView console output does not automatically appear in the terminal running
Cargo/Vite. Previously, native failures were usually returned to the UI without
printing, and SQLite/filesystem conversions discarded their original details.
The new logger mirrors diagnostics to stderr in debug builds. This appears in
IntelliJ when the desktop process is launched from that terminal/run configuration.
An independently launched executable's stderr is not attached to IntelliJ.
Restart the desktop process after rebuilding Rust; frontend hot reload alone does
not add native logging commands to an already-running executable.

## Isolated verification

`STORYARK_DATA_DIR` redirects test data and the fallback log directory.
`STORYARK_LOG_DIR` optionally redirects the preferred log directory for probes.
Use a separate WebView profile and a CDP port that is not already in use. Tests
cover message/code separation, omitted request payloads, credential redaction,
logging failure, destination fallback, rotation and main-window-only IPC access.
