# @liendev/parser

## 0.66.0

### Patch Changes

- 8175bf5: Fix a silent indexing gap: small files with no top-level function/class/interface/declaration (e.g. a single bare `test(...)` call) could be dropped from the index entirely — no chunk, no manifest entry, no error.

  `chunkByAST`'s AST chunking recognizes functions, classes, interfaces, and declarations as top-level chunks, and falls back to an "uncovered code" chunk covering whatever wasn't recognized (imports, top-level statements, etc.). That fallback chunk was filtered out when it had fewer lines than `minChunkSize` (`chunkByAST`'s own default is 5, but production indexing always calls it via `chunkFile`, which computes 7 from `Math.floor(chunkSize / 10)` with the default `chunkSize` of 75) — a guard meant to suppress noise chunks for small leftover gaps _alongside_ real function/class chunks. But when a file has zero recognized top-level nodes, the single "uncovered" chunk covers the entire file, so the same guard silently dropped the whole file instead of just shrinking a gap. A 5-line file containing only `import`s and a bare `test('...', () => {...})` call — no exported function, class, or declaration — hit this exactly: it produced zero chunks and never appeared in the index manifest, so it was invisible to `get_dependents`, test-associations, and every signal that sweeps indexed chunks.

  The minimum-size guard is now skipped whenever a file has no other (top-level) chunks, so its single whole-file fallback chunk survives regardless of size — mirroring the existing bypass for barrel/re-export-only files. Empty and whitespace-only files are unaffected: they still produce zero chunks, because that path already (and separately) requires non-empty trimmed content.

  This changes what enters `repoChunks` for very small files (e.g. tiny standalone test files). It's sequenced ahead of any harness/corpus recalibration sweep so certified fixture corpora are captured post-fix.

## 0.64.2

### Patch Changes

- e2b0e24: remove dead branch/commitSha chunk-metadata fields
- 93191c4: refactor: remove never-functional cross-repo scaffolding

  Cross-repo MCP mode was never implemented in the SQLite era: `repoId` was
  computed in-memory but never persisted to the structural store, both
  backends hardcoded `supportsCrossRepo = false` with `scanCrossRepo()`
  stubbed to `[]`, and `lien serve` is one-repo-per-process — making every
  `crossRepo`/`repoIds` code path unreachable. Removes the always-false
  `supportsCrossRepo` flag and `scanCrossRepo()` stub from both backends and
  `VectorDBInterface`, the `crossRepo`/`repoIds` MCP tool parameters and their
  `groupedByRepo` response fields, the `repoId` field on `ChunkMetadata` and
  its plumbing through the chunkers, and the corresponding doc claims. No
  behavior change for the single-repo path.

- 8d1056c: refactor: remove dead orgId multi-tenant plumbing

## 0.64.1

### Patch Changes

- 12c70ad: refactor: single source of truth for re-export intersection logic

## 0.64.0

### Minor Changes

- c6abb00: feat(parser): chunk markdown by heading section as a 'doc' chunk kind

  Markdown files (`.md`/`.mdx`/`.markdown`) now chunk by heading section — the heading breadcrumb becomes the chunk's symbol name — instead of fixed 75-line windows. Chunking is fenced-code- and YAML-front-matter-aware and splits oversized sections, and chunks are tagged with a new `type: 'doc'`. This improves `search_code` / `get_files_context` retrieval of README, CLAUDE.md, and `docs/` content. Internally, a shared bounded-BFS graph primitive (`walkBounded`) is extracted into `@liendev/parser` and reused by the review engine.

## 0.62.0

### Minor Changes

- 2b2e259: **Breaking:** the `legacy` parser backend (`node-tree-sitter`) has been removed -- `@liendev/parser-native` is now the only backend (ADR-013 Phase 4-B).

  `LIEN_PARSER=legacy` now throws immediately, naming the release that removed it and pointing at `LIEN_PARSER=native` (the default, and now the only valid explicit value) instead of silently mapping to some other backend. If the native binding itself fails to load (no prebuilt package for your platform/arch and no local build), `parseAST` now throws a single actionable error instead of transparently falling back to legacy for the rest of the process -- there is no longer a fallback to fall back to. See `docs/architecture/native-parser.md` for how to build a local binding.

  `tree-sitter` and its 11 per-language grammar packages (`tree-sitter-c-sharp`, `tree-sitter-go`, `tree-sitter-java`, `tree-sitter-javascript`, `tree-sitter-kotlin`, `tree-sitter-php`, `tree-sitter-python`, `tree-sitter-ruby`, `tree-sitter-rust`, `tree-sitter-swift`, `tree-sitter-typescript`) are no longer dependencies of `@liendev/parser` -- installing it no longer compiles any native tree-sitter addon. Everything that previously typed against node-tree-sitter's `Parser.SyntaxNode`/`Parser.Tree` now uses `@liendev/parser`'s own `SyntaxNode`/`Tree` types (structurally identical; this only affects direct consumers of `@liendev/parser`'s AST types, not `@liendev/core`/`@liendev/lien`, which never touched them).

## 0.61.0

### Minor Changes

- e6efbb3: New package: `@liendev/parser-native`, a prebuilt napi-rs tree-sitter binding for 11 languages (see ADR-013 and docs/architecture/native-parser.md).

  `@liendev/parser` gains an opt-in `LIEN_PARSER=native` backend behind a compat deserializer that reconstructs `Parser.SyntaxNode`-shaped objects from the native wire format, so every existing traverser/extractor/complexity analyzer runs unmodified. Default remains `legacy` (node-tree-sitter) -- no behavior change unless the flag is set.

- a39644a: The native backend (`@liendev/parser-native`) is now the default parser -- prebuilt binaries, 1.8-2.2x faster end-to-end than the previous `node-tree-sitter` path. `LIEN_PARSER=legacy` remains available as a transitional opt-out (scheduled for removal in a future release). If no prebuilt native binary can be loaded for your platform, lien automatically falls back to the legacy backend for the session and prints a one-time warning explaining why and how to build one -- see ADR-013 (docs/architecture/decisions/0013-prebuilt-native-parser-napi-rs.md).

### Patch Changes

- 5789e1c: Cap parse/chunk-stage concurrency at 4, independent of the configured indexing concurrency.

  ADR-013 (prebuilt native parser) flagged a pre-GA memory risk: the native backend's transient JSON-serialized trees can be up to ~38x source size, and `indexing.concurrency`/`core.concurrency` accept up to 16 with no parse-stage file-size gate — 16 concurrent megabyte-scale parses measured ~1.55GB peak RSS, versus ~630MB at the default concurrency of 4.

  `@liendev/parser` now exports `getParseStageConcurrency()`, which clamps any requested concurrency down to `PARSE_STAGE_MAX_CONCURRENCY` (4) for the CPU-bound parse/chunk stage specifically. I/O-bound stages (file stat/hash walks) are unaffected and keep using the configured value directly. Applied everywhere a limiter wraps `chunkFile`: `performChunkOnlyIndex` (parser), the full-index and incremental-index pipelines, and the worktree-overlay build (which previously shared one limiter across its I/O-bound hash-diff phase and its CPU-bound chunk phase -- now split into two). Parsing is synchronous on the JS thread, so this cap costs negligible wall-clock time; it only bounds how many source buffers and parsed trees are alive at once.

- Updated dependencies [e6efbb3]
  - @liendev/parser-native@0.61.0

## 0.59.0

### Minor Changes

- 68e98ef: Resolve workspace package specifiers (`import { X } from '@scope/pkg'`) to the package's source entry file during chunking, closing a monorepo blind spot in dependency analysis. Previously, imports written as a workspace package specifier (rather than a relative path) were stored raw and never matched any indexed file, so `get_dependents` couldn't see across package boundaries in npm-workspaces monorepos — e.g. a CLI package consuming a symbol from a sibling library package showed 0 dependents.

  Workspace packages are now detected generically from the root `package.json`'s `workspaces` globs (supporting nested globs and negated excludes) and each member's declared source entry (`main`/`module`, falling back to the `src/index.<ext>` convention) — nothing is hardcoded to `@liendev`. The resulting map is applied the same way `./`/`../` specifiers already are, so file-level dependents, the transitive re-export BFS, and symbol-level usage tracking all pick up cross-package edges automatically. Deep/subpath imports (`@scope/pkg/subpath`) are out of scope for this pass and continue to pass through unresolved. Non-monorepo projects and external npm packages are unaffected.

## 0.58.0

### Minor Changes

- 6e502dd: `lien delta` Phase 2 — surface the complexity-delta verdict at the moment of the edit.

  Phase 1 made the verdict available as a gate the agent chooses to run. Phase 2 moves it to edit time via two advisory (non-blocking) mechanisms, plus fixes for five review findings on the Phase-1 code.
  - **PostToolUse edit hook** (`plugins/claude/hooks/delta-write.sh`, registered in the Claude Code plugin): after an `Edit`/`Write`/`MultiEdit`, computes the complexity delta for just that file and emits an `additionalContext` warning **only** when the edit introduces a NEW threshold crossing. Silent otherwise. Driven by a new single-file fast path.
  - **`lien delta --file <path>`**: analyze one file vs `HEAD` (instead of scanning the whole working tree) — bounds the per-edit hook to the file that changed. Resolves absolute-or-relative paths and canonicalizes symlinked segments; out-of-repo, unsupported, or absent files produce no output.
  - **`get_files_context` complexity headroom**: the response now includes a lean `complexityHeadroom` array listing functions at ≥ 80% of a cyclomatic/cognitive budget (worst-first, capped, with an overflow count), computed from complexity metrics already stored in the index (no re-parse). It lets an agent steer around near-budget functions before editing. Omitted entirely when nothing is near budget.
  - **Phase-1 review-finding fixes** in the shared primitive and CLI: a still-over-threshold decrease is now `pre-existing` rather than `improved` (`classifyMetric` is exported for testing); `--threshold` requires a positive integer (rejects negatives/floats/zero → exit 2); a config-load failure exits 2 instead of crashing; single-file reads only treat `ENOENT` as "deleted"; and Halstead-effort display floors rather than rounds so it can never overstate past a limit.

## 0.57.0

### Minor Changes

- d36fb55: Add `lien delta` — flag NEW complexity threshold crossings before commit.

  Lien already scores per-function complexity and reports threshold violations in PR review, but only _after_ code is pushed. `lien delta` moves that signal to edit time: a ~50 ms deterministic check that compares the working tree against `HEAD` and fails only when a change pushes a function's complexity over a threshold it was under before (a new-over-threshold or crossed function). Improving, or merely touching, a pre-existing violation never fails.
  - **Shared primitive** `computeComplexityDelta` in `@liendev/parser` computes per-function before/after verdicts (`crossed`, `new-over-threshold`, `worsened`, `pre-existing`, `improved`, `unchanged`, `new-under-threshold`, `removed`) from two content strings, reusing the existing complexity machinery (`chunkFile` + cyclomatic/cognitive/Halstead metrics). Because the PR-review engine depends on parser only, it can adopt the same primitive so write-time and review-time verdicts never structurally disagree.
  - **`lien delta` CLI** compares the working tree vs `HEAD` across changed files (staged + unstaged + untracked, with rename and unborn-HEAD handling), prints a concise per-function crossing table, and uses gate-friendly exit codes: `0` clean (or `--soft`), `1` on new crossings, `2` on operational failure. Thresholds come from `.lien.config.json`'s `complexity.thresholds` (the same source PR review reads), overridable with `--threshold`.

## 0.52.0

### Patch Changes

- 297883e: Exclude `.claude/worktrees/**` from indexing by default. Claude Code agent
  worktrees are full nested repo clones used as scratch space — indexing them
  duplicates the entire project once per worktree (seen in production: ~30
  worktrees produced a 21 GB index and pegged 8 CPU cores). This directory is
  now added to `ALWAYS_IGNORE_PATTERNS`, the shared exclude list used by the
  scanner, watcher, and gitignore filter, so it's never indexed regardless of
  user configuration — the same treatment `node_modules/**` and `.lien/**`
  already get.

## 0.51.2

### Patch Changes

- 57d1529: Honor the `LIEN_HOME` environment variable for Lien's global store (`~/.lien/indices/*`, `~/.lien/config.json`), via a new `getLienHome()` helper in `@liendev/parser`.

  `LIEN_HOME` has been documented in the configuration guide ("Index location") since it was written, but nothing in the code ever read it — every store-path resolver (`VectorDB`, `loadGlobalConfig`/`saveGlobalConfig`/`mergeGlobalConfig`, `lien path --store`, `lien status`, `lien config`) called `os.homedir()` directly. This patch makes the documented override actually work, and falls back to `os.homedir()` when `LIEN_HOME` is unset, so behavior is unchanged for anyone not setting it.

  This was discovered while fixing a test-hygiene bug: test suites across `packages/core` and `packages/cli` were writing real indices into `~/.lien/indices/` on every run and never cleaning them up (thousands of leaked `test-*`/`lien-test-*`/`lien-bench-*` directories accumulate over time). Tests now set `LIEN_HOME` to a per-run temp directory via a new vitest `globalSetup` in both packages, so all index/config I/O during a test run is isolated and removed automatically in teardown — no more manual per-suite cleanup needed.

## 0.50.0

### Minor Changes

- e81a04d: Fix Python AST chunking to handle decorated functions, methods, and classes. Previously any `@decorated` function/method (Flask routes, FastAPI endpoints, `@staticmethod`, `@property`, dataclasses, etc.) collapsed into an anonymous chunk with no symbol name, type, complexity, or call sites - and decorated methods nested in a class body were dropped from indexing entirely. Decorators are now unwrapped to their inner definition so decorated code gets the same semantic metadata as undecorated code, with the decorator source folded into the signature.
- 356c2f4: Fix TypeScript abstract classes not being chunked. tree-sitter-typescript parses `abstract class Foo {}` as a distinct `abstract_class_declaration` node (and an unimplemented method as `abstract_method_signature`), separate from `class_declaration`/`method_definition`. Neither was recognized by the traverser, so an abstract class collapsed into a single anonymous `block` chunk and its methods didn't exist as searchable symbols. Abstract classes now chunk like regular classes: the class itself is a named `class` symbol, concrete methods keep their body/complexity, and abstract method signatures are extracted sanely (no body to measure, so complexity defaults to a baseline of 1).

## 0.48.2

### Patch Changes

- 48e0fab: Deduplicate the identical JS/TS complexity configuration into a shared `jsTsComplexityConfig` const referenced by both language definitions. No behavior change.

## 0.48.0

### Minor Changes

- 9642c43: feat: add Swift AST support

  Swift (`.swift`) now uses full Tree-sitter AST parsing instead of line-based
  chunking — symbols, imports, call sites, complexity, and test associations —
  bringing the count of AST-supported languages to 11. struct/class/actor/enum/
  extension are recognised (keeping the keyword in the signature), protocols map
  to interfaces, and `Tests/` directories / `*Tests.swift` files are detected as
  tests. Validated with an e2e index of SwiftyJSON.

## 0.47.0

### Minor Changes

- fe4ba43: Add Kotlin AST support.

  Kotlin `.kt` files now get full structural parsing instead of the line-based
  fallback, bringing Kotlin to parity with the other AST-supported languages
  (TypeScript, JavaScript, Python, PHP, Rust, Go, Java, C#, Ruby):
  - **AST chunking** — one semantic chunk per `fun` / `class` / `object` /
    `interface` instead of fixed line windows.
  - **Symbols** with clean signatures (`fun <T> map(t: T): R`, `suspend fun
fetch()`, `object Registry`, `enum class Color`), including expression-body
    functions (`fun f() = expr`).
  - **Imports** from `import` declarations (incl. wildcard `import a.*` and
    aliases `import a.B as C`); `kotlin.*` / `java.*` filtered, but external
    `kotlinx.*` libraries are kept as dependency edges.
  - **Exports** — public-by-default visibility (top-level and member declarations
    unless `private` / `internal`).
  - **Complexity metrics** counting `when`, `if`, loops, `catch`, elvis, and the
    `&&` / `||` operators.

  The `tree-sitter-kotlin` grammar exposes no field names, so symbols are located
  by node type rather than via field accessors.

## 0.46.0

### Minor Changes

- 29ac90c: Add Ruby AST support.

  Ruby `.rb` files now get full structural parsing instead of the line-based
  fallback, bringing Ruby to parity with the other AST-supported languages
  (TypeScript, JavaScript, Python, PHP, Rust, Go, Java, C#):
  - **AST chunking** — one semantic chunk per `def` / `class` / `module` instead
    of fixed line windows.
  - **Symbols** with clean signatures (`def self.new(app, options = {})`),
    methods and `singleton_method`s, classes, and modules.
  - **Imports** from `require` / `require_relative` / `load` / `autoload`, feeding
    dependency-graph resolution (`get_dependents`).
  - **Test associations** — `*_spec.rb` / `*_test.rb` and `spec/` directories are
    recognized.
  - **Complexity metrics** for Ruby control flow. (Known v1 limitation: logical
    operators `&&` / `||` are not yet counted.)

  Also fixes a latent `extractSignature` bug for no-brace languages (Python and
  now Ruby): signatures are bounded by the function body node rather than scanning
  for a brace, so multiline/no-brace declarations no longer pull their whole body
  into the signature.

## 0.45.0

### Minor Changes

- 3d8474f: Ship the Claude Code plugin and a saga of fixes for branch-switch reconciliation in `lien serve`.

  **Claude Code plugin** (#555). Install once with `/plugin marketplace add getlien/lien` + `/plugin install lien` and Lien's MCP tools + the Explore agent are available in every session, in every repo — no per-project `lien init` needed. The `serve` command also gains an `LIEN_FORCE_INDEX=1` opt-in and skips auto-indexing in non-git directories so the plugin doesn't index scratch dirs.

  **Branch-switch reconciliation, full saga (#556).** When you `git checkout` away from a branch that had files which don't exist on the new branch, Lien now actually drops the chunks for those files from the index. Required three-layered fixes:
  - **Path-key normalization** (#557): `indexMultipleFiles` and `indexSingleFile` now thread `rootDir` through `normalizeToRelativePath`, so chunks at index time and deletion time use the same relative-path key. `indexedBranch` / `indexedCommit` are surfaced in `indexInfo` so callers can detect drift.
  - **Tip-to-tip diff** (#559): `getChangedFiles` switched from three-dot (`A...B`, "PR-diff" semantic — silently omits files that exist only on `A`) to two-dot (`A..B`, direct tip diff). Also fixes a false-prefix bug in `normalizeToRelativePath` where `/apple/foo` against root `/app` would slice to `le/foo` instead of falling through to `path.relative`.
  - **Always-on git poll** (#561): the `.git/HEAD` file watcher misses git's atomic ref rewrites (chokidar/FSEvents on macOS reports the rename of `.git/HEAD.lock`, not a change event on `HEAD` itself), so the existing event-driven trigger never fired in practice. `createGitPollInterval` now runs alongside the file watcher as a backstop instead of only as a `--no-watch` fallback. Includes a fix for the `detectChanges`-already-advanced-state race when both watcher and poll fire concurrently.

  **Freshness metadata** (#562). `indexInfo.indexDate` and `msSinceLastReindex` now reflect the most recent reconciliation (max of version-file timestamp and in-session reindex timestamp), so both external `lien index` and in-process incremental reindexes surface correctly.

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
