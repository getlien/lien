---
'@liendev/core': patch
'@liendev/lien': patch
---

Security: `safeRegex` (used by the `list_functions` MCP tool and vector DB pattern filters) missed alternation-based ReDoS — `(a|a)+$` compiled to a live RegExp whose `.test()` could hang `lien serve`. Replaced the hand-rolled heuristic with `safe-regex2` (nested-quantifier detection) plus a targeted check for duplicate alternation branches under a repeated group, and added a 256-character pattern length cap enforced before any analysis runs.
