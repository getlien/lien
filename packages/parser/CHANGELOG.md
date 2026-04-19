# @liendev/parser

## 0.44.0

### Minor Changes

- 9fd617b: Transitive dependency walks and cleaner re-export detection for `get_dependents` (Workstream B).

  **Features**
  - `get_dependents` MCP tool gains `depth` (1–5, default 1) and `maxNodes` (default 500) parameters. At `depth > 1`, the tool walks the import graph outward via BFS. Each dependent carries a `hops` field indicating the depth at which it was discovered. `truncated: true` is set when the BFS stops at the `maxNodes` cap. Symbol-level queries (`symbol` set) remain depth-1 only.
  - Response gains `totalImpacted` (= `dependents.length`, for CRG-naming parity) and `riskReasoning` (short phrases explaining why a `riskLevel` was assigned, e.g. `["14 callers", "3 untested", "max complexity 18"]`).
  - `riskLevel` is now sourced from the shared `computeBlastRadiusRisk` primitive in `@liendev/parser`, unifying the heuristic across the MCP tool and the Lien Review pipeline. Thresholds consider dependent breadth, test coverage, and dependent complexity — not just count + a complexity boost.
  - The MCP server's initialize instructions now tell clients about `depth`, `hops`, `truncated`, and `riskReasoning`, so Claude Code / Cursor / etc. know transitive impact is available.

  **Fixes**
  - JS/TS relative import specifiers (`./foo`, `../bar`) are now resolved against the chunk's file path at index time, so `chunk.metadata.imports` and `importedSymbols` keys store workspace-relative paths instead of bare basenames. This eliminates cross-package basename-collision false positives in `get_dependents`. Bumps `INDEX_FORMAT_VERSION` 4 → 5; existing indexes reindex automatically on next `lien serve` / `lien index`.
  - Re-export detection now requires a symbol intersection between what a file imports from the target and what it exports. Previously, any file that imported the target and happened to export anything was flagged as re-exporting the entire target, polluting depth-1 results with its unrelated dependents.
  - Corrects the schema description and `hitLimit` warning message on `get_dependents`: single-repo scans have no chunk cap; the actual 100,000-chunk cap only applies to cross-repo scans.

## 0.43.0

### Minor Changes

- 43e38ce: feat(parser): add C# language AST support

## 0.42.0

### Minor Changes

- 66ac7e9: feat(parser): add Java language AST support

## 0.41.0

### Minor Changes

- 8384321: ### Features
  - Add full AST support for Go (6th language): function detection, complexity analysis, import/export tracking, symbol extraction (#297)
  - Pluggable review engine with CLI `lien review` command (#282)
  - Review plugin `present()` hook with engine-managed check run (#295)
  - Architectural review with codebase fingerprint (#251)
  - AST-powered logic review with GitHub suggestion diffs (#249)
  - Detect KISS violations via per-file simplicity signals (#263)
  - Add `--editor` flag to `lien init` for multi-editor support (#272)
  - Add `metricType` filter to `get_complexity` MCP tool (#270)
  - Review system improvements (#248)

  ### Fixes
  - Use effort-based Halstead bugs formula (#262)
  - Use language registry for analyzable file extensions in review (#269)
  - Tighten marginal violation threshold from 15% to 5% (#267)
  - Remove hard violation cap, add token-budget-aware fallback (#265)
  - Deduplicate review comments across push rounds (#253)
  - Improve dedup note with severity, grouped metrics, and comment links (#261)
  - Skip unchecked_return for void-returning functions (#260)
  - Include @liendev/review in root build script, skip onnxruntime GPU download on CI

  ### Refactors
  - Extract `@liendev/parser` package from `@liendev/core` (#278)
  - Rebrand Veille → Lien Review (#276)
  - Align MCP response type interfaces with shapeResults output (#275)
  - Reduce formatTextReport complexity (#254)

## 0.40.0

### Minor Changes

- 402758a: Extract `@liendev/parser` from `@liendev/core` for clean package boundaries. AST parsing, complexity analysis, chunking, and dependency analysis now live in `@liendev/parser` (~5-10MB) while `@liendev/core` retains embeddings and vector DB integration. `@liendev/review` now depends only on `@liendev/parser`, significantly reducing its deployment size.
