# StoryArk

StoryArk is a desktop writing workspace for organizing books, drafting chapters,
developing characters and exploring what happens next. It combines a React/Tiptap
editor with a Tauri application and local SQLite storage.

## What you can do

- Organize books, volumes and chapters, with autosave and read-only controls.
- Write formatted manuscripts with character mentions and foreshadowing notes.
- Keep chapter summaries, story background, plot settings and relationship maps.
- Search titles or story content using lexical and local semantic search.
- Use your configured AI provider for continuation, brainstorm directions and
  chapter summary suggestions; review results before adopting them.
- Export chapters to Word/PDF, or move a saved work using StoryArk JSON import/export.
- Adjust the theme, writing preferences and editor sidebar widths.

Open **Settings → Help** for the in-app guide. It covers editing, search, AI
Continue, brainstorming, foreshadowing, and saving/exporting.

## Data and AI

Normal desktop use does not require an account or a separate backend server.
Saved work stays in the application's local data directory. There is no automatic
cross-device synchronization; use whole-work JSON export/import to move a book.

Semantic search uses the bundled `intfloat/multilingual-e5-small` embedding model
on the device. It can return related passages that do not answer the question;
check the source before relying on a result.

AI generation is optional. When you request it, the configured provider receives
the selected writing/context material. Provider privacy, retention, pricing and
model limits depend on that provider. API keys are kept in the OS credential
store or current application session, rather than a work export. Diagnostic logs
stay local and are not automatically uploaded.

## Run from source

Use Node.js 24, Git LFS, Rust stable and the native prerequisites for your target
platform. Windows needs the MSVC C++ build tools, Windows SDK and WebView2. See
[desktop development](apps/web/docs/desktop.md) for details and recovery guidance.

```sh
git clone https://github.com/FreshAppleJack/storyark-ai.git
cd storyark-ai
git lfs install
git lfs pull
cd apps/web
npm ci
npm run desktop:dev
```

The desktop development server uses `http://127.0.0.1:1420`. Keep the launching
terminal open. A browser-only `npm run dev` preview does not provide the native
SQLite, credential-store or embedding functionality.

## Build and verify

From `apps/web`:

```sh
npm run lint -- --max-warnings 0
npm test
npm run schema:check
npm run schema:test
npm run build
npm run desktop:build
```

`build` includes TypeScript checking. `desktop:build` builds an executable without
an installer. For platform packages, use `npm run tauri -- build`; include the
bundled model resources and verify the resulting package on its target platform.
Do not distribute a bare executable as a complete installation.

From `apps/web/src-tauri`, run `cargo fmt --check` and `cargo test --locked`.
CI covers frontend checks on Ubuntu and native tests on Windows; it does not
establish live-provider compatibility, installer signing or macOS release readiness.

## Documentation

- [Maintenance documentation](apps/web/docs/README.md)
- [Architecture and code map](apps/web/docs/architecture.md)
- [Troubleshooting](apps/web/docs/troubleshooting.md)
- [Contributing](CONTRIBUTING.md)
- [Release checklist](apps/web/docs/releasing.md)
- [Third-party components and resources](THIRD_PARTY_NOTICES.md)

## License

The project source license is awaiting the maintainer's selection. Third-party
components and bundled resources retain their own licenses; see
[third-party notices](THIRD_PARTY_NOTICES.md). Public source access alone is not a
replacement for an explicit project license.
