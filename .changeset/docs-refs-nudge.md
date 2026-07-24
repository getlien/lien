---
'@liendev/lien': minor
'@liendev/parser': minor
---

Shift docs-drift detection left onto the blast-radius nudge: when `lien api-delta` detects a REMOVED exported symbol, it now also reports how many indexed documentation chunks still reference it.

- `@liendev/parser` gains `wordBoundaryRe` and `isDistinctiveToken`, lifted out of the review engine's docs-drift pass (`packages/review/src/docs-drift-signals.ts`, now a thin consumer of these instead of duplicating them) so the CLI can reuse the exact same word-boundary + distinctiveness matching precision.
- `lien api-delta`'s enrichment gains `docRefCount`/`docRefPaths` on every `removed` change (`null`/`[]` for `signature-changed`, or when the index is unavailable): a zero-LLM, fail-open lookup over the indexed `type: 'doc'` chunks for the removed symbol's name.
- The `api-delta-write.sh` PostToolUse hook appends a short sentence to its existing warning — `"N docs reference X: path1, path2, path3 (+K more)."` — when a removed symbol still has doc references; silent otherwise.
- The `blast-events.jsonl` ledger gains an additive, optional `docRefCount` field per change.
