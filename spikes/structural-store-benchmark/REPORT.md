# Structural-store A/B benchmark — results & recommendation

**SPIKE — not for merge.** Question: now that Lien is dropping the semantic/vector
index, is LanceDB still the right store for the structural-only workload?

**Answer: No. Switch to `better-sqlite3`.**

## Setup

- Corpus: the real `getlien/lien` source indexed via `performChunkOnlyIndex`
  (AST chunking, symbols, complexity, imports/exports, call sites — no
  embeddings), replicated 10× to **44,430 chunks** (monorepo scale; the code's
  own `scanAll` comment benchmarks ~57k, prod index hit ~195k).
- Platform: darwin-arm64, Node v22.22.0. Fresh process per backend; warm-ups
  discarded; p50/p95/p99 over N≥100 (200 for point lookups).
- Parity guard: all four backends return byte-identical result counts for
  identical inputs before any latency is trusted.
- LanceDB measured **as it runs today** (384-dim vectors present, zero-vector
  ANN scans). SQL backends store structural columns only.

## Results (p50 ms unless noted)

| Metric                                   | LanceDB (today) | **better-sqlite3** |     libsql |     duckdb |
| ---------------------------------------- | --------------: | -----------------: | ---------: | ---------: |
| **getFilesContext** (mandatory pre-edit) |           40.49 |           **0.04** |       0.11 |       0.49 |
| getFilesContext p95                      |           43.36 |           **0.33** |       0.62 |       0.90 |
| **getDependents** (uncached scan+graph)  |         1057.59 |         **251.44** |     450.62 |     267.80 |
| getDependents — **indexed seed**         |             n/a |              21.89 |      23.60 |   **0.99** |
| listFunctions                            |          516.97 |         **170.75** |     350.63 |     200.21 |
| testAssocScan                            |          303.77 |             147.15 |     207.01 | **142.76** |
| getComplexityScan                        |          776.60 |         **152.67** |     357.74 |     171.80 |
| cold start                               |           60.71 |               3.52 |   **1.58** |       8.84 |
| index build                              |          2455.4 |              844.2 |     4158.6 |  **589.3** |
| on-disk MB                               |           134.1 |              118.2 |      136.1 |   **66.3** |
| peak mem MB                              |          1463.4 |             1230.0 | **1027.2** |     1869.2 |
| **install native MB**                    |              93 |            **1.8** |        7.5 |        113 |

## Recommendation: `better-sqlite3`

1. **The hot path collapses.** `get_files_context` — mandatory before every
   agent edit — goes **40.5 ms → 0.04 ms (~1000×)**. That is the single most
   frequent query in daily use.
2. **The 1.5 s `get_dependents` cold floor is gone.** The perf work that landed
   column-projected `scanAll` as a workaround was treating a symptom: a proper
   B-tree index seeds dependents in **~22 ms** (48× vs LanceDB today), because
   the workload wants indexed lookups, not columnar vector scans.
3. **Install shrinks ~52×** — 93 MB LanceDB native binary → 1.8 MB. Directly
   retires a chunk of the install-friction findings from the deep review.
4. Wins or ties every latency metric, fastest-but-one cold start, synchronous
   API matches Lien's single-process CLI/MCP-server model.

**Why not the others:**

- **DuckDB** is competitive on speed and best on disk (columnar compression),
  and its indexed dependents seed is astonishing (0.99 ms) — but a **113 MB
  install (heavier than LanceDB)** and the **highest peak memory** disqualify it
  for a local dev tool whose whole pitch is being lightweight.
- **libsql** (the Rust/SQLite-compatible option) is solid — lowest peak memory —
  but slower than better-sqlite3 across every query and **slowest to build the
  index** (4.2 s). The Rust provenance buys nothing here; the C SQLite binding
  is faster for this workload.

## Caveats

- Corpus is a 10× replication of one repo (realistic scale, less realistic
  cardinality diversity). Directionally safe given the ~1000× / ~50× margins.
- `getComplexity` measured as its storage read only (the analyzer's JS
  dependency-enrichment is identical across backends and would swamp the signal).
- Migration cost is real: a `SqliteBackend` implementing `VectorDBInterface`'s
  structural subset, plus a one-time reindex. The seam (kept from the Qdrant
  retirement) makes it drop-in.
- `node:sqlite` (builtin) could eventually drop the native dep entirely; revisit
  once it exits experimental.
