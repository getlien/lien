---
'@liendev/core': patch
---

Removed the dead `core.chunkSize`/`core.chunkOverlap` (and legacy
`indexing.chunkSize`/`indexing.chunkOverlap`) config keys.

These keys were validated in `ConfigService` — including range warnings for
very small/large values — but never read by any indexing pipeline.
`getIndexingConfig()` and every chunking call site in the full-index,
incremental, overlay, and review chunk-only-index pipelines were hardcoded to
`DEFAULT_CHUNK_SIZE`/`DEFAULT_CHUNK_OVERLAP` regardless of what a user
configured. Chunking is AST-based (function/class-level) for all supported
languages; these knobs only ever shaped the line-based fallback used for
unsupported or unparseable files, where tuning has negligible value under
BM25 lexical search — and `chunkOverlap` specifically was an embeddings-era
relic (embeddings were removed in ADR-011). An existing `.lien.config.json`
that still carries either key now warns once and ignores it instead of
failing validation.
