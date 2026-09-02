---
'@liendev/lien': patch
---

**`lien health` no longer calls a function "contained" when it never resolved
the function's callers.**

On a language `lien health` resolves no fan-in for, it reported the honest
thing in its coverage footer and then contradicted it one line above:

```text
  1  Sources/Demo/Config.swift:13  classify
     mental load 28 · imported by 0 · no tests
     Complex, but contained — little depends on it.      ← wrong
     → simplify when you are next in here                ← wrong advice

  Coverage
    no fan-in found   swift (5)
                      ranked on complexity and tests only — not judged safe
```

`Config` is used by every other file in that module. Swift's `import` names a
module, not a file, and same-module declarations need no import at all — so
there is no import edge to resolve, and `dependentCounts` has no entry for the
file. `dependentCounts.get(file) ?? 0` turned "we did not look" into "we looked
and found nothing," and `classifyShape` then read the resulting `0` as a small
blast radius.

Now:

```text
     mental load 28 · fan-in not resolved · no tests
     No fan-in found for this language here — blast radius unmeasured.
     → find the callers yourself before changing it
```

**The ranking was wrong too, which is the part that survives any wording fix.**
`scoreRisk` damps by `1 + log2(1 + dependents)`, so an unmeasured entry scored
as if genuinely isolated. A widely-used Swift function therefore sorted *below*
a contained TypeScript one of equal complexity, and with a default top-5 could
drop off the list entirely. Fixed via `SHAPE_PRIORITY` rather than the score:
the new `unknown-fan-in` shape sorts above `cheap-win` and `isolated` — which
are judgements that the blast radius is small or manageable, and an unmeasured
entry has not earned either — and below `dangerous`/`expensive`, because a
measured wide blast radius outranks an unmeasured one.

Changes:

- `RiskEntry.dependents` is now `number | null`. In `--format json`,
  unmeasured fan-in serializes as `null`, not `0`; `"dependents": 0` was a
  false statement of fact, and `null` forces a consumer to consult
  `coverage[]`.
- New `RiskShape` member `unknown-fan-in`, decided before the `widelyUsed`
  comparison so an unmeasured entry can never fall through to `isolated`.
- `buildEntries` takes the unresolved-language set from
  `unresolvedFanInLanguages(computeCoverage(...))` — the coverage rows the
  footer already prints, so the ranking and the footer cannot disagree about
  which languages resolved. It is a required parameter: defaulting it would
  reinstate the bug at any call site that forgot it.

Per-language, not per-run: a repo mixing a resolved language with an
unresolved one gets real counts for the first and `null` for the second.

The coverage footer's wording is corrected alongside this. It said unresolved
languages were "ranked on complexity alone", which was never true — `scoreRisk`
applies its untested 2× multiplier regardless of fan-in, so an untested entry
always outranked a tested one of equal complexity. It now says "complexity and
tests only". The behaviour is deliberate and unchanged: fan-in is the single
unmeasured axis, and throwing away the two that *are* measured would rank
worse, not more honestly.

**Deliberately unchanged:** a language that *did* resolve fan-in keeps `0` for
a file with genuinely no importers, and still reads as `isolated`. Verified on
this repo — output is byte-identical. Turning a genuinely contained function
into a false alarm is the failure mode this must not introduce, and there is a
test pinning it.

The wording stays observational. `computeCoverage`'s contract is "reports what
happened, never what is possible" — a language whose files genuinely never
reference each other is indistinguishable from one Lien cannot resolve, so the
new text says no fan-in was *found here*, never that the language is
unsupported. A test asserts the string avoids both `contained` and
`cannot`/`unsupported`/`never`.

This is `No-Data Honesty` one level below where it was enforced. The rule was
gated per *scan* (`describeScanFailure`/`describePartialScan`); this was the
same failure per *language*, and `computeCoverage`'s docblock already promised
the guarantee this delivers: *"a language with no resolved fan-in is never
silently ranked as safe."*

Also: `health-cmd.test.ts`'s `report()` helper hardcoded
`language: 'typescript'` on every violation, so no test could express a
violation in another language — which is why nothing here could have caught
this. `language` is now an optional per-violation field defaulting to
TypeScript.

Fixes #1137. Independent of #1005 (Swift resolves 0 dependency edges) and #869
(no per-file test associations for whole-module-import languages): those are
the cause, this is the conclusion drawn from their result, and it would remain
a bug for any future language without a recovery tier.
