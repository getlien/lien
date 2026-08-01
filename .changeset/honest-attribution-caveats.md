---
"@liendev/parser": patch
"@liendev/lien": patch
---

`get_dependents` now hedges instead of returning a confident zero in two
more structurally-blind shapes (#1015, #1005 — the honesty half of each;
real resolution remains open):

- **#1015** — a `symbol`-scoped query whose target is a class/struct/
  interface/enum declaration (not a function or method) now carries a new
  `attributionCaveat.reason: "type-symbol-attribution-incomplete"`.
  Usage attribution is call-site-driven, and nothing "calls" a type by its
  own name the way a function call does — constructor calls, type hints,
  `extends`/`implements` clauses, generic type arguments, and
  dependency-injected property access don't reliably surface as a tracked
  call site, so `totalUsageCount` for a type is a partial floor, not a
  verified total, regardless of whether it comes back `0` or some small
  positive number. Function/method symbol queries are unaffected —
  `totalUsageCount` stays exact there (verified against PHP `formatPrice`).
- **#1005** — the existing `dependent-attribution-incomplete` caveat (a
  file-level query with zero import-based dependents in a language whose
  import graph can't see every real usage) now also fires for Java, Kotlin,
  and Swift, not just C#. Each qualifies for a different underlying reason
  (Java/Kotlin: same-package visibility needs no `import`; Swift:
  whole-module access) — see `hasDependentAttributionBlindSpot` in
  `packages/parser/src/ast/languages/registry.ts`. Go is deliberately
  excluded: its own same-directory test convention already recovers a real
  association rather than needing an honesty label.

No behavior changes for languages/shapes where the existing mechanism
already produces a verified answer — a genuinely unused function or a
file with real import-based dependents still reports a clean, uncaveated
result.
