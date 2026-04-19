---
'@liendev/lien': minor
'@liendev/parser': minor
'@liendev/core': minor
---

Transitive dependency walks and cleaner re-export detection for `get_dependents` (Workstream B).

**Features**

- `get_dependents` MCP tool gains `depth` (1–5, default 1) and `maxNodes` (default 500) parameters. At `depth > 1`, the tool walks the import graph outward via BFS. Each dependent carries a `hops` field indicating the depth at which it was discovered. `truncated: true` is set when the BFS stops at the `maxNodes` cap. Symbol-level queries (`symbol` set) remain depth-1 only.
- Response gains `totalImpacted` (= `dependents.length`, for CRG-naming parity) and `riskReasoning` (short phrases explaining why a `riskLevel` was assigned, e.g. `["14 callers", "3 untested", "max complexity 18"]`).
- `riskLevel` is now sourced from the shared `computeBlastRadiusRisk` primitive in `@liendev/parser`, unifying the heuristic across the MCP tool and the Lien Review pipeline. Thresholds consider dependent breadth, test coverage, and dependent complexity — not just count + a complexity boost.
- The MCP server's initialize instructions now tell clients about `depth`, `hops`, `truncated`, and `riskReasoning`, so Claude Code / Cursor / etc. know transitive impact is available.

**Fixes**

- JS/TS relative import specifiers (`./foo`, `../bar`) are now resolved against the chunk's file path at index time, so `chunk.metadata.imports` and `importedSymbols` keys store workspace-relative paths instead of bare basenames. This eliminates cross-package basename-collision false positives in `get_dependents`. Bumps `INDEX_FORMAT_VERSION` 4 → 5; existing indexes reindex automatically on next `lien serve` / `lien index`.
- Re-export detection now requires a symbol intersection between what a file imports from the target and what it exports. Previously, any file that imported the target and happened to export anything was flagged as re-exporting the entire target, polluting depth-1 results with its unrelated dependents.
- Corrects the schema description and `hitLimit` warning message on `get_dependents`: single-repo scans have no chunk cap; the actual 100,000-chunk cap only applies to cross-repo scans.
