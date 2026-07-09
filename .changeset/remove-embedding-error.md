---
'@liendev/core': patch
---

Removed the unused embeddings-era `EmbeddingError` class and its
`EMBEDDING_MODEL_FAILED`/`EMBEDDING_GENERATION_FAILED` error codes.

Embeddings (LanceDB + the embedding pipeline) were fully removed in favor of
the SQLite/FTS5 lexical search backend (see ADR-011), but these error types
were left behind — nothing threw them. `LienErrorCode` and the public error
exports are otherwise unchanged.
