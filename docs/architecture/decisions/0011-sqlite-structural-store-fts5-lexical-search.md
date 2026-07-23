# ADR-011: Replace LanceDB + Embeddings with a SQLite Structural Store and FTS5 Lexical Search

**Status**: Accepted
**Date**: 2026-07-04
**Deciders**: Core Team
**Related**: ADR-008 (superseded, kept transformers.js while Lien had embeddings), ADR-010 (retired Qdrant, kept the `VectorDBInterface` seam this decision reuses), PR #656, #657, #658, #661

## Context and Problem Statement

Lien's embedding pipeline (`WorkerEmbeddings`, `@huggingface/transformers` in a worker thread, kept as the sole backend by ADR-008) computed 384-dim vectors for every chunk and stored them in LanceDB to power `semantic_search`/`find_similar`. This cost more than it delivered:

- **Heavy install**: ~93MB of native LanceDB binary plus the transformers.js/onnxruntime stack, and a model download on first index.
- **No SQL**: a vector index can't be joined against structural columns (complexity, import path, language, symbol type) in one query; semantic and structural filtering were separate code paths.
- **The structural hot paths were already suffering.** `get_files_context` (the MCP call mandatory before every agent edit) measured 40.5ms against LanceDB; `get_dependents` had a ~1.5s cold floor at monorepo scale. Prior perf work (column-projected `scanAll`) treated the symptom; the root cause was a columnar/vector-oriented store being asked to do indexed structural lookups.
- The Qdrant retirement (ADR-010) had already deliberately kept the `VectorDBInterface`/`createVectorDB` factory seam as the place a replacement backend could be dropped in.

Two spikes (branch `spike/structural-store-benchmark`, not merged, kept as historical evidence) answered the two open questions before committing:

1. **Is SQLite actually faster for the structural workload?** An A/B benchmark of LanceDB vs. better-sqlite3 vs. libsql vs. DuckDB against a 44,430-chunk replicated corpus of this repo found better-sqlite3 won decisively: `get_files_context` **40.49ms → 0.04ms** (~1000x), `get_dependents` dropped from a ~1.06s uncached floor to a **~22ms indexed-seed** (48x), and the native install shrank **93MB → 1.8MB** (~52x).
2. **Is FTS5/BM25 keyword search good enough without embeddings?** A follow-up spike layered FTS5 + a trigram substring index onto the same schema and eyeballed 8 agent-style queries: 5/8 strong, 1/8 a rank-order weakness (repairable via column weighting), and **2/8 confirmed synonym/paraphrase gaps**: "check if user is logged in" never surfaces `login()`/`verifyToken()`; a symbol search for "auth" misses `hashPassword`/`verifyToken` entirely. Both gaps are the same underlying failure (query shares no vocabulary with the target code) and are exactly what embeddings are built to solve; lexical search cannot structurally close them. Comments/docstrings bridge a meaningful fraction of this for free; sparsely-commented code would show the gap more often.

## Decision

Make the SQLite structural store (`better-sqlite3`) the only reachable backend, and FTS5/BM25 lexical search the only search mechanism. Delete LanceDB and the entire embeddings stack. Shipped in three steps on 2026-07-04:

1. **PR #656 / #657** (`36c14e3`, `5e6890e`): switch the default backend to `SqliteBackend` and make lexical FTS5 the only search path, keeping the tool name `semantic_search` for compatibility at this stage.
2. **PR #658** (`b24fa33`, `7318371`): rename `semantic_search` to `search_code` (**breaking, no alias**): the old name promised embeddings-based semantic matching it no longer performs.
3. **PR #661** (`9153080`): delete LanceDB, `@huggingface/transformers`, and the embedding worker/cache/model-download pipeline outright. Reshape `VectorDBInterface` for a no-vector world: `insertBatch(metadatas, contents)`, `updateFile(filepath, metadatas, contents)`, `search(query, limit)`. `searchCrossRepo` is removed; `supportsCrossRepo`/`scanCrossRepo` remain as single-repo stubs.

The schema closes the spike's confirmed camelCase-tokenizer gap: `symbolTokens` is an identifier-split copy of `symbolName` (`parseImportStatement` → `parse import statement`, `packages/core/src/vectordb/sqlite/schema.ts`) so a keyword search for "parse" matches the symbol. BM25 weights `symbolName` 4x, `symbolTokens` 2x, `content` 1x (`packages/core/src/vectordb/sqlite/fts-search.ts`).

The `VectorDBInterface`/`createVectorDB` factory seam (kept through ADR-010) is kept again: `SqliteBackend` implements it, so no handler or indexer call site needed reshaping beyond the vector-argument removal. Retired config values degrade gracefully: `backend: "lancedb"/"qdrant"` and the `embeddings.*`/`core.embeddingBatchSize` keys still load, warn once, and are dropped on the next config save; there is no crash path for an old `~/.lien/config.json` or `.lien.config.json`.

## Consequences

### Positive

- `get_files_context` (the mandatory pre-edit MCP call) collapses from tens of milliseconds to sub-millisecond; `get_dependents`'s cold floor drops from roughly a second to tens of milliseconds.
- Install shrinks by roughly 50x and indexing never downloads a model or spawns an embedding worker thread.
- SQL joins between the FTS index and structural columns enable queries LanceDB structurally couldn't answer at all in one query, e.g. "keyword-matching functions above a complexity threshold" or "callers of X that import Y."

### Negative

- **No semantic paraphrase matching.** Query with concrete keywords/identifiers/domain terms that appear in the code or its comments; a synonym-only query ("check if user is logged in" vs. `login()`) will not match. This is a structural property of lexical search confirmed pre-merge, not a tuning bug to be fixed later.
- Comment-sparse code degrades further: the spike's "strong" results leaned on docstrings bridging natural-language query words to identifiers; code without comments loses that bridge.
- Cross-repo search is gone at the type level. `searchCrossRepo` is removed, so any caller still invoking it is a compile error, not just a call that returns empty.

### Neutral

- `search_code` is a rename with no alias: any CLAUDE.md, agent prompt, or MCP config still referencing `semantic_search` needs updating; there is no deprecation window.
- The multi-tenant `ChunkMetadata` fields kept through ADR-010 (`repoId`, `orgId`, `branch`, `commitSha`) remain unused scaffolding; nothing here removes them.
- Reintroducing a vector backend later means implementing `VectorDBInterface`'s current (vector-less) shape and extending the factory: the same pattern the Qdrant and LanceDB backends had.

## References

- `spike/structural-store-benchmark` branch (`REPORT.md`, `FTS5-SEARCH.md`): not merged, retained as the benchmark evidence behind this decision
- PR #656, #657, #658, #661
- ADR-008: superseded by this decision
- ADR-010: retired Qdrant, established the seam this decision reuses
