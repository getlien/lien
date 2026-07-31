---
"@liendev/parser": minor
"@liendev/core": patch
"@liendev/lien": patch
---

Finish the complexity-analysis migration into `@liendev/parser` (#994 Phase
4). `@liendev/core`'s `ComplexityAnalyzer` used to carry a hand-synchronized
~350-line copy of the violation/report/enrichment algorithm that already
lived in parser's `analyzeComplexityFromChunks` — the divergence risk that
let #979 ship (the copy's testAssociations enrichment was never wired up).
`ComplexityAnalyzer.analyze()` now fetches chunks from the structural store
and delegates straight into `analyzeComplexityFromChunks`, same as the
static `analyzeFromChunks()` already did; the class is now a thin bridge
from `VectorDBInterface` to that pure function, with no independent copy of
the algorithm left to drift.

Also moves `effortToMinutes`/`formatTime` (Halstead-effort-to-readable-time
conversion) out of `@liendev/core`'s text formatter, which had its own copy,
and re-exports the single implementation from `@liendev/parser`.

No output change for any existing caller (`lien complexity`, `get_complexity`,
`lien annotate`, `lien delta`) — verified byte-identical on this repo except
for `complexity-analyzer.ts` itself, which naturally drops the complexity
violation it used to report on its own now-deleted 350-line implementation.
