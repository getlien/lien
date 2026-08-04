---
'@liendev/parser': patch
'@liendev/lien': patch
---

fix(parser): stop `get_dependents` re-scanning the whole import index once per dependent (#1075)

A single `get_dependents` call on a high-fan-out file in a 6,356-file C# corpus
(OrchardCore, `OrchardCoreConstants.cs`) took **166 seconds** — roughly 100x the
documented per-call floor. Two minutes is a timeout in practice, not
slow-but-usable, on the MCP tool the whole agent contract is built around.

A CPU profile put 95.4% of that in one place, and it was not the re-export graph
the issue suspected (`buildReExportGraph` accounted for 0.14%):
`uncoveredProductionDependents` asks "does any test file import this?" once per
production dependent, and answered it by re-running a full `findDependentChunks`
scan of the **entire** import index each time. That is O(dependents x every
indexed import): 1,131 dependents x 119k+ entries ≈ 135M `importMatchesTarget`
calls, of which all but the test-file importers were discarded the instant they
matched.

Two fixes, both build-once/resolve-many, neither changing a matching decision:

- The import index is projected once per call down to its **test-file
  importers**, deduplicated by (importer file, raw specifier) — 15,339 entries
  become 1,026 on OrchardCore. Each dependent then resolves against that, in the
  same two-branch (exact bucket, then fuzzy `importMatchesTarget`) order, and
  returns on the first hit instead of materializing every importer.
- The four per-importer-file language decisions `importMatchesTarget` derives
  (#884 whole-module, #887 single-file, #929 Python bare-module, #1028 PHP
  namespace) are memoized per file path instead of re-running
  `detectLanguage` — and therefore `node:path`'s `extname` — four times for the
  same path on every single comparison. That derivation alone was 42% of the
  profile (`detectLanguage` 32.5% self, `extname` 10.2%). The registry it reads
  is frozen at module load, so the record is a pure function of the path.

Same target, same 1,131 dependents, same `dependentAttributionPartial`:
**166,009 ms → 437 ms** (five runs: 481/451/441/443/437 ms). The re-profiled
call is now dominated by nothing in particular — the C# type-reference tier
(0.18 s) and this counter (0.16 s) are the same order.

Equivalence is proven, not asserted. `hasTestImporterBruteForce` is exported as
the never-pruned oracle (the role `computeDependentCountsBruteForce` plays for
#1071) and the pruned predicate is checked against it for **every file** of the
eleven real corpora the CLI E2E matrix names, plus serilog and OrchardCore, and
the full `findDependents` result is diffed field-by-field against a pre-change
build across those same corpora at depth 1 and depth 3. Zero mismatches
throughout. #1044's order-independent `reported`/`queued` BFS is untouched.
