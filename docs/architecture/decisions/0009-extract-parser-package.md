# ADR-009: Extract `@liendev/parser` from `@liendev/core`

**Status**: Accepted
**Date**: 2026-02-19
**Deciders**: Core Team
**Related**: [Issue #207](https://github.com/getlien/lien/issues/207), PR #278

## Context and Problem Statement

`@liendev/core` bundles two distinct responsibilities: AST parsing/analysis (~5-10MB) and vector DB/embeddings integration (~100MB with native dependencies). `@liendev/review` only needs AST parsing and complexity analysis to generate PR review comments, yet it depends on `@liendev/core` and transitively pulls in LanceDB, Qdrant, and transformers.js — none of which it uses.

This causes:
- **Bloated deployments** — the Lien Review GitHub App Docker image ships ~100MB of unused embedding/vector DB code
- **Slow installs** — native dependencies (LanceDB, onnxruntime) compile during `npm install` even when not needed
- **Unclear package boundaries** — parsing, chunking, and complexity analysis are conceptually independent from embedding and search

## Decision Drivers

* **Deploy size** — Lien Review runs as a Docker container; smaller images = faster cold starts
* **Install speed** — CI pipelines and contributors shouldn't wait for native deps they don't need
* **Clean boundaries** — packages should have a single clear responsibility
* **No breaking external API** — this is an internal restructuring; MCP tools and CLI commands remain unchanged

## Considered Options

### Option 1: Keep everything in `@liendev/core`

Leave the architecture as-is. Accept the bloated dependency tree for `@liendev/review`.

**Pros:** No migration effort.
**Cons:** Every consumer of parsing/analysis pays the cost of embedding/vector DB dependencies.

### Option 2: Make `@liendev/review` import specific files from `@liendev/core` (deep imports)

Use path-based imports like `@liendev/core/indexer/ast/parser` to avoid pulling in the full package.

**Pros:** No new package needed.
**Cons:** Fragile — deep imports break on internal refactors. Doesn't actually reduce install size since native deps are declared at the package level.

### Option 3: Extract `@liendev/parser` (chosen)

Create a new `@liendev/parser` package containing all AST parsing, chunking, complexity analysis, and dependency analysis code. `@liendev/core` depends on `@liendev/parser` and adds embedding/vector DB capabilities on top.

**Pros:** Clean separation, smaller dependency tree for review, clear package boundaries.
**Cons:** Migration effort, one more package to maintain.

## Decision Outcome

In the context of reducing deployment size for Lien Review and establishing clean package boundaries, facing the problem that `@liendev/core` bundles parsing and vector DB concerns together, we decided to extract `@liendev/parser` as a standalone package to achieve a lightweight parsing-only dependency chain, accepting the one-time migration cost of moving ~30 source files and updating imports across all packages.

### Target dependency chain

```
@liendev/parser  (~5-10MB)  <- AST, complexity, chunking, symbols, analysis
@liendev/core    (~100MB)   <- embeddings, vector DB, search (depends on parser)
@liendev/lien    (CLI)      <- depends on both core and parser
@liendev/review             <- depends on parser only (not core)
@liendev/app                <- depends on review
```

## What Moved to `@liendev/parser`

| Category | Modules |
|----------|---------|
| AST | `ast/parser`, `ast/chunker`, `ast/symbols`, `ast/types`, `ast/languages/*`, `ast/traversers/*`, `ast/extractors/*`, `ast/complexity/*` |
| Chunking | `chunker`, `liquid-chunker`, `json-template-chunker` |
| Scanning | `scanner`, `gitignore`, `ecosystem-presets` |
| Analysis | `dependency-analyzer`, `test-associations`, `symbol-extractor`, `content-hash` |
| Complexity | `insights/chunk-complexity`, `insights/types` |
| Types | `CodeChunk`, `ChunkMetadata`, `ScanOptions`, `ComplexityViolation`, `ComplexityReport` |
| Utils | `path-matching`, `repo-id` |
| Indexing | `performChunkOnlyIndex` (lightweight chunk-only indexing without embeddings) |

## What Stays in `@liendev/core`

| Category | Reason |
|----------|--------|
| `indexCodebase` orchestrator | VectorDB/embeddings integration |
| `ManifestManager`, incremental indexing | VectorDB-dependent |
| `ComplexityAnalyzer` class | VectorDB wrapper around parser functions |
| `insights/formatters/` | CLI output formatting |
| `embeddings/`, `vectordb/` | Core-specific (LanceDB, Qdrant, transformers.js) |
| `git/`, `config/`, `errors/` | Core-specific utilities |

## Consequences

### Positive

- **Smaller Lien Review image** — drops LanceDB, Qdrant, transformers.js, onnxruntime from the dependency tree
- **Faster CI for review** — no native dependency compilation
- **Clear package boundaries** — parsing is self-contained with zero imports from core
- **Reusable** — `@liendev/parser` can be used independently for AST analysis without any vector DB setup

### Negative

- **One more package** — adds a `packages/parser/` directory to the monorepo
- **Import churn** — all consuming packages (cli, core, review, app) had imports updated
- **Build ordering** — CI must build parser before core (parser is a dependency of core)

### Neutral

- Tree-sitter dependencies moved from core to parser (they belong with AST parsing)
- `glob` and `ignore` dependencies moved from core to parser (used by scanner/gitignore)
- No external API changes — MCP tools, CLI commands, and review output are unchanged

## Validation

- All 548 parser tests pass
- All 158 review tests pass (now importing from `@liendev/parser`)
- All CLI tests pass (619 tests, split imports between core and parser)
- Core tests pass (excluding expected Qdrant failures without a running server)
- `npm run typecheck`, `npm run lint`, `npm run format:check` all pass
- Zero circular dependencies: parser has no imports from core
- Zero core imports in review: `@liendev/review` depends only on `@liendev/parser`

## Pre-extraction Coupling Fixes

Before extraction, three preparatory refactors were needed:

1. **Decouple `dependency-analyzer.ts` from `SearchResult`** — changed to use `CodeChunk` (structural subtype) instead of importing from vector DB types
2. **Extract `analyzeComplexityFromChunks`** — pulled pure analysis logic out of `ComplexityAnalyzer` class so it can run without a VectorDB instance
3. **Split parser constants** — moved `DEFAULT_CHUNK_SIZE`, `DEFAULT_CHUNK_OVERLAP`, `MAX_CHUNKS_PER_FILE` to a separate file

## Related Decisions

- [ADR-003](0003-ast-based-chunking.md) — AST-based chunking (now in parser)
- [ADR-005](0005-per-language-definition-pattern.md) — Per-language definitions (now in parser)
- [ADR-006](0006-consolidated-language-files-with-import-extractors.md) — Consolidated language files (now in parser)

## References

- [Issue #207](https://github.com/getlien/lien/issues/207) — Extract parser package
- PR #278 — Implementation
