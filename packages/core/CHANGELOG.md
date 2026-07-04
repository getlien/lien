# @liendev/core

## 0.58.0

### Patch Changes

- Updated dependencies [6e502dd]
  - @liendev/parser@0.58.0

## 0.57.0

### Patch Changes

- Updated dependencies [d36fb55]
  - @liendev/parser@0.57.0

## 0.55.0

### Minor Changes

- 9e095f6: Add worktree-aware indexing: when Lien's root is a linked git worktree, it now shares the main checkout's index as a read-only base and stores only a small per-worktree overlay, instead of building a full independent index per worktree.
  - **Detection** is state-based: a root is a linked worktree when `git rev-parse --git-dir` differs from `--git-common-dir`; the main checkout is located via `git worktree list --porcelain`.
  - **Reads** union the writable overlay with the read-only base, suppressing base rows for files the worktree changed or deleted (a per-overlay mask). The base is opened `{ readonly: true }` and is never written by a worktree process.
  - **The overlay** holds full chunk rows only for files whose current content differs from what the base indexed (diff via the parser content-hash vs the base manifest), plus new files. It is rebuilt automatically when the base is reindexed.
  - **Fallbacks never error**: if the main checkout has no index, its index format is incompatible, or the base is otherwise unavailable, Lien uses a standalone index as before. Set `LIEN_WORKTREE_STANDALONE=1` to force standalone behavior.
  - **FTS caveat**: BM25 scores from the base and overlay corpora are merged approximately (documented as a v1 limitation).

  This eliminates the N× index duplication that produced a 21 GB index pile across ~30 agent worktrees of one repo.

## 0.54.0

### Minor Changes

- 9153080: **BREAKING:** Remove LanceDB and the embeddings stack entirely. The SQLite structural store (better-sqlite3 + FTS5 lexical search) is now the only backend, and no code path computes embeddings.
  - Deleted the `@lancedb/lancedb` and `@huggingface/transformers` dependencies. Installs are smaller and no model is ever downloaded.
  - `VectorDBInterface` no longer takes embedding vectors: `insertBatch(metadatas, contents)`, `updateFile(filepath, metadatas, contents)`, and `search(query, limit?)` (lexical). `searchCrossRepo` is removed; `scanCrossRepo`/`supportsCrossRepo` remain as single-repo stubs.
  - Removed the `embeddings.enabled` and `core.embeddingBatchSize` project config keys and the `lien index --no-embeddings` flag. Old configs that still contain these keys continue to load — the retired keys are dropped on the next save.
  - The global `backend` config key is unchanged: it validates `sqlite`, and a config or `LIEN_BACKEND` pinned to the retired `lancedb`/`qdrant` value warns once and maps forward to `sqlite`.

  If you upgraded from a LanceDB build, run `lien index` once to rebuild (it is fast and downloads nothing). A stale `code_chunks.lance/` directory left in `~/.lien/indices/<repo>/` is no longer used and can be safely deleted to reclaim disk; automated cleanup is future work.

## 0.52.0

### Minor Changes

- 5e6890e: **BREAKING with graceful degradation:** SQLite is now the only backend and lexical FTS5 search replaces semantic search.
  - `sqlite` is now the default (and only reachable) backend. A config or `LIEN_BACKEND` pinned to the retired `lancedb` value no longer errors — it warns once and falls back to `sqlite`. On first run the index rebuilds automatically (fast, and nothing is downloaded).
  - `semantic_search` is now full-text lexical search: BM25 over code, docstrings, and camelCase-split identifiers. Query with concrete keywords and identifiers that appear in the code, not natural-language questions — there are no embeddings, so meaning-only paraphrases won't match. The tool keeps its name for compatibility; `find_similar` and `get_files_context`'s related-chunks now use the same lexical matching.
  - Embeddings are no longer computed. Indexing never downloads a model or spawns an embedding worker. The `embeddings.enabled` config key and `lien index --no-embeddings` flag are still accepted but are inert.

- 36c14e3: Add an opt-in SQLite structural backend behind the existing vector-DB factory seam. Set `backend: sqlite` in the global config (`~/.lien/config.json`) or `LIEN_BACKEND=sqlite` to store chunks in a better-sqlite3 database with an FTS5 lexical index instead of LanceDB; the SqliteBackend implements the same `VectorDBInterface`, so no handler or indexer changes are needed. The default backend is unchanged (`lancedb`), so this release is purely additive.

### Patch Changes

- Updated dependencies [297883e]
  - @liendev/parser@0.52.0

## 0.51.2

### Patch Changes

- 57d1529: Honor the `LIEN_HOME` environment variable for Lien's global store (`~/.lien/indices/*`, `~/.lien/config.json`), via a new `getLienHome()` helper in `@liendev/parser`.

  `LIEN_HOME` has been documented in the configuration guide ("Index location") since it was written, but nothing in the code ever read it — every store-path resolver (`VectorDB`, `loadGlobalConfig`/`saveGlobalConfig`/`mergeGlobalConfig`, `lien path --store`, `lien status`, `lien config`) called `os.homedir()` directly. This patch makes the documented override actually work, and falls back to `os.homedir()` when `LIEN_HOME` is unset, so behavior is unchanged for anyone not setting it.

  This was discovered while fixing a test-hygiene bug: test suites across `packages/core` and `packages/cli` were writing real indices into `~/.lien/indices/` on every run and never cleaning them up (thousands of leaked `test-*`/`lien-test-*`/`lien-bench-*` directories accumulate over time). Tests now set `LIEN_HOME` to a per-run temp directory via a new vitest `globalSetup` in both packages, so all index/config I/O during a test run is isolated and removed automatically in teardown — no more manual per-suite cleanup needed.

- Updated dependencies [57d1529]
  - @liendev/parser@0.51.2

## 0.51.1

### Patch Changes

- ca61516: Pin `@liendev/*` sibling dependencies to a real semver range instead of `"*"`.

  `packages/cli/package.json` (published as `@liendev/lien`) declared `@liendev/core` and `@liendev/parser` as `"*"`, and `packages/core/package.json` declared `@liendev/parser` as `"*"`. Since `"*"` is never rewritten at publish time, npm installs of `@liendev/lien` could resolve to whatever `@liendev/core`/`@liendev/parser` happens to be latest on npm at install time — not the versions `lien` was actually built and tested against. This is the same `"*"`-in-published-package.json family as the earlier phantom `@liendev/review` dependency bug (#620).

  It worked so far mostly by luck (packages are usually published together in the same release), but the drift is real: `@liendev/parser` is currently stuck at `0.50.0` on npm while `@liendev/core`/`@liendev/lien` are at `0.51.0`.

  Fixed by replacing every `"*"` cross-package reference with the actual current semver range (e.g. `^0.51.0`), for both published packages (`cli`, `core`) and private ones (`review`, `action`) for consistency. `changeset`'s `updateInternalDependencies: "patch"` will now correctly keep these ranges in sync on future releases, since a `"*"` range is never considered "violated" and was silently defeating that mechanism.

  Note: `workspace:*` (the pnpm/yarn workspace protocol) is not usable here — this repo uses plain npm workspaces, and npm has no equivalent rewrite step; `npm install --package-lock-only` fails immediately with `EUNSUPPORTEDPROTOCOL` if you try it. A real pinned range is the correct fix for npm workspaces.

## 0.51.0

### Minor Changes

- ff7a9b0: Add an optional structural-only mode: embeddings can now be disabled so the local index and MCP server run on pure AST/structural analysis, with no embedding computation, no model download, and no embedding worker thread.
  - New project config: `embeddings.enabled` in `.lien.config.json` (default: `true` — no behavior change for existing users). Toggle it with `lien config set embeddings.enabled false` / `true`.
  - New CLI flag: `lien index --no-embeddings` forces structural-only mode for a single run.
  - `lien serve` reads the same config: when disabled, it never constructs a `WorkerEmbeddings` instance or spawns the embedding worker.
  - Structural chunks are still persisted to the vector store (via a new `NullEmbeddings` service that writes zero-vector placeholders), so `get_files_context`, `get_dependents`, `list_functions`, and `get_complexity` keep working unchanged — they read structural columns via `scanAll`/`scanWithFilter`, never vectors.
  - `semantic_search` and `find_similar` return a clear `note` ("disabled — structural-only mode") instead of crashing or silently returning misleading empty results.
  - `lien status` reports the current embeddings mode (text and JSON output).
  - Toggling `embeddings.enabled` requires `lien index --force` to take effect on already-indexed files — incremental indexing only reprocesses changed files, so unchanged chunks keep their old vectors (real or placeholder) until a full reindex.

## 0.50.1

### Patch Changes

- 40943f8: Speed up `get_files_context`'s test-association scan: it now calls `scanAll` (a direct column-projected `table.query()`) instead of an unfiltered `scanWithFilter`, which routed through a full-table zero-vector ANN search — roughly 10x slower on large indexes. Results are also cached per `indexVersion`, mirroring `get_dependents`' scan cache, so repeated calls in one session skip the full-table scan entirely until the index is rebuilt. `get_files_context` is the tool CLAUDE.md mandates before every file edit, so this is the hottest call in the daily agent loop.

## 0.49.1

### Patch Changes

- a8cbed7: Security: `safeRegex` (used by the `list_functions` MCP tool and vector DB pattern filters) missed alternation-based ReDoS — `(a|a)+$` compiled to a live RegExp whose `.test()` could hang `lien serve`. Replaced the hand-rolled heuristic with `safe-regex2` (nested-quantifier detection) plus a targeted check for duplicate alternation branches under a repeated group, and added a 256-character pattern length cap enforced before any analysis runs.

## 0.49.0

### Minor Changes

- ceed8e1: Retire the Qdrant backend. Lien is local-first and LanceDB is now the only vector database backend. The Qdrant implementation, its `@qdrant/js-client-rest` dependency, the `qdrant.*` config keys, the `qdrant` backend option, and the `LIEN_QDRANT_URL`/`LIEN_QDRANT_API_KEY` environment variables are removed. BREAKING with graceful degradation: existing configs with `backend: "qdrant"` or `qdrant.*` keys do not crash — Lien warns once and falls back to local LanceDB. The `VectorDBInterface`/`createVectorDB` factory seam is deliberately retained. See ADR-0010.

## 0.48.3

### Patch Changes

- b814bd0: Batch manifest deletions: removing K files now performs a single manifest read+write instead of one per file, matching the batched update path. Speeds up incremental indexing after branch switches and directory renames.

## 0.45.0

### Minor Changes

- 3d8474f: Ship the Claude Code plugin and a saga of fixes for branch-switch reconciliation in `lien serve`.

  **Claude Code plugin** (#555). Install once with `/plugin marketplace add getlien/lien` + `/plugin install lien` and Lien's MCP tools + the Explore agent are available in every session, in every repo — no per-project `lien init` needed. The `serve` command also gains an `LIEN_FORCE_INDEX=1` opt-in and skips auto-indexing in non-git directories so the plugin doesn't index scratch dirs.

  **Branch-switch reconciliation, full saga (#556).** When you `git checkout` away from a branch that had files which don't exist on the new branch, Lien now actually drops the chunks for those files from the index. Required three-layered fixes:
  - **Path-key normalization** (#557): `indexMultipleFiles` and `indexSingleFile` now thread `rootDir` through `normalizeToRelativePath`, so chunks at index time and deletion time use the same relative-path key. `indexedBranch` / `indexedCommit` are surfaced in `indexInfo` so callers can detect drift.
  - **Tip-to-tip diff** (#559): `getChangedFiles` switched from three-dot (`A...B`, "PR-diff" semantic — silently omits files that exist only on `A`) to two-dot (`A..B`, direct tip diff). Also fixes a false-prefix bug in `normalizeToRelativePath` where `/apple/foo` against root `/app` would slice to `le/foo` instead of falling through to `path.relative`.
  - **Always-on git poll** (#561): the `.git/HEAD` file watcher misses git's atomic ref rewrites (chokidar/FSEvents on macOS reports the rename of `.git/HEAD.lock`, not a change event on `HEAD` itself), so the existing event-driven trigger never fired in practice. `createGitPollInterval` now runs alongside the file watcher as a backstop instead of only as a `--no-watch` fallback. Includes a fix for the `detectChanges`-already-advanced-state race when both watcher and poll fire concurrently.

  **Freshness metadata** (#562). `indexInfo.indexDate` and `msSinceLastReindex` now reflect the most recent reconciliation (max of version-file timestamp and in-session reindex timestamp), so both external `lien index` and in-process incremental reindexes surface correctly.

### Patch Changes

- Updated dependencies [3d8474f]
  - @liendev/parser@0.45.0

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

### Patch Changes

- Updated dependencies [9fd617b]
  - @liendev/parser@0.44.0

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

### Patch Changes

- Updated dependencies [8384321]
  - @liendev/parser@0.41.0

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
