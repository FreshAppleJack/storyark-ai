# Troubleshooting

For feature usage, open **Settings → Help**. This page covers recovery and
development problems. Protect unsaved work and make a backup before experimenting
with stored data.

## AI does not connect, times out or returns incomplete content

1. In Settings, check the protocol, base URL, model ID and credential, then test
   the saved configuration. A provider may support Chat Completions but not
   Responses; choose the protocol it actually implements.
2. New configurations use a five-minute timeout. An existing configuration keeps
   its saved limit; change it if needed. Input capacity and maximum output vary
   by model. OpenAI-compatible output caps may be omitted; Anthropic Messages
   requires an explicit cap.
3. Check the network, provider availability, balance and rate limits. Re-enter a
   session-only key after restarting the application.
4. Review the error log for a repeated failure. Generation does not automatically
   retry with a different model or overwrite the original draft.

Increasing the timeout or output cap cannot add capabilities that the model or
provider does not support. The AI Continue character target in Writing Preferences
is separate from a provider's token cap.

## Semantic search is unavailable or misses a passage

Title/Chapter search does not require embeddings. Semantic search needs the local
model resources and a usable index. Use **Refresh search** after saved content
changes or when the interface requests it. Automatic indexing is separately
controlled in Settings. Search can be approximate; read the source passage.

For a developer checkout, run `git lfs pull` from the repository root. An LFS
pointer is not a model file. Do not bypass resource checksum validation. For an
installed copy, check that the package includes the embedding resources rather
than distributing only the executable. See the
[model notice](../src-tauri/resources/embedding/multilingual-e5-small/MODEL-NOTICE.md).

## A save fails or reports a conflict

Keep the draft open. Check available disk space and directory access, then retry
when the problem is resolved. Another window may have updated the same work;
resolve that conflict before replacing it. Unlock the work if it is read-only.
Do not delete the database, WAL or SHM files to make an error disappear.

## Import or export fails

Use a complete StoryArk `.storyark.json` export for whole-work import. Word/PDF
chapter exports are not whole-work backups. Current version 1 imports reject
embedded file attachments. A failed validation or cancelled destination dialog
does not create a successful import/export.

Choose **Create copy** to keep the existing book when importing another version.
Replacement creates a database recovery backup first. JSON export carries saved
work but excludes application preferences, AI configurations/keys, temporary
candidates and search indexes. The style library is stored separately in WebView
localStorage and is not covered by a SQLite backup.

## Find logs and report a problem

**Settings → Error log** displays the current path. The app first tries
`storyark-errors.log` beside its executable, then the app-data `logs` directory,
with a temporary-directory fallback for early startup failures. Logs stay local.

Include the app version, OS, reproduction steps and relevant log entries in a
report. Inspect attachments before sharing and remove private data. Do not send
API keys or an entire works database. See [diagnostic policy](user-facing-errors.md)
for retention, redaction and logging limits.

## Why is IntelliJ's terminal quiet?

WebView console messages belong to the WebView and do not automatically appear in
the Cargo/Vite terminal. Debug native diagnostics are mirrored to stderr when the
desktop process was launched from that terminal or run configuration. A separately
launched executable is not attached to it. Rebuild and restart after Rust changes;
frontend hot reload does not update native commands.

## Database recovery

Windows normally stores SQLite at
`%APPDATA%/io.github.freshapplejack.storyark/storyark.sqlite3`, with verified backups
under the same app-data directory's `backups` folder. Preserve the current files,
stop every StoryArk instance and follow [desktop recovery](desktop.md) before a
controlled restore. Do not copy only the main file of a running WAL database or
run the schema snapshot against an existing works database.
