---
'@liendev/core': minor
'@liendev/lien': minor
---

**BREAKING:** Remove LanceDB and the embeddings stack entirely. The SQLite structural store (better-sqlite3 + FTS5 lexical search) is now the only backend, and no code path computes embeddings.

- Deleted the `@lancedb/lancedb` and `@huggingface/transformers` dependencies. Installs are smaller and no model is ever downloaded.
- `VectorDBInterface` no longer takes embedding vectors: `insertBatch(metadatas, contents)`, `updateFile(filepath, metadatas, contents)`, and `search(query, limit?)` (lexical). `searchCrossRepo` is removed; `scanCrossRepo`/`supportsCrossRepo` remain as single-repo stubs.
- Removed the `embeddings.enabled` and `core.embeddingBatchSize` project config keys and the `lien index --no-embeddings` flag. Old configs that still contain these keys continue to load — the retired keys are dropped on the next save.
- The global `backend` config key is unchanged: it validates `sqlite`, and a config or `LIEN_BACKEND` pinned to the retired `lancedb`/`qdrant` value warns once and maps forward to `sqlite`.

If you upgraded from a LanceDB build, run `lien index` once to rebuild (it is fast and downloads nothing). A stale `code_chunks.lance/` directory left in `~/.lien/indices/<repo>/` is no longer used and can be safely deleted to reclaim disk; automated cleanup is future work.
