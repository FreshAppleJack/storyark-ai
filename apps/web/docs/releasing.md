# Release checklist

This is a maintainer checklist, not evidence that an installer or a live provider
has been tested. Record concrete release verification outside the source tree;
keep repeatable tests and sanitized fixtures in the repository.

## Source release

- Select the project license and add its complete text at repository root.
  Make the README and package metadata agree with that choice. Confirm rights to
  contributed or copied material before applying the project license to it.
- Review [third-party notices](../../../THIRD_PARTY_NOTICES.md), upstream resource
  licenses and dependency changes. Preserve third-party notices and exclusions.
- Check repository files and history for credentials/private data using
  `scripts/scan-secrets.ps1` from the repository root. A clean current tree is not
  proof that history is clean.
- Hydrate Git LFS model files and verify a clean checkout can run documented
  commands. Do not depend on a personal external model directory.
- Run relevant [engineering checks](engineering.md), schema checks and native
  tests; report fixtures, live services and platform tests separately.
- Write release notes describing changes, known limits and migration/recovery
  implications. Keep `package.json` and `src-tauri/tauri.conf.json` versions aligned.

## Binary distribution

- Build on each intended target platform with its native toolchain. Existing
  Windows CI does not validate a macOS installer or code signing.
- Use the platform Tauri configuration so the bundled model and tokenizer files
  are included. Test resource loading from the installed application, not just
  the repository checkout.
- Include the project license and required third-party license/notice texts with
  the binary. The direct-dependency inventory is not a complete binary notice pack;
  include transitive libraries, the ONNX runtime and shipped resources too.
- Test installation/startup, upgrade of disposable existing data, backups,
  import/export, save/close guards, local search and diagnostic-path fallback.
- Check OS credential storage on supported platforms. Windows and macOS have
  configured native credential backends; another platform must not be advertised
  as equivalent without verification. Session-only credentials remain separate.
- Verify signing/notarization where used, and document actual support and known
  limitations. Do not describe an unsigned or untested package as verified.
- Provide checksums for the final artifacts and inspect packaged content for
  development profiles, private databases, keys and unrelated logs.
