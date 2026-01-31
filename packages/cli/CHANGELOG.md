# @liendev/lien

## 0.30.0

### Minor Changes

- 02dbd79: feat(mcp): add symbolType filter to list_functions tool

  Adds an optional `symbolType` parameter to the `list_functions` MCP tool,
  allowing callers to filter results by symbol kind: function, method, class,
  or interface. The `function` filter includes methods for backward compatibility;
  use `method` to target only class/object methods.

### Patch Changes

- Updated dependencies [02dbd79]
  - @liendev/core@0.30.0

## 0.29.1

### Patch Changes

- 808a1b6: fix: clean up empty string artifacts in metadata, fix list_functions crash with LanceDB storage

  - Filter empty strings from metadata fields (parameters, symbolType, symbols) at both AST extraction and MCP response shaping
  - Fix list_functions crash when LanceDB flattens nested symbols objects
  - Consolidate duplicate deduplication logic into shared utility
  - Remove untyped response objects in MCP handlers
  - Filter markdown files from related chunks in get_files_context

- Updated dependencies [808a1b6]
  - @liendev/core@0.29.1

## 0.29.0

### Minor Changes

- eb0754c: MCP tool responses now include only the metadata fields relevant to each tool, reducing context window usage by ~55%. Each tool has a per-tool allowlist that strips unnecessary fields (e.g., semantic_search
  no longer returns Halstead metrics or import maps). Results are also deduplicated across all search handlers, and find_similar filters out low-score self-matches.

## 0.28.1

### Patch Changes

- 6ee8f63: Improve tool description suggestions for semantic_search results

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

### Patch Changes

- Updated dependencies [e592243]
  - @liendev/core@0.28.0

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

### Patch Changes

- Updated dependencies [90232ae]
  - @liendev/core@0.27.0

## 0.26.0

### Minor Changes

- 0efcbfc: Add warning notes to MCP tool responses for cross-repo fallback and scan limit scenarios

## 0.25.0

### Minor Changes

- cb16aab: feat(mcp): add language/pathHint filters to find_similar, prune low-relevance results

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

### Patch Changes

- Updated dependencies [c9e5e10]
  - @liendev/core@0.24.0

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

### Patch Changes

- Updated dependencies [9fa59ef]
  - @liendev/core@0.23.0

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

### Patch Changes

- Updated dependencies [09f7f92]
  - @liendev/core@0.22.0

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

### Patch Changes

- Updated dependencies [7fe7010]
  - @liendev/core@0.21.0

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

### Patch Changes

- Updated dependencies [3ff7a26]
  - @liendev/core@0.20.0
