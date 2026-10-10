# StoryArk

StoryArk is a desktop writing workspace for organizing books, drafting chapters,
developing characters and exploring what happens next. It combines a React/Tiptap
editor with a Tauri application and local SQLite storage.

## About this project

StoryArk is primarily a personal learning project, built to explore desktop
application development and AI-assisted creative writing. It is still evolving,
and there are bugs, rough edges and limitations in features, performance and
platform support. Keep backups of work that matters to you.

Bug reports, suggestions and contributions are welcome. If something does not
work as expected, or you have an idea for improving it, please
[open an issue](https://github.com/FreshAppleJack/storyark-ai/issues) or
[submit a pull request](https://github.com/FreshAppleJack/storyark-ai/pulls).
See [CONTRIBUTING.md](CONTRIBUTING.md) for reporting and development guidance.

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

### Your work stays on your device

Writing and organizing a book do not require a StoryArk account, an internet
connection or a separate backend server. Saved manuscripts and story material
are stored in a local SQLite database in the application's data directory.
StoryArk does not automatically sync books between devices. To move a book, export
it as a StoryArk work file (`.storyark.json`) and import it on the other device.
Word and PDF exports are intended for reading or sharing individual chapters;
they do not transfer the complete writing workspace.

### Story search runs locally

Semantic search uses the bundled `intfloat/multilingual-e5-small` embedding model
to find passages with related meaning. The model runs on your device, so this
search does not send your manuscript to an AI provider or need an API key.
Search also uses keyword matching to find exact words and phrases. Results can
miss relevant material or include passages that are only loosely related; check
the original text before relying on them. Saved changes may take a little time
to appear while the local search index updates in the background.

### AI writing uses the service you configure

AI Continue, brainstorming and summary suggestions are optional and use your
configured model service. If that service is online, these actions need a network
connection and send the relevant manuscript excerpts and reference material to
it. They may incur charges under the provider's pricing.

- **AI Continue** starts from the current draft before the cursor or selection
  and retrieves related passages, summaries, characters, relationships,
  background and foreshadowing. It does not send the whole book by default.
- **AI Brainstorm** uses the outline, background, selected chapter summaries,
  relevant characters and relationships, and existing plot plans. When a summary
  is missing, it can use a short chapter excerpt and related passages instead.
- **Summary suggestions** use the selected chapter's manuscript as their main
  source, with relevant character and setting information to clarify context.

Long reference material is limited, so the model may not receive every detail.
Generated text can contradict your story or invent facts. Review candidates before
adopting them; generating a suggestion does not automatically replace your writing.
The service's privacy policy, data retention, fees and model limits apply to these
requests, including requests sent through a proxy you configure.

### API keys and error logs

If you choose to remember an API key, StoryArk stores it in Windows Credential
Manager or macOS Keychain. Otherwise, a newly entered key stays in the current
application session. Keys are excluded from work exports and database backups.
The key is still sent to your configured service to authorize requests, so use a
service and endpoint you trust. See **Settings → Help** for storage details.

Error logs are kept locally and are not automatically uploaded. **Settings →
Error log** shows where to find them when reporting a problem. Logging is designed
to omit manuscript content and credentials, but inspect any log or screenshot
before sharing it in a public issue.

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

## Acknowledgements

Thank you to [Brandon717-max](https://github.com/Brandon717-max) and
[Casanova-kdb](https://github.com/Casanova-kdb), fellow team members on the group
project that preceded StoryArk. This acknowledgement recognizes their involvement
in that earlier project and our shared project history.

## License

StoryArk's source code and documentation are licensed under the
[MIT License](LICENSE). Copyright (c) 2026 FreshAppleJack.

Third-party components and bundled resources retain their own licenses; see
[third-party notices](THIRD_PARTY_NOTICES.md).
