---
"@liendev/lien": patch
---

Follow-up to #930/#936: `annotate` (and the read-hook nudge it powers) now
prints `"Dependents not determinable from imports (enclosing-namespace
access)."` whenever a C# file's dependents can't be determined from imports
— the same `dependentAttributionIncomplete` signal `get_dependents` already
carries, now surfaced in `annotate` too. Previously the annotation stayed
silent about dependents in exactly this case (a zero-dependent result was
never printed at all), and could even suppress the whole annotation via the
low-impact "stay quiet" rule despite dependents being genuinely
indeterminate rather than genuinely zero.
