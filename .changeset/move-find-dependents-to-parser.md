---
"@liendev/parser": minor
"@liendev/lien": patch
---

Move `findDependents` (the `get_dependents` MCP tool's engine) from the CLI into `@liendev/parser`, decoupled from `@liendev/core`'s `VectorDBInterface`

`findDependents` was the hardened, actively-maintained dependency analysis, but it lived in `cli` — the top of the package dependency stack (`parser` ← `core` ← `cli`) — so `packages/review` (which depends on `parser` only) couldn't reuse it and had grown its own weaker, independently-drifting dependency graph.

The `VectorDBInterface` dependency was an illusion: the CLI file only ever called `vectorDB.scanAll()` and used `import type` for everything else from `@liendev/core`. `SearchResult` is a structural superset of `CodeChunk`, so making `findDependents` and its helpers generic over `<T extends CodeChunk>` (the same technique `#973` applied to `addFuzzyMatchChunks`/`findDependentChunks`) let the whole algorithm move to `@liendev/parser` unchanged in behavior, taking `Iterable<T>` chunks instead of a database handle.

`@liendev/parser`'s `dependency-analyzer.ts` already held the simpler `analyzeDependencies` (used by `get_complexity`); `findDependents` was merged into the same file rather than a sibling module so the two algorithms could share their low-level helpers (path normalization, file grouping, complexity aggregation, re-export graph building) for real instead of drifting apart in two places — five of the six duplicate-named functions across the two former files are now single, generic implementations.

The CLI's `dependency-analyzer.ts` is now a thin wrapper: it fetches (and caches) chunks via `vectorDB.scanAll()` and calls `@liendev/parser`'s `findDependents`. The `scanCache` deliberately stays in the CLI (the caller is what knows its `indexVersion`); `@liendev/parser` has no mutable module state.

No behavioral change — `get_dependents` MCP tool output (`dependentCount`, `productionDependentCount`, `riskLevel`, `attributionCaveat`, and the full dependent-filepath set, for both file-level and symbol-level queries) is byte-identical before and after, verified against this repo's own index.
