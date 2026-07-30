---
"@liendev/parser": patch
"@liendev/lien": patch
---

Widen C# `get_dependents`/test-coverage recovery to test-declared types and
real namespace-scoped disambiguation (#930/#943's remaining gap). Measured
on a fresh serilog/serilog clone (216 `.cs` files, same corpus that
motivated #930/#943): despite that prior fix, 114/216 (53%) still reported
`dependentAttributionIncomplete` ("not determinable") and 216/216 (100%)
reported test coverage as not determinable — because the recovery's
uniqueness gate excluded test-declared types as candidate declarations
entirely, and dropped any name declared in more than one file with no
attempt at disambiguation.

`findCSharpTypeReferenceDependents` (`@liendev/parser`) now has two tiers:

- Tier 1 (widened): the existing global-uniqueness check now also accepts
  test files as declaring files — a type declared ONLY in a test helper
  (e.g. `DummyRollingFileSink.cs`) is a legitimate, real dependency target
  for other tests that reference it, and excluding it was an unjustified
  asymmetry (a test file was already an accepted *dependent*, just never a
  *declarer*). Excludes NESTED types declared in a test file specifically
  from candidacy (a nested type's bare name is resolved by containing-type
  membership, not namespace membership, and is disproportionately likely to
  be a throwaway same-named local double — measured regression, see below),
  while still recovering a nested PRODUCTION type declared in its own
  `partial`-continuation file.
- Tier 2 (new): for a type name that's ambiguous project-wide, real C#
  namespace-enclosure + shadowing rules (innermost enclosing declaration
  wins) resolve it per-referencer instead of dropping it outright — e.g.
  `Serilog.Core.Sinks` code referencing bare `Logger` resolves to
  `Serilog.Core.Logger` (the closer namespace), not a same-named
  `Serilog.Logger` or a test's own local `Logger`. Costs no schema change:
  each file's own namespace is derived from its own already-indexed chunk
  content (95% hit rate measured), not a new persisted column.

A referencer that itself declares a competing same-named type is excluded
entirely from being counted as a reference to either tier's target — a
word-boundary text match can't tell which declaration a given occurrence
resolves to once there's a local competitor, so the only safe answer is
"don't guess" (caught via a real regression during testing: a test file
constructing its own local double of a production class's name was
initially still counted as referencing the unrelated production type).

The exact same recovered signal, filtered to its test-file dependents, is
now also reused as a fifth `lien annotate` test-association tier (mirroring
Swift's existing symbol-usage tier) — closing the companion
100%-not-determinable test-coverage gap the same way, not left for
follow-up work.

Measured impact (serilog/serilog, 216 files): `dependentAttributionIncomplete`
114 (53%) → 63 (29%); test coverage not-determinable 216 (100%) → 100 (46%).
Zero regressions against the pre-widening baseline once the nested-type and
same-file-competing-declaration exclusions above were added (verified via a
full before/after diff of every file's recovered dependents, not just the
aggregate counts) — one pre-existing false positive from #943 itself
(a production class getting a spurious test dependent via exactly this
same-file-competitor shape) was found and fixed as a side effect. A 8-file
precision spot-check via `grep` confirmed every newly-recovered dependent
genuinely references its target. Index time and `get_dependents` query
latency are unaffected (both run entirely at query time; measured
before/after within noise, ~9ms mean per file on this corpus).

Does NOT fix: `ILogger.cs` and `PropertyBinder.cs` (the two files this
round's dogfood evidence specifically checks) still report
`dependentAttributionIncomplete` — for an unrelated, pre-existing reason
found while measuring this change, not this recovery mechanism. Both
contain a method declaration whose signature is split mid-token across an
`#if`/`#else`/`#endif` preprocessor boundary, which the tree-sitter C#
grammar cannot represent and recovers from by rooting the entire file in an
`ERROR` node — no chunk, no symbol, nothing for any recovery signal to work
with. Affects 2/216 files in this corpus; a related but more tractable
preprocessor-transparency gap (a declaration wholly inside one `#if` block,
affecting ~8/216 more files) is filed as
https://github.com/getlien/lien/issues/970, separate from this fix.
