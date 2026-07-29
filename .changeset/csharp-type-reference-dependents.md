---
"@liendev/parser": patch
"@liendev/lien": patch
---

Recover real C# `get_dependents` dependents lost to `global using` (#930,
part 2). #932/#936 stopped the tool from fabricating dependents out of
`GlobalUsings.cs` boilerplate and made the resulting zero honest
(`dependentAttributionIncomplete`), but a file with `global using` in scope
still reported `dependentCount: 0` / `riskLevel: "low"` even when it had
real callers — honest-and-blind, not correct. Confirmed on a fresh
serilog/serilog clone: `Alignment.cs` has 5 real production dependents and
1 real test dependent, none reachable via a per-file import.

Adds a lower-confidence recovery signal, `findCSharpTypeReferenceDependents`
(`@liendev/parser`): for a file whose type name is declared exactly once
project-wide (so a same-named reference elsewhere can't be an unrelated
declaration — the C# compiler itself would refuse to build over that
ambiguity), scan every other C# file's source text for an
identifier-boundary occurrence of that name. Only attempted when the import
graph found zero dependents for a file-level query on an
`enclosingNamespaceAccess` language (C# today).

Recovered dependents are tagged `confidence: "inferred"` on `DependentInfo`
(a new optional field, absent on every ordinary import-verified dependent)
and never folded in unhedged — the response also gets a new
`attributionCaveat` reason, `"dependent-attribution-partial"`, explaining
that the count is a recovered lower bound, not a verified/complete answer.
`dependentAttributionIncomplete` now only fires when this recovery attempt
*also* finds nothing. Both are purely additive: no existing field is
removed, renamed, or changed shape.

Verified end-to-end via the real MCP `get_dependents` tool against a fresh
serilog/serilog clone: `Alignment.cs` goes from `dependentCount: 0` /
`"low"` to all 5 real production dependents + its test dependent (`medium`
risk); `PropertyToken.cs` (a file with a genuine import-verified test
dependent) is unaffected; a 25-file serilog sample recovered dependents for
21 files, left 2 honestly `dependent-attribution-incomplete` (no
recoverable signal), and left 2 real import-based hits untouched; a
TypeScript control (hono) confirmed zero cross-language impact.

`tools.ts` and `instructions.ts` (the two model-facing surfaces) are
updated accordingly.
