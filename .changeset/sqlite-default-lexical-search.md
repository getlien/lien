---
'@liendev/core': minor
'@liendev/lien': minor
---

**BREAKING with graceful degradation:** SQLite is now the only backend and lexical FTS5 search replaces semantic search.

- `sqlite` is now the default (and only reachable) backend. A config or `LIEN_BACKEND` pinned to the retired `lancedb` value no longer errors — it warns once and falls back to `sqlite`. On first run the index rebuilds automatically (fast, and nothing is downloaded).
- `semantic_search` is now full-text lexical search: BM25 over code, docstrings, and camelCase-split identifiers. Query with concrete keywords and identifiers that appear in the code, not natural-language questions — there are no embeddings, so meaning-only paraphrases won't match. The tool keeps its name for compatibility; `find_similar` and `get_files_context`'s related-chunks now use the same lexical matching.
- Embeddings are no longer computed. Indexing never downloads a model or spawns an embedding worker. The `embeddings.enabled` config key and `lien index --no-embeddings` flag are still accepted but are inert.
