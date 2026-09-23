# Bundled embedding model

- Model: `intfloat/multilingual-e5-small` (ONNX, 384 dimensions)
- Upstream: <https://huggingface.co/intfloat/multilingual-e5-small>
- License: MIT, as identified by the upstream model repository. The license text is included beside the model files.
- Packaging: shipped as a Tauri application resource for Windows and macOS. Rust reads it from the application resource directory; it is not compiled into the executable and StoryArk does not modify it.

The runtime verifies SHA-256 for every required model and tokenizer file before loading. If any resource differs, local embedding reports unavailable rather than loading an unverified file. Update the pinned checksums in `src/rag/embeddings.rs` whenever deliberately replacing these artifacts. If the embedding behavior or model changes, update the embedding fingerprint contract as well so existing vectors are rebuilt.

Pinned files:

| File | SHA-256 |
| --- | --- |
| `config.json` | `69137736cab8b8903a07fe8afaafdda25aac55415a12a55d1bffa9f581abf959` |
| `tokenizer.json` | `0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39` |
| `special_tokens_map.json` | `d05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7` |
| `tokenizer_config.json` | `a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b` |
| `onnx/model.onnx` | `ca456c06b3a9505ddfd9131408916dd79290368331e7d76bb621f1cba6bc8665` |
