---
'@liendev/core': minor
'@liendev/lien': minor
---

`search_code` now blends BM25 with structural importance instead of ranking by lexical relevance alone.

- **Ranking boost** (`packages/core/src/vectordb/sqlite/fts-search.ts`): within the already-fetched bm25 candidate window, each result's relevance ratio is multiplied by `min(2, 1 + 0.15 * log(1 + dependentCount))` — `dependentCount` being how many other indexed files import that file (a cheap, index-connection-cached approximation; see `dependent-counts.ts`, not the authoritative `get_dependents` analysis). `log1p` keeps the boost sublinear, the `min(2, ...)` caps runaway growth for pathologically large dependentCounts, and the result is never less than the original ratio, so bm25 still dominates in the normal case and the boost usually just breaks ties. Caveat: because relevance bands are continuous, no capped multiplicative boost can *guarantee* it never crosses a band — a very well-connected hub file with a merely-relevant match can still outrank an unconnected file with a marginally-better lexical match. This is an accepted tradeoff, not a bug. Set `LIEN_STRUCTURAL_RANKING=off` to fall back to pure bm25 ordering.
- **Richer metadata**: `search_code` results now carry `metadata.dependentCount` inline (added to its metadata-shaper allowlist) so an agent can triage a result's blast radius without a follow-up `get_dependents` call. Populated unconditionally, independent of the ranking flag above.

Dogfooded against this repo's own index across 8 representative queries: the top hit never changed for any query; 3/8 queries saw lower-ranked slots (positions 3-5) reorder in favor of files with more dependents (e.g. a test fixture function displaced by the production file it tests; a docs appendix displaced by the implementation file it describes).
