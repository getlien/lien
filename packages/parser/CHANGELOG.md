# @liendev/parser

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
