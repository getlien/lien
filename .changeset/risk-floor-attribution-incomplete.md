---
'@liendev/lien': patch
---

The habituation guard's risk floor silenced the "Dependents not determinable
from imports" annotation — the exact message #938/#939 shipped to prevent an
agent reading an unknown as a zero — **in the default plugin configuration**.

`annotate-cmd.ts` runs two suppression gates back to back. #938 taught
`isTrivial` about `dependentAttributionIncomplete`; `belowRiskFloor`, three
lines below it, never learned. A file whose dependents are indeterminable has
low risk *by construction* (zero **known** dependents), so it fell below a
`medium` floor and was dropped. This was not opt-in: `annotate-read.sh:68` sets
`min_risk="${LIEN_ANNOTATE_MIN_RISK:-medium}"` and passes `--min-risk` on every
read-time annotation.

Reproduced on the published 0.72.0 binary against serilog/serilog:

```console
$ lien annotate src/Serilog/Capturing/PropertyBinder.cs
Lien impact for src/Serilog/Capturing/PropertyBinder.cs:
  • Dependents not determinable from imports (enclosing-namespace access).
  • Test coverage not determinable from imports (enclosing-namespace access).

$ lien annotate src/Serilog/Capturing/PropertyBinder.cs --min-risk medium
(no output — suppressed)
```

Not an edge case: an exhaustive pass found **114 of 216** serilog `.cs` files
(53%) carry that note. Serilog is one hierarchical namespace tree, so C#'s
enclosing-namespace access lets the whole library reference its own members
with zero `using` directives — `ILogger.cs`, the central interface, genuinely
has no import-determinable dependents. For C# of this shape, suppression was
the common path.

`belowRiskFloor` now takes `dependentAttributionIncomplete` as a defaulted
trailing parameter (matching #938's own approach for `isTrivial`) and treats it
as high-value, clearing the floor exactly as `complexityWarnings` and
`headroomCount` already do.

Deliberately **not** extended to the sibling "Test coverage not determinable"
flag, measured across four freshly re-indexed corpora: coverage-indeterminable
is 100% of serilog's C# files and 83% of Alamofire's Swift files, because
`wholeModuleImports` (Swift) and `enclosingNamespaceAccess` (C#) make coverage
structurally undecidable from imports. Clearing the floor for it would
blanket-annotate two entire language ecosystems — precisely what the
habituation guard exists to prevent. Dependents-indeterminable is the rarer,
higher-signal flag and the right one to promote.

This was reported by Lien Review on #938 itself, correctly and specifically,
and shipped anyway because the finding was stated in summary prose rather than
as an addressable item — see #958 and #960.
