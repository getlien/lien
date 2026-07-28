---
'@liendev/parser': patch
---

Fixes #918: `matchesWithSourcePrefix` (one of `matchesPythonModule`'s four
sub-strategies) anchored its leading edge (at most one directory segment
before the match) but never checked what followed the match, so a candidate
matched as a bare textual prefix of an unrelated sibling —
`matchesFile('com.example.Utils', 'com/example/UtilsHelper')` returned
`true`. Found during #864's Kotlin adversarial analysis (any language whose
import specifier happens to look like a bare/dotted identifier reaches this
matcher, not just Python — `matchesFile` is language-agnostic).

The fix requires the right edge to reach end-of-string, a `/` path
separator, or a `.` extension boundary, mirroring the anchoring discipline
`matchesAtBoundaryPrecise` already enforces on the other four strategies.
Added regression tests for the reported shape plus two more realistic
same-package collisions (`Op`/`OpChain`, `Json`/`JsonWriter`), a same-shape
canary with the leading `src/`-style prefix, and positives confirming
legitimate matches (exact dotted-name-to-file, `django.http` ->
`src/django/http/response.py`, and the extension-boundary branch directly)
still pass. `matchesSuffixPythonModule` was audited too: its `endsWith`
check already anchors to the end of the string, so it doesn't share this
gap (it has the opposite gap — no cap on the left — already documented at
its own call site).

Corpus-wide before/after diff across two real repos (pallets/flask, 92
files/1056 chunks; JetBrains/Exposed, 850 files/11223 chunks — the
provenance repo) on both dependents and test-associations: 0 regressions,
0 changed edges on either. Root cause, confirmed by direct instrumentation:
`matchesWithSourcePrefix`'s left-edge cap (at most one leading directory)
never once passes for a real call in either corpus — Exposed's Gradle
multi-module source layout puts several directories ahead of any package
path, and flask's dotted imports that reach this branch at all resolve via
the earlier, already-anchored strategies first. The bug is real (a bare
textual-prefix match with no boundary check at all) but its specific
trigger shape didn't happen to occur in either corpus's actual file layout;
the fix is verified via the added unit tests instead.
