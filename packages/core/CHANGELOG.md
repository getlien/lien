# @liendev/core

## 0.40.0

### Minor Changes

- 402758a: Extract `@liendev/parser` from `@liendev/core` for clean package boundaries. AST parsing, complexity analysis, chunking, and dependency analysis now live in `@liendev/parser` (~5-10MB) while `@liendev/core` retains embeddings and vector DB integration. `@liendev/review` now depends only on `@liendev/parser`, significantly reducing its deployment size.

### Patch Changes

- Updated dependencies [402758a]
  - @liendev/parser@0.40.0

## 0.39.0

### Minor Changes

- 844ceab: ### Features
  - Add `--editor` flag to `lien init` for multi-editor support (#272)
  - Add `metricType` filter to `get_complexity` MCP tool (#270)
  - Detect KISS violations via per-file simplicity signals in Veille reviews (#263)
  - Architectural review with codebase fingerprint (#251)
  - AST-powered logic review with GitHub suggestion diffs (#249)
  - Veille review system improvements (#248)

  ### Fixes
  - Use language registry for analyzable file extensions in reviews (#269)
  - Tighten marginal violation threshold from 15% to 5% (#267)
  - Remove hard violation cap, add token-budget-aware fallback (#265)
  - Use effort-based Halstead bugs formula (#262)
  - Improve dedup note with severity, grouped metrics, and comment links (#261)
  - Skip unchecked_return for void-returning functions (#260)
  - Deduplicate Veille review comments across push rounds (#253)

  ### Refactors
  - Reduce formatTextReport complexity (#254)

## 0.38.1

### Patch Changes

- 4b1dddf: ### Fixes
  - Exit code 0 when running `lien` with no arguments (#235)
  - Hide deprecated `--watch` flag from serve help (#239)
  - Suppress ASCII banner for non-TTY output (#237)
  - Hide indexing settings behind `--verbose` flag (#236)
  - Add `--format json` to `lien status` (#238)
  - Type Qdrant filter parameters — replace `any` with exported `QdrantFilter` (#240)
  - Fix LanceDB records double-cast in batch insert (#203)
  - Share ManifestManager instance in file-change-handler to avoid lock contention (#226)
  - Sequence manifest-mutating operations to avoid write races (#243)

  ### Refactors
  - Split QdrantDB into focused sub-modules (filter-builder, query, batch-insert, maintenance) (#227)
  - Remove deprecated config exports (#228)
  - Extract status command into focused display functions (#245)

## 0.38.0

### Minor Changes

- 6c3bd23: ### Features
  - Add CommonJS import/export extraction — `module.exports`, `exports.X`, and `require()` patterns are now detected by the dependency analyzer, enabling full metadata for CommonJS codebases like Express (#213)

## 0.37.0

### Minor Changes

- be82a7b: ### Features
  - Add CommonJS import/export extraction — `module.exports`, `exports.X`, and `require()` patterns are now detected by the dependency analyzer, enabling full metadata for CommonJS codebases like Express (#213)

## 0.36.0

### Minor Changes

- ac9fce5: ### Features
  - Add `skipEmbeddings` option to `indexCodebase` for chunk-only indexing, ~90% faster for complexity-only workflows (#208)
  - `lien init` now creates `.cursor/mcp.json` directly instead of printing setup instructions (#205)

  ### Fixes
  - Address ReDoS, command injection, and MCP schema validation security issues (#200)
  - Eliminate `instanceof QdrantDB` checks via `VectorDBInterface` cross-repo methods (#201)
  - Add missing language extensions (.scala, .c, .cpp, .h, .hpp, etc.) to default scan patterns (#201)
  - Deduplicate results from absolute and relative path entries (#172)
  - Replace LanceDB `any` types with proper `Connection`/`Table` types (#202)
  - Cache import index in dependency analyzer, keyed by indexVersion (#202)
  - Align LanceDB function signatures with runtime null checks (#205)
  - Remove dead CLI flags (`--watch`, `--threshold`) and add timing to index output (#205)
  - Resolve npm audit vulnerabilities (#163, #204)

  ### Refactors
  - Derive `SupportedLanguage` type from `LANGUAGE_IDS` array (#166)
  - Consolidate path-matching utilities into core package (#165)
  - Extract shared `extractRepoId` utility, removing 4 duplicate implementations (#202)

## 0.35.0

### Minor Changes

- 5c62ebc: ### Features
  - Upgrade to @huggingface/transformers v3 with GPU support + `lien config` command (#160)
  - Parallelize embedding generation and file processing for faster indexing (#156)
  - Paginate dependency analysis scans to handle large codebases (#155)
  - Expand ecosystem presets to 12 ecosystems, replacing framework detection (#150, #148)
  - Track barrel file re-exports in dependency analysis (#128)
  - Python `__init__.py` re-export support for dependency tracking (#134)
  - Rust import extraction and consolidated language files (#131)
  - Consolidate symbol extraction into per-language files (#132, #133)
  - Show result counts in MCP truncation messages (#136)

  ### Fixes
  - Support nested `.gitignore` files in incremental indexing (#147)
  - Filter gitignored files in watcher and unify ignore patterns (#140, #146)
  - Add checkAndReconnect guard to background git reindex paths (#145)
  - Return alias instead of original name for Python aliased imports (#123)
  - Remove duplicate result.ts already exported by core (#151)
  - Remove redundant dependencies provided by @liendev/core in action (#122)

  ### Refactors
  - Remove dead embeddings.device (cpu|gpu) config (#161)
  - Extract helper functions from indexing pipeline (#158)
  - Split MCP server.ts into focused modules (#153)
  - Consolidate duplicate test helpers via @liendev/core/test subpath export (#152)

## 0.34.0

### Minor Changes

- 19ada7b: Add Rust as the 5th AST-supported language with full support for traversal, export extraction, complexity analysis, and semantic search. Also upgrades @lancedb/lancedb and apache-arrow to fix a schema mismatch error that prevented indexing.

## 0.32.0

### Minor Changes

- aa39d54: feat(core): add symbolType filtering to scanWithFilter in VectorDB

  fix(core): emit class chunks alongside method chunks in AST chunker
  fix(core): add missing chalk dependency
  fix(core): resolve file paths relative to rootDir in indexer
  fix(core): log per-file indexing errors instead of swallowing silently

## 0.31.0

### Minor Changes

- a738d2a: feat(core): add symbolType filtering to scanWithFilter in VectorDB

  fix(core): emit class chunks alongside method chunks in AST chunker
  fix(core): add missing chalk dependency
  fix(core): resolve file paths relative to rootDir in indexer
  fix(core): log per-file indexing errors instead of swallowing silently

## 0.30.0

### Minor Changes

- 02dbd79: feat(mcp): add symbolType filter to list_functions tool

  Adds an optional `symbolType` parameter to the `list_functions` MCP tool,
  allowing callers to filter results by symbol kind: function, method, class,
  or interface. The `function` filter includes methods for backward compatibility;
  use `method` to target only class/object methods.

## 0.29.1

### Patch Changes

- 808a1b6: fix: clean up empty string artifacts in metadata, fix list_functions crash with LanceDB storage
  - Filter empty strings from metadata fields (parameters, symbolType, symbols) at both AST extraction and MCP response shaping
  - Fix list_functions crash when LanceDB flattens nested symbols objects
  - Consolidate duplicate deduplication logic into shared utility
  - Remove untyped response objects in MCP handlers
  - Filter markdown files from related chunks in get_files_context

## 0.28.0

### Minor Changes

- e592243: - **Smart Batching**: Aggregates multiple rapid file changes into single reindex operations, reducing overhead during "Save All" operations
  - **Reindex Status Visibility**: Added `reindexInProgress`, `pendingFileCount`, `lastReindexDurationMs`, and `msSinceLastReindex` to all MCP responses for better AI assistant awareness
  - **Event-Driven Git Detection**: Replaced polling with `.git` directory watching for instant git change detection (~3s latency vs poll interval)
  - **Content-Hash Based Change Detection**: Files touched without content changes (e.g., `touch file.ts`) no longer trigger expensive reindexing

  - Fixed MCP protocol interference from console output in FileWatcher causing JSON parse errors
  - Corrected log levels for success/info messages (were incorrectly logged as errors)
  - Empty files now logged at info level instead of error level

  - Reduced unnecessary reindexing operations by 40-60% in typical workflows
  - Git detection latency reduced from poll interval (15s default) to ~3 seconds
  - Zero CPU usage during idle periods (no polling)

## 0.27.0

### Minor Changes

- 90232ae: feat(indexer): add PHP and Python export tracking for symbol-level dependencies

  Extends symbol-level `get_dependents` support to PHP and Python codebases by implementing export tracking for these languages. The `extractExports()` function now identifies:

  **PHP:**
  - Classes, traits, interfaces (namespaced and global)
  - Top-level functions
  - All exportable declarations within namespace blocks

  **Python:**
  - Classes (including `@dataclass` and other decorated classes)
  - Functions and async functions
  - Decorated definitions (e.g., `@property`, `@staticmethod`)

  This enables accurate dependency analysis, impact assessment, and symbol usage tracking for PHP and Python projects. Previously, symbol-level `get_dependents` only worked for JavaScript/TypeScript.

  **Architecture:** Export extraction logic has been refactored into dedicated language-specific modules (`extractors/`), mirroring the existing `traversers/` pattern for improved modularity and maintainability.

## 0.24.0

### Minor Changes

- c9e5e10: ---

  "@liendev/lien": minor
  "@liendev/core": minor

  ***
  - **Claude Code support** - New `CLAUDE.md` project rules file for Claude Code integration with tool quick reference and workflow guidelines

  - **`list_functions` fallback bug** - Content scan fallback now correctly filters by `symbolName` instead of `content`, preventing markdown docs from appearing in results

  - **Simplified `init` command** - Removed Cursor rules installation; init now just displays setup information (config-less approach)
  - **Improved MCP tool descriptions** - `semantic_search` now positioned as "complements grep" rather than replacement
  - **Better vectordb scan coverage** - `scanWithFilter` and `querySymbols` now scan all database records for complete results

## 0.23.0

### Minor Changes

- 9fa59ef: Previously, when `~/.lien/config.json` contained JSON syntax errors, Lien would silently fall back to LanceDB without indicating the config was ignored.

  **Now you get clear, actionable error messages:**

  ```bash
  $ lien index
  ✖ Indexing failed

  Failed to parse global config file.
  Config file: /Users/you/.lien/config.json
  Syntax error: Expected double-quoted property name in JSON at position 23 (line 1 column 24)

  Please fix the JSON syntax errors in your config file.
  ```

  **What changed:**
  - Config parsing errors now show the exact file path
  - Specific syntax error with line/column position
  - Helpful remediation message
  - Missing config files still silently fall back to LanceDB (expected behavior)

## 0.22.0

### Minor Changes

- 09f7f92: - **Branch & commit tracking for Qdrant backend**: Automatically isolates indices by git branch and commit SHA, preventing data overwrites when working with multiple branches or PRs
  - **Fail-fast validation**: Factory now throws clear errors when config file exists but has syntax errors, instead of silently falling back to LanceDB

  - Fixed factory silently falling back to LanceDB when Qdrant was explicitly configured but encountered errors
  - Fixed payload mapper incorrectly converting `0`, empty strings, and empty arrays to default values
  - Fixed `searchCrossRepo` missing validation logic that other search methods provide

  - Refactored Qdrant filter builder for better code reuse and consistency
  - Tightened TypeScript types for Qdrant payload metrics
  - Enhanced error messages for Qdrant configuration issues
  - Updated documentation for branch/commit isolation behavior

  When using Qdrant backend, all index operations now automatically:
  - Extract current git branch and commit SHA
  - Include branch/commit in point IDs to prevent collisions
  - Filter all search queries by current branch (unless explicitly disabled)

  **Migration**: None required. This release is 100% backward compatible with existing indices.

## 0.21.0

### Minor Changes

- 7fe7010: - **Qdrant backend support with multi-tenant capabilities**
  - Full `VectorDBInterface` implementation using Qdrant vector database
  - Multi-tenant support via `orgId`/`repoId` payload filtering
  - Collection-per-organization naming: `lien_org_{orgId}`
  - Automatic `orgId` detection from git remote URLs
  - Version management and reconnection support

  - **Cross-repository semantic search**
    - Search across all repositories in your organization with a single query
    - Optional repository filtering via `repoIds` parameter
    - Results grouped by repository for easy navigation
    - Works with `semantic_search`, `get_dependents`, and `get_complexity` MCP tools

  - **Global configuration system**
    - Optional `~/.lien/config.json` for backend selection (only needed for Qdrant)
    - Environment variable support: `LIEN_BACKEND`, `LIEN_QDRANT_URL`, `LIEN_QDRANT_API_KEY`
    - Auto-detection of frameworks and organization ID
    - Zero-config by default (LanceDB remains default backend)

  - **Enhanced MCP tools for cross-repo operations**
    - `semantic_search`: Added `crossRepo` and `repoIds` parameters
    - `get_dependents`: Cross-repo dependency analysis support
    - `get_complexity`: Organization-wide complexity analysis support

  - **Configuration system simplified**
    - Removed requirement for per-project `.lien.config.json` files
    - Removed config migration logic and version tracking
    - All functionality now works with sensible defaults
    - Old config files are ignored (no errors, backward compatible)

  - **Backend selection via factory pattern**
    - `createVectorDB()` factory function selects backend based on global config
    - Automatic fallback to LanceDB if Qdrant configuration is invalid
    - Improved error messages for debugging backend setup

  - **Better developer experience**
    - Zero configuration required for basic usage
    - Auto-detection of git organization from remote URLs
    - Clearer error messages for missing configuration
    - Comprehensive test coverage for Qdrant backend (448 tests)

  - **Code organization**
    - Extracted dependency analysis into dedicated module
    - Introduced `QdrantPayloadMapper` for payload transformations
    - Refactored MCP server setup for better modularity
    - Improved file watcher and git org extraction logic

  - Updated README with Qdrant setup instructions
  - Added cross-repo search examples
  - Updated MCP tools documentation with new parameters
  - Removed references to per-project config files

  - **Backward Compatible**: ✅ No breaking changes
  - **Migration Required**: ❌ None - works with existing indices
  - **Tests**: 583/583 passing
  - **Files Changed**: 67 files (3,648 additions, 3,371 deletions)

## 0.20.1

### Patch Changes

- 62b3f8c: Always ignore node_modules, vendor, and .git directories regardless of configuration

## 0.20.0

### Minor Changes

- 3ff7a26: Extract core indexing and analysis into `@liendev/core` package

  **New: @liendev/core**
  - Standalone package for indexing, embeddings, vector search, and complexity analysis
  - Programmatic API for third-party integrations
  - Can be used by cloud workers with warm embeddings

  **CLI**
  - Now imports from `@liendev/core` instead of bundled modules
  - Thinner package, shared dependency on core

  **Action (Breaking)**
  - No longer requires `npm install -g @liendev/lien`
  - Simplified setup: just `uses: getlien/lien-action@v1`
  - Automatic delta tracking with `enable_delta_tracking: true`
