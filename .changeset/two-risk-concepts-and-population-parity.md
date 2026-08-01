---
"@liendev/core": patch
"@liendev/lien": patch
---

Fixes two confirmed defects where `riskLevel` disagreed for the same file at
the same moment (CLI-4/REVIEW-6/#1017), plus a related population-parity bug
found while investigating (HOOKS-2).

**CLI-4/REVIEW-6 — `get_complexity`/`lien complexity` computed a genuinely
different concept than `get_dependents`/`lien annotate`/`lien api-delta`,
under the identical field name `riskLevel`.** The two are legitimately
different questions — "how risky is this file's own complexity" (own
violation severity, boosted but never downgraded by dependent count/
complexity, no test-coverage term at all) vs "how risky is changing this
file given who depends on it" (blast-radius risk: dependent breadth plus
untested-dependent count, with a complexity floor) — so the fix renames
rather than merges: `lien complexity --format json` and `get_complexity`'s
`violations[]` now report `complexityRiskLevel` instead of `riskLevel`.
`lien complexity`'s text output now prints "Complexity risk:" instead of
bare "Risk:". `get_dependents`/`lien annotate`/`lien api-delta` are
unchanged — they keep `riskLevel` for blast-radius risk. Both concepts are
now documented side by side, with the divergence pinned by a dedicated test,
in `docs/architecture/blast-radius-nudge.md`'s new "Two risk concepts"
section.

**HOOKS-2 — `lien annotate` fed the wrong population into blast-radius
risk.** `get_dependents`/`lien api-delta` compute risk from
`productionDependentCount` (test files calling the target don't weigh into
risk the same way production callers do); `lien annotate` fed the wider
`dependents.length` (production + test) instead — an internal mismatch too,
since it already used the narrower `uncoveredProductionDependents` for the
untested count in the same call. A file with many test-only importers and
few production ones could read riskier from `lien annotate` than from
`get_dependents` for the identical file at the identical moment. Fixed by
feeding `productionDependentCount` into `lien annotate`'s risk computation
too, and relabeling the "N callers" reasoning entry as "N production
callers" (shared `relabelCallerReasoning`, used by both `get_dependents` and
`lien annotate` — one implementation instead of two that can drift again).
The displayed dependents list and count are unchanged (still the wider
production + test total, sorted production-first).
