---
"@liendev/parser": minor
"@liendev/lien": minor
---

Fix `get_dependents`' risk verdict contradicting its own components (#933),
and unify its three attribution-caveat flags into one field (#940).

**#933**: `computeBlastRadiusRisk` only ever factored complexity into the
verdict through `hasHighComplexityUncovered`, which requires an untested
dependent to fire at all — so a file with zero untested dependents but a
`critical`-complexity caller came back `riskLevel: "low"` while its own
`complexityMetrics.complexityRiskBoost` read `"critical"` (confirmed on
symfony/console's `Cursor.php`: 4 fully-tested production callers, max
complexity 31, `riskLevel: "low"`). `riskLevel` is the field
`instructions.ts` tells agents to gate on before editing an exported symbol,
so the wrong verdict misled even though the underlying counts were correct.

Fixed by adding an optional `complexityRiskBoost` input to
`computeBlastRadiusRisk`: a `high`/`critical` boost now floors the verdict
one tier below its own severity (`critical` → at least `high`, `high` → at
least `medium`), regardless of test coverage — testedness lowers the odds
of a *silent* break, it doesn't shrink the blast radius. The
untested-and-high-complexity case (`hasHighComplexityUncovered`) already
reaches full severity on its own and is unaffected; verified against gin's
`bytesconv.StringToBytes` (1 untested, critical complexity) staying `high`,
not escalating to `critical`.

**#940**: `symbolAttributionDegraded`/`symbolAttributionNote`,
`dependentAttributionIncomplete`/`dependentAttributionNote`, and `note` all
meant some version of "this count isn't a verified clear," with three
different names and shapes for a model to learn — and were mutually
exclusive by construction, so a single field always sufficed. Replaced with
one optional `attributionCaveat: { reason, note }`, where `reason` is
`'unresolved-target' | 'symbol-attribution-degraded' |
'dependent-attribution-incomplete'`. This is a breaking response-shape
change with no deprecation window — acceptable pre-1.0, and the fields were
only weeks old. `targetIndexed` stays internal, as before.

Both `tools.ts`'s tool description and `instructions.ts`'s server
instructions (the two surfaces a connecting model actually reads) are
updated accordingly, along with the `symbol` parameter's own schema
description and the `get_dependents` docs page.
