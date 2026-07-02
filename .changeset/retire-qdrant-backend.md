---
'@liendev/core': minor
'@liendev/lien': minor
---

Retire the Qdrant backend. Lien is local-first and LanceDB is now the only vector database backend. The Qdrant implementation, its `@qdrant/js-client-rest` dependency, the `qdrant.*` config keys, the `qdrant` backend option, and the `LIEN_QDRANT_URL`/`LIEN_QDRANT_API_KEY` environment variables are removed. BREAKING with graceful degradation: existing configs with `backend: "qdrant"` or `qdrant.*` keys do not crash — Lien warns once and falls back to local LanceDB. The `VectorDBInterface`/`createVectorDB` factory seam is deliberately retained. See ADR-0010.
