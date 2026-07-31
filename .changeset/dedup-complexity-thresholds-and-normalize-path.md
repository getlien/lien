---
"@liendev/parser": minor
"@liendev/core": patch
"@liendev/lien": patch
---

Fix `normalizeFilePath` mangling sibling directories that share the workspace
root's name as a prefix, and collapse the four independent copies of the
default complexity thresholds into one (#988).

**The bug:** `normalizeFilePath` (duplicated in
`packages/parser/src/insights/chunk-complexity.ts` and
`packages/core/src/insights/complexity-analyzer.ts`) had a second,
unguarded `startsWith(normalizedRoot)` fallback with no path-separator check.
Any sibling directory whose name happened to start with the workspace root's
name — e.g. root `/x/lien` and sibling `/x/lien-review-testbed` — was
stripped down to a leading-`-` path (`-review-testbed/x.py`) that matches
nothing downstream, silently dropping the chunk from complexity reporting
instead of erroring. Both copies now delegate to `getCanonicalPath`
(`@liendev/parser`'s `utils/path-matching.ts`), which already had only the
boundary-safe branch — this removes the duplicate implementation and the bug
in the same move.

**The duplication:** the same
`{ testPaths: 15, mentalLoad: 15, timeToUnderstandMinutes: 60, estimatedBugs: 1.5 }`
threshold table was hardcoded independently in four places: `chunk-complexity.ts`'s
`DEFAULT_THRESHOLDS`, `complexity-analyzer.ts`'s private `thresholds` field,
`complexity-delta.ts`'s `DEFAULT_COMPLEXITY_DELTA_THRESHOLDS` (which powers
`lien delta`'s gate), and `@liendev/core`'s `defaultConfig.complexity.thresholds`
(the user-facing config default) — with nothing enforcing they stayed equal. A
drift between the config default and the delta gate's own default would have
silently enforced a threshold nobody chose. `chunk-complexity.ts` now exports
a single `DEFAULT_COMPLEXITY_THRESHOLDS` constant (and `ComplexityThresholds`
type); the other three sites import/alias it instead of hardcoding their own
copy, and tests assert they stay equal.
