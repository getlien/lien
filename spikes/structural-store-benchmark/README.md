# Structural-store A/B benchmark (SPIKE — not for merge)

Lien is moving to a **structural-only** workload (semantic/vector search dropped
entirely). This spike measures whether LanceDB — chosen originally for ANN
vector search — should be replaced by a lighter/faster store now that the
workload is 100% relational / graph / array-shaped.

**This is throwaway prototype code.** It lives outside the published packages,
changes no production defaults, and exists only to produce reproducible numbers
and a recommendation. See `REPORT.md` for the results and the call.

**Follow-up spike**: `REPORT.md` settles the storage backend (better-sqlite3).
`FTS5-SEARCH.md` is the next question — does FTS5 keyword/BM25 search +
trigram substring search + hybrid lexical-structural JOINs (the search story
that replaces LanceDB's vector index) actually work and perform? Run it with
`npx tsx fts5.mjs`.

## What it measures

Four backends behind the same structural read/write surface Lien's five
consumers actually need:

| Backend | Role |
|---|---|
| `lancedb` | **Baseline** — the real `@liendev/core` `VectorDB`, measured *as it runs today* (384-dim vectors present, zero-vector ANN scans, sentinel-flattened arrays). |
| `better-sqlite3` | Synchronous C SQLite binding. |
| `libsql` | `@libsql/client` — Turso's Rust SQLite fork, async-only local-file mode. |
| `duckdb` | `@duckdb/node-api` — columnar/vectorized engine. |

The SQL backends store **structural columns only** (no vectors); arrays and the
two hand-serialized maps (`importedSymbols`, `callSites`) become JSON columns,
plus a `chunk_imports` child table + index that enables an O(log N) dependents
seed.

### Fairness guarantees

- **Same corpus, same query inputs** for every backend (`corpus.json`,
  `query-inputs.json`).
- **Same query logic on top of every backend.** Each query type is driven
  through the real Lien consumer code (`ComplexityAnalyzer` compatibility,
  parser's `findTestAssociationsFromChunks`, and a faithful copy of
  `dependency-analyzer.ts`'s import-graph seed). Only the storage layer differs.
- **`consistency.mjs` proves parity**: all four backends return byte-identical
  result counts for identical inputs before any latency is trusted.
- Fresh child process per backend for genuine cold-start + peak-memory; warm-ups
  discarded; p50/p95/p99 over N≥100 for scan ops, N=200 for point lookups.

### Query types (mirroring the real MCP tools)

| Query | Real tool | What runs |
|---|---|---|
| `getFilesContext` | `get_files_context` | point lookup of one file's chunks (`scanWithFilter` by path) |
| `listFunctions` | `list_functions` | `querySymbols` regex/pattern match |
| `getDependents` | `get_dependents` | UNCACHED `scanAll` + import-graph build + seed |
| `testAssocScan` | `get_files_context` test-assoc | `scanAll` + `findTestAssociationsFromChunks` |
| `getComplexityScan` | `get_complexity` | the `scanAll(analyzer columns)` storage read |
| `getDependentsIndexed` | (upgrade demo) | O(log N) child-table seed — SQL backends only |

> `getComplexity` is measured as its storage read, not the full
> `ComplexityAnalyzer.analyze()`. The analyzer's dependency-enrichment CPU is
> pure JS, identical across every backend, and (under the replicated corpus)
> super-linear — including it would swamp the storage signal it is meant to
> isolate. The `scanAll` read is exactly the per-file complexity read cost.

## Corpus

`corpus.mjs` indexes the **real lien repo** (git-tracked source) via Lien's own
`performChunkOnlyIndex` — the genuine structural indexing path (AST chunking,
symbols, complexity, imports/exports, call sites), no embeddings. The base repo
yields **4,443 chunks**; it is then replicated **10×** with path-prefixed copies
to reach **44,430 chunks** — a realistic monorepo scale that mirrors how Lien's
own production index reached 194,998 rows (duplicate file copies under
`.claude/worktrees/*`) and sits near the 57k-chunk index the `query.ts` scanAll
comment benchmarks against.

## Reproduce

```bash
# From this directory. Requires the three bench deps installed so the worktree
# sees them (prebuilt binaries, no source compile):
#   (cd <repo-root> && npm install --no-save better-sqlite3 @libsql/client @duckdb/node-api \
#     && git checkout -- package.json package-lock.json)

npx tsx corpus.mjs          # -> corpus.json  (REPLICATE=1 for the 4.4k single-repo corpus)
npx tsx query-inputs.mjs    # -> query-inputs.json (deterministic, shared inputs)
npx tsx consistency.mjs     # validity guard: all backends must agree
npx tsx run-all.mjs         # -> results.json (build + bench every backend)
```

Tune iteration counts with `N_LIGHT` / `N_HEAVY` env vars.

## Files

- `corpus.mjs` — build the chunk corpus from the real repo.
- `query-inputs.mjs` — deterministically sample shared query inputs.
- `lib/shared.mjs` — column lists, row↔metadata mapping, faithful import-graph
  seed, timing/percentile helpers.
- `lib/adapters.mjs` — the four backend adapters.
- `build-index.mjs` / `bench.mjs` — per-backend build / benchmark (fresh process).
- `consistency.mjs` — cross-backend parity check.
- `run-all.mjs` — orchestrator → `results.json`.
- `REPORT.md` — methodology, results table, recommendation, caveats.
- `lib/fts5-store.mjs` — FTS5 virtual tables (keyword + trigram) layered on
  the same structural schema.
- `fts5.mjs` — builds the FTS5 index, benchmarks keyword/trigram/hybrid
  queries, and dumps example output.
- `FTS5-SEARCH.md` — the lexical + hybrid search demo: latency, example
  queries, and an honest read on quality vs. semantic search.

Native binary weights were measured on darwin-arm64 with `du -sh` against the
installed packages.
