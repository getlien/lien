---
"@liendev/lien": patch
---

Follow-up to #930 (`global using` no longer producing false import edges,
shipped in #932): removing those false edges alone left `get_dependents`
reporting a confidently-empty `dependentCount: 0` / `riskLevel: "low"` for a
C# file with real callers Lien simply has no signal for — a false-all-clear
that's arguably worse than the fabrication it replaced, since C#'s
enclosing-namespace access means a real caller needs no per-file `using` at
all once a `global using` exists for a namespace.

`get_dependents` now sets `dependentAttributionIncomplete: true` plus a
`dependentAttributionNote` for exactly that shape (a file-level query with
zero dependents found, in a language where `hasEnclosingNamespaceAccess` is
set) — mirroring the `symbolAttributionDegraded` pattern already shipped for
symbol-level queries (#928). `dependentCount: 0` in that case now reads as
"the import graph found nothing," not a verified "nothing depends on this
file."

This does not recover the true dependents (that needs type-reference-based
resolution the codebase doesn't have today — tracked separately); it makes
the failure mode honest instead of silently misleading.
