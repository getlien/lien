---
'@liendev/core': minor
'@liendev/lien': minor
---

Add an optional structural-only mode: embeddings can now be disabled so the local index and MCP server run on pure AST/structural analysis, with no embedding computation, no model download, and no embedding worker thread.

- New project config: `embeddings.enabled` in `.lien.config.json` (default: `true` — no behavior change for existing users). Toggle it with `lien config set embeddings.enabled false` / `true`.
- New CLI flag: `lien index --no-embeddings` forces structural-only mode for a single run.
- `lien serve` reads the same config: when disabled, it never constructs a `WorkerEmbeddings` instance or spawns the embedding worker.
- Structural chunks are still persisted to the vector store (via a new `NullEmbeddings` service that writes zero-vector placeholders), so `get_files_context`, `get_dependents`, `list_functions`, and `get_complexity` keep working unchanged — they read structural columns via `scanAll`/`scanWithFilter`, never vectors.
- `semantic_search` and `find_similar` return a clear `note` ("disabled — structural-only mode") instead of crashing or silently returning misleading empty results.
- `lien status` reports the current embeddings mode (text and JSON output).
- Toggling `embeddings.enabled` requires `lien index --force` to take effect on already-indexed files — incremental indexing only reprocesses changed files, so unchanged chunks keep their old vectors (real or placeholder) until a full reindex.
