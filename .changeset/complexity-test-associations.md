---
"@liendev/core": patch
"@liendev/lien": patch
---

Fix `ComplexityAnalyzer.analyze()` (the persisted-index path used by `lien
complexity` and the `get_complexity` MCP tool) always reporting
`testAssociations: []` for every violation, even when a real test file
imports the offending code (#979).

`packages/core/src/insights/complexity-analyzer.ts` set `testAssociations: []`
with a "will be enriched later" comment and never enriched it — the only
occurrence of `testAssociations` in the file. Its in-memory-chunks twin,
`analyzeComplexityFromChunks` (`@liendev/parser`, used by the static
`ComplexityAnalyzer.analyzeFromChunks()` and reached via `lien annotate`),
already ran `findTestAssociationsFromChunks` and enriched the report
correctly — a half-finished migration where the static delegating method
was pointed at the parser implementation but the instance method's own copy
was left behind. `get_complexity` is the tool CLAUDE.md-style agent
instructions point at before refactoring to find hotspots; it was silently
claiming none of them had tests.

Fixed by calling the same `findTestAssociationsFromChunks` from `analyze()`
after dependency enrichment, mirroring the parser twin. `SearchResult[]`
(what `analyze()` has, off the persisted index) is a structural superset of
`CodeChunk[]` (what the parser function's signature expects), so no type
changes were needed — verified via `tsc`, not assumed.

Also threaded `testAssociations` through the `get_complexity` MCP tool's
`transformViolation()` response shape, which previously omitted the field
from its output entirely regardless of what `analyze()` returned — without
this, the fix would be invisible through the exact tool named in the bug
report; the CLI's `--format json` output already included it as a
pass-through of the whole report.

Added a same-input parity test between `analyze()` (`SearchResult[]`) and
`analyzeFromChunks()` (`CodeChunk[]`) asserting they agree on
`testAssociations` — the check whose absence let this divergence ship
silently (a prior commit, 93191c41, had to hand-sync an unrelated one-line
dedup-key change across both files; nothing enforced that these two
`testAssociations` implementations stayed in sync).

Does NOT move the canonical implementation into `@liendev/parser` (the
larger duplication-layering fix suggested in #979) — `chunk-complexity.ts`
has no dedicated test file today and feeds `lien delta`'s complexity gate,
so that refactor needs characterization tests first and is left for
separate follow-up work.
