---
'@liendev/core': patch
---

Removed the unused embeddings-era `EmbeddingError` class and its
`EMBEDDING_MODEL_FAILED`/`EMBEDDING_GENERATION_FAILED` codes from `@liendev/core`'s
public exports.

Embeddings (LanceDB + the embedding pipeline) were fully removed in favor of
the SQLite/FTS5 lexical search backend (see ADR-011), and nothing in the
codebase constructs or catches `EmbeddingError` anymore. If you were catching
it specifically, catch the `LienError` base class instead (unaffected), or
match on one of the remaining `LienErrorCode` values — `EmbeddingError` always
carried `EMBEDDING_GENERATION_FAILED`, which no longer exists.
