# @liendev/lien

## 0.80.2

### Patch Changes

- 3c2a063: **C# declarations inside `#if ... #endif` are no longer invisible.**

  Anything wrapped in a conditional-compilation block produced **no chunk and no
  symbol at all** — so `lien complexity`, `lien health` and `lien review` were
  blind to it. The grammar wraps such code in a `preproc_if` node, and
  `CSharpTraverser.shouldTraverseChildren` did not treat that as transparent, so
  the traversal never descended into it. The file still parsed fine; its
  contents simply never reached the index.

  Measured on `serilog/serilog` (216 `.cs` files), files collapsing to a single
  symbol-less whole-file chunk:

  ```text
  before: 16
  after:   9
  ```

  Seven files recovered. The nine that remain are seven legitimately trivial
  ones (`GlobalUsings.cs`, `AssemblyInfo.cs`, a top-level-statements
  `Program.cs` — nothing to extract) and two that root in a tree-sitter `ERROR`
  node, which is a grammar limitation and tracked separately.

  **It also affects members, not just top-level declarations.** A
  conditionally-compiled method inside a class body sits at
  `declaration_list > preproc_if > method_declaration`, which was the same
  blindness — and a far more common shape in real C# than a whole type inside
  `#if`. That case is fixed by the same change and has its own test.

  **`#if`/`#else` takes the first branch only, deliberately.** The grammar
  _nests_ `preproc_elif`/`preproc_else` inside `preproc_if`, so making those
  transparent too would extract the same logical declaration once per branch —
  `class Impl` twice for a plain `#if/#else`, three times with an `#elif`.
  Duplicate symbols with one name are fabrication, which is a worse failure than
  omission and something this repo has already paid for once (#1056: two
  unrelated files reporting an identical 144-file dependent list). Choosing the
  _correct_ branch would require knowing the build configuration, which a parser
  reading a single file cannot. So: first branch, deterministically, and the
  `#else` branch stays unindexed. Pinned by tests.

  `#region` needed nothing — `preproc_region`/`preproc_endregion` are siblings
  of the declarations they visually wrap, not parents, so they never hid
  anything. Verified against the grammar and pinned by a test, so nobody
  "completes" this fix by adding them and reintroducing the duplication risk for
  no gain.

  Fixes the tractable half of #970. The remaining half — a declaration split
  mid-signature across `#if`/`#else`, which makes tree-sitter root the whole
  file in `ERROR` (`ILogger.cs`, 1,371 lines, and `PropertyBinder.cs`) — needs a
  grammar upgrade or a preprocessing pass and is out of scope.

- Updated dependencies [3c2a063]
  - @liendev/parser@0.80.2

## 0.80.1

### Patch Changes

- 396d472: **`lien health` no longer calls a function "contained" when it never resolved
  the function's callers.**

  On a language `lien health` resolves no fan-in for, it reported the honest
  thing in its coverage footer and then contradicted it one line above:

  ```text
    1  Sources/Demo/Config.swift:13  classify
       mental load 28 · imported by 0 · no tests
       Complex, but contained — little depends on it.      ← wrong
       → simplify when you are next in here                ← wrong advice

    Coverage
      no fan-in found   swift (5)
                        ranked on complexity and tests only — not judged safe
  ```

  `Config` is used by every other file in that module. Swift's `import` names a
  module, not a file, and same-module declarations need no import at all — so
  there is no import edge to resolve, and `dependentCounts` has no entry for the
  file. `dependentCounts.get(file) ?? 0` turned "we did not look" into "we looked
  and found nothing," and `classifyShape` then read the resulting `0` as a small
  blast radius.

  Now:

  ```text
       mental load 28 · fan-in not resolved · no tests
       No fan-in found for this language here — blast radius unmeasured.
       → find the callers yourself before changing it
  ```

  **The ranking was wrong too, which is the part that survives any wording fix.**
  `scoreRisk` damps by `1 + log2(1 + dependents)`, so an unmeasured entry scored
  as if genuinely isolated. A widely-used Swift function therefore sorted _below_
  a contained TypeScript one of equal complexity, and with a default top-5 could
  drop off the list entirely. Fixed via `SHAPE_PRIORITY` rather than the score:
  the new `unknown-fan-in` shape sorts above `cheap-win` and `isolated` — which
  are judgements that the blast radius is small or manageable, and an unmeasured
  entry has not earned either — and below `dangerous`/`expensive`, because a
  measured wide blast radius outranks an unmeasured one.

  Changes:
  - `RiskEntry.dependents` is now `number | null`. In `--format json`,
    unmeasured fan-in serializes as `null`, not `0`; `"dependents": 0` was a
    false statement of fact, and `null` forces a consumer to consult
    `coverage[]`.
  - New `RiskShape` member `unknown-fan-in`, decided before the `widelyUsed`
    comparison so an unmeasured entry can never fall through to `isolated`.
  - `buildEntries` takes the unresolved-language set from
    `unresolvedFanInLanguages(computeCoverage(...))` — the coverage rows the
    footer already prints, so the ranking and the footer cannot disagree about
    which languages resolved. It is a required parameter: defaulting it would
    reinstate the bug at any call site that forgot it.

  Per-language, not per-run: a repo mixing a resolved language with an
  unresolved one gets real counts for the first and `null` for the second.

  The coverage footer's wording is corrected alongside this. It said unresolved
  languages were "ranked on complexity alone", which was never true — `scoreRisk`
  applies its untested 2× multiplier regardless of fan-in, so an untested entry
  always outranked a tested one of equal complexity. It now says "complexity and
  tests only". The behaviour is deliberate and unchanged: fan-in is the single
  unmeasured axis, and throwing away the two that _are_ measured would rank
  worse, not more honestly.

  **Deliberately unchanged:** a language that _did_ resolve fan-in keeps `0` for
  a file with genuinely no importers, and still reads as `isolated`. Verified on
  this repo — output is byte-identical. Turning a genuinely contained function
  into a false alarm is the failure mode this must not introduce, and there is a
  test pinning it.

  The wording stays observational. `computeCoverage`'s contract is "reports what
  happened, never what is possible" — a language whose files genuinely never
  reference each other is indistinguishable from one Lien cannot resolve, so the
  new text says no fan-in was _found here_, never that the language is
  unsupported. A test asserts the string avoids both `contained` and
  `cannot`/`unsupported`/`never`.

  This is `No-Data Honesty` one level below where it was enforced. The rule was
  gated per _scan_ (`describeScanFailure`/`describePartialScan`); this was the
  same failure per _language_, and `computeCoverage`'s docblock already promised
  the guarantee this delivers: _"a language with no resolved fan-in is never
  silently ranked as safe."_

  Also: `health-cmd.test.ts`'s `report()` helper hardcoded
  `language: 'typescript'` on every violation, so no test could express a
  violation in another language — which is why nothing here could have caught
  this. `language` is now an optional per-violation field defaulting to
  TypeScript.

  Fixes #1137. Independent of #1005 (Swift resolves 0 dependency edges) and #869
  (no per-file test associations for whole-module-import languages): those are
  the cause, this is the conclusion drawn from their result, and it would remain
  a bug for any future language without a recovery tier.

## 0.80.0

### Minor Changes

- 9175b1d: **`@liendev/core` is no longer published.** What the CLI still used from it now
  lives inside the CLI; the rest is deleted.

  `@liendev/core` began as the indexing and analysis engine. Everything that made
  it an engine — the SQLite structural store, the indexer, index GC, FTS5 lexical
  search, embeddings — was removed along with the MCP server. What was left was
  2,102 lines of support code, of which the CLI reached exactly three modules:

  | Module                                     | Where it went                           |
  | ------------------------------------------ | --------------------------------------- |
  | `config/` (`.lien.config.json` thresholds) | `packages/cli/src/config/`              |
  | `errors/` (typed errors, `isLienError`)    | `packages/cli/src/errors/`              |
  | `insights/formatters/` (text/JSON/SARIF)   | `packages/cli/src/insights/formatters/` |

  The rest was unreachable and is gone — 1,068 of those 2,102 lines, across 15 of
  24 files: `git/` (`GitStateTracker`, `detectLinkedWorktree`, git helpers),
  `types/`, `constants.ts`, all six `utils/` modules, and the `src/test/`
  helpers. These were not arbitrary casualties —
  each existed to serve the index. `GitStateTracker` recorded the commit an index
  was built at so it could be invalidated; `detectLinkedWorktree`, `getLienHome`
  and `extractRepoId` located the right index directory for the current worktree.
  With no index, none of them has a caller. `lien delta` and `lien review` do
  their own git work in `cli/delta-git.ts`, and the project root is resolved from
  the `.git` marker alone — which is correct inside a linked worktree too, where
  `.git` is a file rather than a directory.

  **If you depend on `@liendev/core` directly:** version 0.79.0 stays on npm and
  keeps working, but it will not be published again. Everything analytical —
  chunking, complexity, dependency resolution, review signals — is in
  `@liendev/parser`, which is unchanged and remains published. The config, error
  and formatter modules were always CLI-internal support rather than a library
  API, and they are now internal in fact as well as intent.

  Also in this release:
  - **A latent broken import, surfaced by the move.** The three formatter test
    files imported `ComplexityReport` from `../types.js` — a module deleted back
    in #278. It never failed: core's `tsconfig.json` excluded `**/*.test.ts`, and
    `import type` is erased before it can fail at runtime. The CLI's tsconfig
    includes its tests, so the move turned it into a hard error. Now imported
    from `@liendev/parser`, which owns the type.
  - **The post-publish registry smoke test no longer probes a package that isn't
    installed.** `.github/scripts/registry-smoke.sh` imported both
    `@liendev/core` and `@liendev/parser` from a fresh install to catch
    resolution skew. With core gone from the CLI's dependencies that import
    would fail on every release — and this script runs _after_ an immutable
    publish, so it would have reported a broken release that was fine. It now
    probes parser, the only published sibling the CLI resolves.
  - **Two stale workspace entries pruned from `package-lock.json`** —
    `packages/core` and `packages/embeddings`, the latter dead since embeddings
    were removed. `npm install --package-lock-only` marks a deleted workspace
    `extraneous` but never prunes it, so these accumulate silently.
  - **Index-era dead code that rode along inside the moved modules is gone too.**
    Deleting at module granularity meant three modules moved wholesale, dead
    symbols included: `IndexingError` and `DatabaseError` (defined, never
    constructed — the latter names a database deleted two phases ago), the
    `INDEX_NOT_FOUND`/`INDEX_CORRUPTED` error codes, and the barrel's
    `formatTextReport`/`formatJsonReport`/`formatSarifReport` re-exports, which
    existed to feed core's public API. Nothing outside `src/insights/formatters/`
    imported them; `formatReport` is the entry point.
  - `@liendev/parser` gains no code changes. Its docblocks described themselves
    in terms of core (`scanFilesToIndex`, "parser must NOT import
    `@liendev/core`", a doc-matching primitive shared with two call sites that
    are both deleted). Those now describe what is actually there.

### Patch Changes

- Updated dependencies [9175b1d]
  - @liendev/parser@0.80.0

## 0.79.0

### Minor Changes

- e8a5e2c: **Removes the MCP server, the persisted index, and lexical search.** This is the breaking change of the simplification arc. It is kept at `minor` because these packages are pre-1.0 and a series of removals is in progress; on a 1.0 line it would be `major`. Read it as breaking regardless.

  `lien` is now a local CLI that parses the working tree on demand. The entire command surface is four commands:

  | Command           | Answers                                                                    |
  | ----------------- | -------------------------------------------------------------------------- |
  | `lien health`     | Which functions are risky to change? (complexity × fan-in ÷ test coverage) |
  | `lien delta`      | Did this change push a function over a threshold it was under before?      |
  | `lien review`     | What deterministic signals fire on this diff?                              |
  | `lien complexity` | Where is the tech debt?                                                    |

  **Gone from `@liendev/lien`:** the MCP server and its six tools (`search_code`, `find_similar`, `get_files_context`, `list_functions`, `get_dependents`, `get_complexity`), plus `lien serve`, `lien index`, `lien status`, `lien gc`, `lien path`, `lien annotate`, `lien api-delta`, `lien stats`, `lien recap`, `lien verify-tests` and `lien config`. **An editor configured against `lien serve` will fail to start it.** There is no replacement for that integration — the questions Lien still answers are answered by running a command, not by an agent calling a tool.

  **Gone from `@liendev/core`:** `createVectorDB`, `OverlayBackend`, `VectorDBInterface`, `SearchResult`, `indexCodebase`, `buildOverlay`, `ManifestManager`, `ComplexityAnalyzer`, the whole `gc/` surface (`planGc`, `runGc`, `getIndicesRoot`, …), `getIndexDir`, `loadGlobalConfig`/`saveGlobalConfig`/`GlobalConfig`, and the version-file helpers. What remains is per-project config (`configService`, reading `complexity.thresholds` from `.lien.config.json`), git state and linked-worktree detection, typed errors, report formatters, and small shared utilities. Anything analytical now lives in `@liendev/parser`, which is unchanged.

  **Dependencies dropped:** `@modelcontextprotocol/sdk`, `chokidar` and `zod-to-json-schema` from the CLI; `better-sqlite3`, `@types/better-sqlite3` and `p-limit` from core. `better-sqlite3` was the last native module outside the parser, so **`@liendev/core` no longer needs a compile step to install**.

  **Also removed: the nudge/recap/stats/verify-tests telemetry.** This was scheduled for a later release, but deferring it would have shipped a lie. `lien verify-tests` recorded "you edited this file, here are its tests, did you run them" — and the association lookup read the index. Without it, the ledger records an empty test list, and `lien recap` reports no unresolved risk because nothing can record any. A command that reports "nothing to worry about" when it means "I cannot see anything" is the exact failure this project has a written rule against, so the family goes with the capability it depended on.

  **One capability is narrowed, and the earlier draft of this note overstated it.** What is gone is `lien annotate`'s on-demand lookup — "name any file, get its tests" — which read the index, along with the extra resolution tiers only it used (Go tier-2, Swift symbol-usage, C# type-reference). The file-to-tests mapping itself survives: it lives in `@liendev/parser` as `findTestAssociationsFromChunks`, is chunk-in/chunk-out, and never read the store. `lien health` prints real test paths for the functions it ranks, and `lien review` computes associations for changed files, though it surfaces only which changed files have none. What no surviving command does is answer the question for an arbitrary file you name.

  Removing a persisted index also removes a class of bug that came with it: an index that disagrees with disk, a stale answer that looks fresh, and the whole four-state honesty apparatus built to detect that. Every answer is now computed from the files as they are when you ask.

### Patch Changes

- 4e2be28: **`lien review` no longer reports deleted files as parse failures.**

  A diff that deletes files sent every one of them into the set `review` tried to parse, and a deleted file has no working-tree content — so they came back as failures. On a large deletion the report read:

  ```
  lien review — 94 changed file(s) vs origin/main
  Not examined:
    92 files could not be parsed and were not examined
  ```

  All 92 were simply gone from disk. Zero were genuine parse failures, and a reader has no way to tell that from a broken parser.

  Deletions now get their own line, and are excluded from the reviewed set rather than silently dropped — a deletion diff is mostly deleted files, so a reader seeing a small "changed files" count on a large PR should be told why:

  ```
  lien review — 4 changed file(s) vs origin/main
  Not examined:
    26 changed file(s) are not parser-analyzable ...
    2 changed test file(s) were excluded ...
    217 deleted file(s) — nothing to parse, so not reviewed.
  ```

  `lien delta` never had this problem: it reads `git diff --name-status` and renders deletions as `· removed`. `lien review` parsed the raw unified diff, where `deleted file mode` blocks look like any other changed file.

  Also in `@liendev/parser`: its README described the package as providing "capabilities used by Lien's lexical code search" and existing "to enable lightweight consumers (like `@liendev/review`)". Lexical search and that package have both since been removed, so the npm page described the library in terms of two things that no longer exist. It now says what the package actually is.

- Updated dependencies [4e2be28]
- Updated dependencies [e8a5e2c]
  - @liendev/parser@0.79.0
  - @liendev/core@0.79.0

## 0.78.0

### Minor Changes

- 7dc6562: Add `lien health`, which ranks the functions that are risky to change rather than listing everything over a threshold.

  `lien complexity` orders violations by how far over a line they sit, which says nothing about whether anything depends on the code or whether a test would catch you breaking it. `lien health` joins three axes — cognitive complexity, fan-in, and test associations — and prints five, with the shape of that triple driving the recommendation: complex and widely depended on and untested means test it first; the same with tests means split before extending; simple but widely depended on and untested is a cheap win.

  It reads the working tree directly, with no persisted index, and never exits non-zero because of what it found — `lien complexity --fail-on` and `lien delta` remain the gates. (A bad flag still exits 1, as any CLI should.) Flags: `--top`, `--path`, `--include-tests`, `--format text|json`.

- fc12f45: `lien complexity` now parses the working tree instead of reading the persisted index, so it works in any repo without `lien index` having been run first — including a fresh linked worktree, which previously reported "Index not found". It can no longer report a stale answer, because there is no stored state to go stale.

  It stays gate-shaped: a run that finds nothing to analyze is a hard error, not a confident "0 violations". A failed parse produces the same false-clean result an empty index used to, so the check moved rather than disappeared.

  Run from a subdirectory, `lien complexity` and `lien health` now resolve the repository root instead of analysing that subtree alone. A subtree analysis looks like a perfectly normal report while silently understating every dependent count, and for a gate that meant `--fail-on` verdicts on an arbitrary slice of the codebase.

  Two fixes in `@liendev/parser` that this exposed, both affecting `performChunkOnlyIndex` and therefore `lien health` as well:
  - **Chunk order is now deterministic.** Chunks were accumulated into one shared array from concurrent tasks, making their order depend on which file read finished first. Downstream that reached the `dependents` arrays in `--format json` and the result order in `--format sarif`, so an unchanged tree produced a different byte stream on every run — breaking the documented practice of diffing a committed JSON baseline, and churning code-scanning alert identity.
  - **Files above 5 MB are skipped**, matching the cap `lien index` has always applied, and the count is reported so a gate never silently drops a file from its corpus. An 8 MB source file cost roughly a gigabyte of memory to chunk, then exceeded the native parser's string limit, fell back to line-based chunking, and landed in the report carrying meaningless complexity metrics.

- fcefa82: Removes the Claude Code plugin and the commands that existed only to serve its hooks. These are breaking removals, kept at `minor` because this package is pre-1.0 and a series of removals is in progress; the 1.0 line is where they would be `major`.

  **Gone: the plugin.** `plugins/claude/` — 12 hook scripts, `hooks.json`, the plugin manifest — and `.claude-plugin/marketplace.json`, whose only entry pointed at it. `/plugin marketplace add getlien/lien` and `/plugin install lien` no longer work, and because marketplace-add resolves against the default branch rather than a release tag, they stop working the moment this merges rather than at the next publish. The docs site has been updated in the same change; if you have the plugin installed, `/plugin uninstall lien` then `/plugin marketplace remove getlien/lien` removes it.

  What the hooks automated is genuinely lost, not relocated: read annotation, a `lien delta` gate on writes, and a test-association reminder all fired at the tool boundary on every matching call. Two of the three have a command you can run yourself — `lien annotate` and `lien delta`. The test-association reminder has no replacement: no command maps a changed file to its tests, and `lien health` does not do this (it ranks functions that already have a complexity violation). Finding the tests for a change is manual now. And in every case the automatic invocation is gone, which was the part that made these fire whether or not anyone remembered. In this repo the review checks are collected in a skill at `.claude/skills/review/`.

  **Gone: `lien init`.** Its whole job was writing a six-line MCP server block into an editor's config file, and the MCP server it configures is itself being removed in the next release. Write the block by hand instead — [the installation guide](https://lien.dev/guide/installation) lists the exact file and JSON for Cursor, Claude Code, Windsurf, OpenCode, Kilo Code and Antigravity. The `--legacy` flag went with it; it selected a per-project setup that became the only setup once the plugin was gone, so it had nothing left to select. `inquirer` is no longer a dependency, since the interactive editor prompt was its only consumer.

  **Gone: `lien nudge`.** `note-shown` and `note-signal` existed for the deleted hooks to shell into, and had no other caller. `nudge doctor` diagnosed drift between the CLI and a live plugin hooks directory by checking for `nudge-signal.sh` — a file this release deletes — so after this change it could only ever report a false `critical` telling you to update a plugin that does not exist. The event store, `lien stats`, `lien recap` and `lien verify-tests` are unaffected: the shown→acted-on funnels still populate, from the narrower set of sources that are ordinary commands rather than hooks.

  **Fixed: `lien review` on a diff with nothing parser-analyzable.** A markdown-only diff has no analyzable files, and the text report asserted "No signal ran, so no signal found anything" off that empty set — while the documentation signals, which read the raw patch text rather than parsed files, had in fact run and found candidates. Both renderers now list them. Ten `--help` descriptions that advertised "(for hook scripts)", "(for the write hook)", "(for the plugin Stop hook)" and similar have been corrected, since there are no hooks to serve.

### Patch Changes

- 1b1aa68: **`lien serve` now warns that it is being removed in the next release.** This version is the last one that ships the MCP server, the persisted SQLite index and FTS5 lexical search; the next removes all three.

  The notice prints to stderr on every `lien serve` start — never to stdout, which carries the MCP protocol stream — and it cannot be suppressed. That is deliberate: an editor configured against `lien serve` will simply stop working when the next version lands, and a user who never sees a warning experiences that as a tool that silently broke.

  Nothing else changes. `lien serve` and every MCP tool behave exactly as before in this release.

  What replaces it is a CLI you run directly, with no server, no index and no editor configuration:

  | Command           | Answers                                                                    |
  | ----------------- | -------------------------------------------------------------------------- |
  | `lien health`     | Which functions are risky to change? (complexity × fan-in ÷ test coverage) |
  | `lien delta`      | Did this change push a function over a threshold it was under before?      |
  | `lien review`     | What deterministic signals fire on this diff?                              |
  | `lien complexity` | Where is the tech debt?                                                    |

  The MCP tools themselves — `search_code`, `get_dependents`, `get_files_context`, `list_functions`, `find_similar`, `get_complexity` — have no replacement. Use your editor's own search and your agent's own file-reading tools.

  If you need the server, pin this version: run `lien --version`, then `npm install -g @liendev/lien@<that version>`.

- Updated dependencies [fc12f45]
- Updated dependencies [c9fe9df]
  - @liendev/parser@0.78.0
  - @liendev/core@0.78.0

## 0.77.0

### Patch Changes

- 2d2bb2b: Add a Kotlin same-package test-association mechanism (#1005 Phase 2, Item 2), shipped in both `@liendev/parser`'s `findTestAssociationsFromChunks` (the shared engine — feeds `lien annotate`, blast-radius test-coverage risk, and the agent-review plugin) and `@liendev/lien`'s `get_files_context` MCP tool (its own separate implementation, mirroring the existing C# tier there).

  Like Java's own same-package test convention, a Kotlin test class commonly lives in the same package as its subject with no import connecting them at all — Kotlin's same-package visibility rule needs none. This reuses Phase 1's file-level `resolveJvmSamePackageDependents` (#1100), gated strictly to Kotlin (Java keeps its existing, separate path-based mechanism), and explicitly canonicalizes the query path against the index before resolving — a mismatched path form now resolves correctly instead of silently returning zero associations.

  Measured against a real Klaxon (Kotlin) clone: `lien annotate` on `Klaxon.kt`, the library's central class, went from reporting "No test coverage" to 53 real, same-package test files.

- Updated dependencies [8fc218a]
- Updated dependencies [85ef96f]
- Updated dependencies [03f33b8]
- Updated dependencies [5846748]
- Updated dependencies [2d2bb2b]
  - @liendev/parser@0.77.0
  - @liendev/core@0.77.0

## 0.76.0

### Patch Changes

- Updated dependencies [ab10e5a]
  - @liendev/parser@0.76.0
  - @liendev/core@0.76.0

## 0.75.6

### Patch Changes

- 206127d: fix(parser,cli,review): name the fallback behind an inferred dependent (#1018)

  `get_dependents`' `dependent-attribution-partial` caveat described C#'s
  type-reference fallback in every case, because `confidence: 'inferred'` was
  single-valued and the mechanism identity was discarded at the parser boundary.
  When #1039 added Go's root-package export lookup — same marker, same caveat
  reason — every recovered Go file was told _"its language, C#, lets real callers
  use its exports with no per-file import naming it at all"_ and that its
  dependents came from _"matching a uniquely-declared type name against other
  files' source text"_. Both false; measured on a real `go-chi/chi` clone, 24 of
  24 recovered edges across `context.go`/`mux.go`/`chain.go`.

  `@liendev/parser` now owns `INFERRED_DEPENDENT_MECHANISMS`, a `Record`-guarded
  table of the non-import recovery fallbacks and their canonical prose, and
  `DependentInfo.inferredVia` names the mechanism per dependent. Every
  consumer-facing surface — the caveat note, the caveat-reason text, the server
  instructions, the tool description and the docs page — derives from the table
  instead of restating it, so a third fallback is a compile error until its prose
  exists and then correct everywhere at once.

  `DependentInfo.confidence` is unchanged and still marks exactly what it did;
  `inferredVia` is additive. `review`'s `isPreciseProvenance` returns exactly what
  it returned for all seven tiers, now via a `Record<EdgeProvenance, boolean>` so
  an eighth tier can't default silently.

  Also fixes two doc-truth defects on the MCP tools page found while mapping the
  surfaces: `dependent-attribution-partial` was documented as C#-only, and
  `testAssociations[]` was documented as `{ testFile, confidence, method }` with a
  "Confidence Levels" section — a shape and vocabulary that exist nowhere in the
  code (the real field is `string[]`), attributed to a tool that never emitted the
  field.

  ADR-016 records why the three vocabularies #1018 named were not merged into one,
  and the routing rule for where a new honesty signal belongs.

- 1c0b7d8: fix: the `dependentCount` honesty note no longer fires on a worktree that has counts, and the remedy it prints now works (#1085, #1084)

  Two halves of the same lifecycle defect in #1072's honesty plumbing.

  **#1085 — a self-contradictory response.** In a linked worktree,
  `OverlayBackend.hasDependentCounts()` read only the worktree's OWN overlay flag,
  which is absent until that worktree has completed its own `lien index`. So a
  fresh worktree whose shared base had counts fully computed emitted "this index
  predates reverse-dependency counting" and dropped `dependentCount` from 100% of
  `search_code` results — while the base's counts were ranking the very results the
  note was attached to. Measured on MediatR: `Mediator.cs` at #1 with the boost on
  and #5 with `LIEN_STRUCTURAL_RANKING=off`, in the same worktree, with every count
  reported as omitted.

  That is the #1050/#1051 shape — asking one of two on-disk locations instead of the
  composition — and #1014's cost, since every agent session in a linked worktree got
  the note on its first search. The method now mirrors the two branches of
  `composedDependentCounts` exactly: the composed flag when set, and otherwise
  whatever the BASE store can prove about its own table, which is the store the read
  path is serving those numbers from. Not the row-count-of-the-merged-map reasoning
  review rejected on #1078 — that map is a merge and proves nothing; this asks the
  base store whether it computed counts over its own corpus. A resurrected stale
  count is real but it is staleness, deliberately uncaveated per #1072's case 4, and
  suppressing every count never fixed it — it only also lied about why.

  **#1084 — the note prescribed a remedy that did nothing.** The note says
  `Run "lien index" to populate them`, and the code comment claimed it "clears itself
  permanently after one index run". Neither was true on the upgrade path that
  produces the note: `lien index` found no content changes, printed "Index is up to
  date", and returned without writing the counts or the flag. Touching a file did not
  help either. Only `lien index --force` worked. Computing the counts is now a
  MIGRATION-completion step gated on `hasDependentCounts()`, so the next `lien index`
  after an upgrade completes it whether or not anything changed, and every run after
  that skips it on one meta lookup. #1071's freshness contract is unchanged: normal
  incremental editing still does not recompute whole-corpus counts, so counts still
  lag by at most one full index run. The version stamp is bumped only when a backfill
  actually ran, so a live `lien serve` reconnects rather than clearing the note while
  still serving an empty cached count map.

  `OverlayBackend` gains a public `backfillDependentCounts()` for the same migration
  over the composed `(base − masked) ∪ overlay` corpus, because `buildOverlay`
  returns before `applyRebuild` entirely when the overlay's signature already
  matches — so an overlay that had never composed counts previously had no path to
  them.

  `hasComputedDependentCounts` now tolerates either of its tables being absent, each
  clause independently, because `OverlayBackend` asks it about a base connection
  opened `{ readonly: true }` whose schema is frozen at whatever version wrote it. A
  store from between #1071 (which added `dependent_counts`) and #1072 (which added
  `store_meta`) has real rows and no flag table at all, and a missing flag TABLE must
  not hide the rows that prove a computation ran any more than a missing flag ROW
  does; a store predating both must answer `false` rather than throw, which is the
  crash #1071 already had to fix once.

  The note still fires, unchanged, for a store that genuinely never computed
  counts — including a worktree whose base never did either. That property is
  covered by explicit negative controls in
  `packages/cli/test/integration/index-state-matrix.test.ts`, which gains the
  crossing of its worktree and derived-data axes: the row whose absence is why this
  shipped.

- 8b573b2: `lien index` now refuses to index your home directory or a filesystem root (`/`, `C:\`, a Windows user-profile root) unless explicitly overridden with `--allow-unsafe-root`. This closes the incident behind #1025: running `lien index` from `$HOME` swept macOS Keychain databases, `.npm` debug logs, and Claude Code agent caches into a 10.5 GB index with no warning. The refusal names the exact path and the override flag; a genuine reason to index an unusual root is always one flag away.

  As defense in depth, an extra set of OS/credential exclusions (`Library/`, `AppData/`, `.npm/`, `.cache/`, `.claude/`, `.ssh/`, `.aws/`, `.gnupg/`, `*.keychain`/`*.keychain-db`) now applies whenever the indexed root IS the home directory itself — scoped so an ordinary project is never affected, even one with its own legitimate `Library/` directory (Arduino, Unity, some Java layouts) or one that simply lives directly under `$HOME` (`~/myproject`).

  Indexing also now skips any single file over 5 MB instead of chunking it whole — a backstop against the same disk-blowup class independent of path filtering, for a legitimately huge binary in an otherwise ordinary project just as much as for an overridden home-root scan.

  `lien status` now reports the index's on-disk size (`Index size:` in text output, `indexSizeBytes` in `--format json`), so an anomalously large index is visible instead of sitting unnoticed.

- Updated dependencies [206127d]
- Updated dependencies [761b3bc]
- Updated dependencies [1c0b7d8]
- Updated dependencies [8b573b2]
- Updated dependencies [761b3bc]
  - @liendev/parser@0.75.6
  - @liendev/core@0.75.6

## 0.75.5

### Patch Changes

- 81bdbd2: fix(parser): stop `get_dependents` re-scanning the whole import index once per dependent (#1075)

  A single `get_dependents` call on a high-fan-out file in a 6,356-file C# corpus
  (OrchardCore, `OrchardCoreConstants.cs`) took **166 seconds** — roughly 100x the
  documented per-call floor. Two minutes is a timeout in practice, not
  slow-but-usable, on the MCP tool the whole agent contract is built around.

  A CPU profile put 95.4% of that in one place, and it was not the re-export graph
  the issue suspected (`buildReExportGraph` accounted for 0.14%):
  `uncoveredProductionDependents` asks "does any test file import this?" once per
  production dependent, and answered it by re-running a full `findDependentChunks`
  scan of the **entire** import index each time. That is O(dependents x every
  indexed import): 1,131 dependents x 119k+ entries ≈ 135M `importMatchesTarget`
  calls, of which all but the test-file importers were discarded the instant they
  matched.

  Two fixes, both build-once/resolve-many, neither changing a matching decision:
  - The import index is projected once per call down to its **test-file
    importers**, deduplicated by (importer file, raw specifier) — 15,339 entries
    become 1,026 on OrchardCore. Each dependent then resolves against that, in the
    same two-branch (exact bucket, then fuzzy `importMatchesTarget`) order, and
    returns on the first hit instead of materializing every importer.
  - The four per-importer-file language decisions `importMatchesTarget` derives
    (#884 whole-module, #887 single-file, #929 Python bare-module, #1028 PHP
    namespace) are memoized per file path instead of re-running
    `detectLanguage` — and therefore `node:path`'s `extname` — four times for the
    same path on every single comparison. That derivation alone was 42% of the
    profile (`detectLanguage` 32.5% self, `extname` 10.2%). The registry it reads
    is frozen at module load, so the record is a pure function of the path.

  Same target, same 1,131 dependents, same `dependentAttributionPartial`:
  **166,009 ms → 437 ms** (five runs: 481/451/441/443/437 ms). The re-profiled
  call is now dominated by nothing in particular — the C# type-reference tier
  (0.18 s) and this counter (0.16 s) are the same order.

  Equivalence is proven, not asserted. `hasTestImporterBruteForce` is exported as
  the never-pruned oracle (the role `computeDependentCountsBruteForce` plays for
  #1071) and the pruned predicate is checked against it for **every file** of the
  eleven real corpora the CLI E2E matrix names, plus serilog and OrchardCore, and
  the full `findDependents` result is diffed field-by-field against a pre-change
  build across those same corpora at depth 1 and depth 3. Zero mismatches
  throughout. #1044's order-independent `reported`/`queued` BFS is untouched.

- dcb58b6: `search_code`'s ranking now demotes test files by a fixed 0.8x multiplier (borrowed from zoekt's `_test.go` ranker rule), on top of the existing structural-importance boost. Global-centrality measurements across real corpora repeatedly surfaced test helpers and fixtures above the real source they exist to test — e.g. a heavily-cross-referenced test-database helper outranking the production class it configures. The demotion nudges ties and near-ties; it never excludes a test file from results, and a query naming a test file directly still finds it. Set `LIEN_TEST_FILE_RANKING=off` to disable it independently of the existing `LIEN_STRUCTURAL_RANKING` switch.
- Updated dependencies [81bdbd2]
- Updated dependencies [dcb58b6]
  - @liendev/parser@0.75.5
  - @liendev/core@0.75.5

## 0.75.4

### Patch Changes

- 643745b: fix(core,parser): resolve `search_code`'s `dependentCount` with the real import matcher (#1071)

  `search_code`'s structural ranking boost was the identity function on most
  languages. `dependentCount` came from a private ~40-line resolver that
  understood only `./foo` and `../bar` specifiers, so every C#, Go, Rust and
  Swift file scored `0` — and `applyStructuralBoost(ratio, 0)` is exactly
  `ratio`. Its normalizer also treated a specifier's final dotted segment as a
  file extension, turning `org.junit.Test` into `org.junit`.

  `dependentCount` is now resolved by `importMatchesTarget` — the same guarded
  decision `get_dependents` makes, carrying the whole-module (#884),
  single-file-vs-package (#887), Python bare-module (#929), PHP namespace
  (#1028) and Rust exact-single-file (#1021/#1056) guards, plus the C#
  type-reference and Go root-package recovery tiers. Measured against pinned
  real corpora, files with a non-zero count: serilog (C#) 0% → 60%, OrchardCore
  (C#) 0.3% → 67%, gin (Go) 0% → 11%, anyhow (Rust) 0% → 35%, flask (Python)
  24% → 36%.

  Counts are precomputed into a new `dependent_counts` table at the end of a
  full index instead of being derived per query, so the query path got faster,
  not slower: count acquisition drops from 103 ms to 1.4 ms on a 53k-chunk
  corpus. The table is additive and created on open, so a standalone index
  built by an older version keeps the previous behaviour (every count `0`) until
  its next full index — no forced reindex. In a linked worktree the counts are
  computed over the composed `(base − masked) ∪ overlay` corpus, never the
  overlay alone, so a worktree gains real counts as soon as its overlay is
  rebuilt even while the shared base index is still on the old format.

  Also makes the C# type-reference dependents tier resolve from a one-pass
  inverted reference index rather than re-scanning every file's content per
  target, which is what makes it affordable in a whole-corpus pass and speeds up
  `get_dependents` on large C# repositories by an order of magnitude.

  Swift still resolves to `0` for every file: its whole-module `import
Foundation` form names no specific file, so there is nothing to resolve
  (#884). That is now a documented, tested zero rather than a silent one.

  Removes `computeDependentCounts` and `normalizeFileForCounts` from
  `@liendev/core`'s `vectordb/sqlite/dependent-counts` module — the broken
  resolver and the extension-strip that corrupted dotted specifiers. Neither was
  re-exported from the package's entry point (`@liendev/core`'s export map
  exposes only `.` and `./test`), so no external consumer could reach either and
  this is not a breaking change; it is recorded here because deleting a symbol
  should never be silent. `readDependentCounts`, `writeDependentCounts`,
  `getDependentCounts` and `refreshDependentCounts` replace them.

- 8b16fc3: fix(cli,core): stop `search_code` asserting `dependentCount` as fact (#1072)

  `search_code` published `metadata.dependentCount` on every result with no
  honesty machinery on any branch — no `attributionCaveat`, no `note`, no degraded
  marker — while `get_dependents` carried the full vocabulary for the same number.
  Four different situations rendered as the same bare `0`, and a consumer could not
  tell them apart.

  Each now gets the disposition it warrants, and only that:
  - **Genuinely nothing imports this file.** Unchanged: `dependentCount: 0`, no
    note, no marker. This is a real answer and #1014's cost was a caveat that
    fired on healthy sessions until it was trained out as noise. There is an
    explicit negative-control test for it.
  - **The language's import forms cannot name the file at all** (C#'s
    `global using` / namespace access, Java's and Kotlin's same-package
    visibility, Swift's whole-module `import Foundation`). The field is now
    **omitted** for that result, silently — an absent count is honest, a `0` is
    not. Gated on the existing `hasDependentAttributionBlindSpot` predicate in
    conjunction with a zero count, exactly as `get_dependents`'
    `dependent-attribution-incomplete` caveat is. A _positive_ count in those
    languages is kept: it is a real recovered floor.
  - **The counts were never computed for this store** (an index written before the
    `dependent_counts` table existed, where every count reads `0` for a reason
    that has nothing to do with the code). One response-level `note` naming
    `lien index`, plus omission on every result. One note per call, never one per
    result.
  - **The counts lag the working tree** by up to one full index run. Deliberately
    **no** response caveat: it is true on nearly every call and is an accepted
    trade for a soft ranking tie-breaker. Documented in `search_code`'s tool
    description and on `SearchResult` instead.

  No new confidence vocabulary: `AttributionCaveatReason`'s five reasons all
  describe a caller-supplied `filepath`, which neither of the two reported cases
  is, so this uses the tool's existing response-level `note` channel (#1018 tracks
  consolidating the three vocabularies that already exist).

  Core adds `VectorDBInterface.hasDependentCounts()`, backed by a new
  `store_meta` marker row written alongside the counts themselves. Presence of the
  marker — never the table being non-empty — is what makes a `0` trustworthy: a
  corpus whose counts are legitimately all zero is byte-identical to one where
  they were never computed, so the distinction has to come from stored state
  rather than from the shape of the result. Same reasoning, and same
  presence-not-emptiness rule, as `OVERLAY_META.DEPENDENT_COUNTS_COMPOSED`. The
  table is additive with `CREATE TABLE IF NOT EXISTS`, so no
  `INDEX_FORMAT_VERSION` bump and no forced reindex; an older index simply reports
  the new note until its next `lien index`.

  `SqliteBackend` accepts row presence as secondary proof (rows can only have been
  written over that store's own corpus). `OverlayBackend` deliberately does not:
  without the composed flag its read falls back to merging the base's counts, and
  that merge can resurrect an obsolete positive value for a file whose last
  importer this worktree masked, so row presence there is not evidence the numbers
  describe this corpus.

  Also exports a `simulatePreCountTrackingIndex` test helper from
  `@liendev/core/test`, so the never-computed state is reachable from
  `packages/cli`'s index-state matrix without that package taking a
  `better-sqlite3` dependency.

- Updated dependencies [643745b]
- Updated dependencies [8b16fc3]
  - @liendev/parser@0.75.4
  - @liendev/core@0.75.4

## 0.75.2

### Patch Changes

- e729cf7: Fix `lien complexity` reporting a false clean (exit 0, "no violations found") on a project that has never been indexed, and silently materializing an empty `structural.db` as a side effect — the worst possible gate failure mode, since `--fail-on error` is meant to be a CI gate.

  Root cause: `complexityCommand()` called `createVectorDB(rootDir).initialize()` before checking whether an index existed. `SqliteBackend.initialize()` unconditionally `mkdir`s the index directory and opens the database with `CREATE TABLE IF NOT EXISTS` (`schema.ts`'s `openDatabase`), which materializes a valid, empty store even for a project that was never indexed — and the existing `ensureIndexExists` check only caught a thrown exception, never an empty-but-valid result, so it never fired. The created store then made a subsequent `lien status` wrongly report the project as indexed.

  `lien api-delta` had already solved exactly this with a cheap, side-effect-free existence check (`hasStructuralIndex`, a plain `fs.access` on `structural.db`) run BEFORE ever calling `createVectorDB`. This consolidates that pattern into a shared `packages/cli/src/utils/index-freshness.ts` and applies it at every read-only call site that had the same bug:
  - `lien complexity` now checks `hasStructuralIndex` first and, on a missing index, prints the existing "Index not found" error and exits 1 — unconditionally, independent of `--fail-on` — without ever touching the database file.
  - `lien annotate` (both its full-annotation path and its `--tests-only`/`lookupTestAssociations` path, also used by `lien verify-tests note-edit`) had the identical bug: `createVectorDB(rootDir).initialize()` ran before the `hasData()` check that prints its own "no index found" warning, so a single `Read` or `Edit` in an unindexed repo silently created `structural.db` too. Since several of this plugin's own hooks (`augment-explore-task.sh`, `test-reminder.sh`) gate on "does `structural.db` exist on disk?" as their sole signal for "is this repo indexed?", that one side effect permanently flipped those hooks' gate open for the rest of the session, making them act on an empty index. Fixed the same way: check existence before ever calling `createVectorDB`.
  - `lien api-delta` now imports the shared `hasStructuralIndex` instead of keeping its own copy.

  Also added: `lien complexity` now warns (via `getIndexStalenessWarning`, reusing `lien status`'s existing "git state changed" detection against `.git-state.json`) when the on-disk index's recorded git state no longer matches the working tree, instead of silently serving stale results with no signal at all. `lien serve`'s auto-reindex machinery (`git-detection.ts`) doesn't run for this one-shot command, so this is a warning, not an auto-reindex — `lien status`'s own staleness check (`status.ts`) was refactored to share the same read (`readIndexGitState`) rather than re-deriving it a third time.

  A genuinely clean, up-to-date, indexed project is unaffected: `lien complexity` still reports "no violations found" at exit 0, and `lien index` still creates the store on a virgin directory exactly as before — only read-only commands that have no business creating index state were changed.

- 4703563: Fix three more instances of the fail-quiet defect class (#1029 Workstream 1) and build the detector that stops the class from recurring.

  **New instances fixed** (same disposition as #1031/#1034: a confident answer where the honest answer is "I don't know"):
  - **`get_complexity` (MCP tool)**: a whole-repo scan (no `files` filter) over a structural store with zero rows reported "0 files analyzed, 0 violations" with no indication the store was empty — indistinguishable from a genuinely clean, fully-indexed codebase. Now adds the same `⚠ Lien: ... no data` note `search_code`/`list_functions` already give.
  - **`find_similar` (MCP tool)**: 0 results on an empty structural store got the generic "ensure your snippet is representative" note — the same one a healthy index gives for a real 0-match query. Now escalates to the unmissable no-data note when `hasData()` is false.
  - **`lien api-delta`**: an index directory that exists but has zero rows (cleared, moved aside, mid-rebuild) sailed past the existing `hasStructuralIndex` check and reported a real-looking `enriched: true, dependentCount: 0` instead of degrading like a never-indexed project does.
  - **`lien annotate`**: `reportUnresolvedPath` (a typo'd/nonexistent path) skipped the `hasStructuralIndex` pre-check the file's other two call sites already have, silently materializing an empty `structural.db` as a side effect on a virgin project.
  - **`lien complexity`**: extended to catch S1 (index directory exists, store has 0 rows) as a hard error — previously only S0 (no index at all) was caught.

  **The detector**: `packages/cli/utils/index-freshness.ts` (from #1031) gains a `classifyIndexState` function consolidating the S0 (no index) / S1 (empty store) / S2 (stale vs. HEAD) ladder in one place. `packages/cli/test/integration/index-state-matrix.test.ts` is a new table test asserting every read-only, index-backed entry point's actual response against a real `SqliteBackend` (no mocking) across every state that applies to it, with a completeness guard that fails the build if a new `createVectorDB` call site or MCP tool handler isn't accounted for.

  Policy documented in CLAUDE.md and `docs/architecture/index-state-honesty.md`: the right response differs by command disposition (gate-shaped commands hard-error on S0/S1; advisory nudges warn loudly but stay exit-0; MCP tools use an explicit `note`/`attributionCaveat`) — never a blanket rule.

- 3366131: Fix six small, independently-confirmed defects in the CLI and MCP server, all in the same "silent wrong answer" family:
  - **`get_complexity` silently ignored an unrecognized `filepath` argument.** Every MCP tool schema in `packages/cli/src/mcp/schemas/` was a plain `z.object({...})` with no `.strict()` — Zod's default behavior _strips_ unknown keys rather than rejecting them, so a caller passing `filepath` (instead of the correct `files` array) had it silently vanish, `files` stayed `undefined`, and the handler fell through to "analyze the entire codebase." The advertised JSON schema said `"additionalProperties": false`, but that's descriptive metadata for the client, not runtime enforcement. All six MCP schemas (`search`, `similarity`, `file`, `symbols`, `dependents`, `complexity`) now call `.strict()`, so an unrecognized key returns a clear `INVALID_INPUT` error instead of a structurally-indistinguishable whole-repo answer. A legitimate call that omits `files` still analyzes the whole codebase as documented — only unrecognized keys are rejected.
  - **`lien status`'s "Index files" counted directory entries, not indexed files.** `getFileCount()` was `fs.readdir(indexPath, {recursive:true}).length` — the number of bookkeeping entries in the store dir (`manifest.json`, `structural.db` + its `-shm`/`-wal` sidecars, `.git-state.json`, `.lien-accessed`, `.lien-index-version`), unrelated to how many source files are actually indexed. Both the text and `--format json` output now report `ManifestManager.getIndexedFiles().length` — the manifest's real indexed-file count.
  - **`lien annotate <nonexistent-path>` in an indexed repo printed nothing and exited 0** — indistinguishable from "this file has no impact," unlike the (correctly loud) unindexed-root case. `resolvePaths` returning null (path doesn't exist on disk, or escapes the project root) now reports "not found in the index" via the same `findUnindexedPaths`/`formatUnindexedPathsNote` machinery the MCP tools already use for this exact class of bug, rather than silently exiting.
  - **`lien delta --soft` advised re-running with `--soft`, even when `--soft` was already passed.** `formatDeltaText()` took no `soft` parameter and unconditionally printed "re-run with --soft to advise only" whenever crossings existed. It now prints "Advisory only — not failing the build" when `--soft` is set, and the original advice otherwise. Exit code behavior (`--soft` always exits 0) was already correct — only the printed advice was wrong.
  - **`lien config set` help text advertised a project-scoped key that doesn't exist.** The `set <key> <value>` subcommand description said "global or project, depending on the key" — leftover prose from before `embeddings.enabled` (the one former project-scoped key) was retired along with embeddings. `ALLOWED_KEYS` has exactly one entry (`backend`, global-only) today, and the parent `config` command's own description already says so correctly. The subcommand description now matches.

  All six were verified by direct reproduction (before/after) against a real indexed scratch repo and the MCP server's stdio protocol, not just unit tests.

- 7097ad6: Fixes two confirmed defects where `riskLevel` disagreed for the same file at
  the same moment (CLI-4/REVIEW-6/#1017), plus a related population-parity bug
  found while investigating (HOOKS-2).

  **CLI-4/REVIEW-6 — `get_complexity`/`lien complexity` computed a genuinely
  different concept than `get_dependents`/`lien annotate`/`lien api-delta`,
  under the identical field name `riskLevel`.** The two are legitimately
  different questions — "how risky is this file's own complexity" (own
  violation severity, boosted but never downgraded by dependent count/
  complexity, no test-coverage term at all) vs "how risky is changing this
  file given who depends on it" (blast-radius risk: dependent breadth plus
  untested-dependent count, with a complexity floor) — so the fix renames
  rather than merges: `lien complexity --format json` and `get_complexity`'s
  `violations[]` now report `complexityRiskLevel` instead of `riskLevel`.
  `lien complexity`'s text output now prints "Complexity risk:" instead of
  bare "Risk:". `get_dependents`/`lien annotate`/`lien api-delta` are
  unchanged — they keep `riskLevel` for blast-radius risk. Both concepts are
  now documented side by side, with the divergence pinned by a dedicated test,
  in `docs/architecture/blast-radius-nudge.md`'s new "Two risk concepts"
  section.

  **HOOKS-2 — `lien annotate` fed the wrong population into blast-radius
  risk.** `get_dependents`/`lien api-delta` compute risk from
  `productionDependentCount` (test files calling the target don't weigh into
  risk the same way production callers do); `lien annotate` fed the wider
  `dependents.length` (production + test) instead — an internal mismatch too,
  since it already used the narrower `uncoveredProductionDependents` for the
  untested count in the same call. A file with many test-only importers and
  few production ones could read riskier from `lien annotate` than from
  `get_dependents` for the identical file at the identical moment. Fixed by
  feeding `productionDependentCount` into `lien annotate`'s risk computation
  too, and relabeling the "N callers" reasoning entry as "N production
  callers" (shared `relabelCallerReasoning`, used by both `get_dependents` and
  `lien annotate` — one implementation instead of two that can drift again).
  The displayed dependents list and count are unchanged (still the wider
  production + test total, sorted production-first).

- Updated dependencies [bddcdb9]
- Updated dependencies [7097ad6]
  - @liendev/parser@0.75.2
  - @liendev/core@0.75.2

## 0.75.1

### Patch Changes

- 22f8a63: `get_dependents` now hedges instead of returning a confident zero in two
  more structurally-blind shapes (#1015, #1005 — the honesty half of each;
  real resolution remains open):
  - **#1015** — a `symbol`-scoped query whose target is a class/struct/
    interface/enum declaration (not a function or method) now carries a new
    `attributionCaveat.reason: "type-symbol-attribution-incomplete"`.
    Usage attribution is call-site-driven, and nothing "calls" a type by its
    own name the way a function call does — constructor calls, type hints,
    `extends`/`implements` clauses, generic type arguments, and
    dependency-injected property access don't reliably surface as a tracked
    call site, so `totalUsageCount` for a type is a partial floor, not a
    verified total, regardless of whether it comes back `0` or some small
    positive number. Function/method symbol queries are unaffected —
    `totalUsageCount` stays exact there (verified against PHP `formatPrice`).
  - **#1005** — the existing `dependent-attribution-incomplete` caveat (a
    file-level query with zero import-based dependents in a language whose
    import graph can't see every real usage) now also fires for Java, Kotlin,
    and Swift, not just C#. Each qualifies for a different underlying reason
    (Java/Kotlin: same-package visibility needs no `import`; Swift:
    whole-module access) — see `hasDependentAttributionBlindSpot` in
    `packages/parser/src/ast/languages/registry.ts`. Go is deliberately
    excluded: its own same-directory test convention already recovers a real
    association rather than needing an honesty label.

  No behavior changes for languages/shapes where the existing mechanism
  already produces a verified answer — a genuinely unused function or a
  file with real import-based dependents still reports a clean, uncaveated
  result.

- Updated dependencies [22f8a63]
- Updated dependencies [9811991]
- Updated dependencies [cc4e511]
  - @liendev/parser@0.75.1
  - @liendev/core@0.75.1

## 0.75.0

### Patch Changes

- 1f94a12: Collapse the import index's remaining unguarded match paths onto
  `importMatchesTarget` (#994 Phase 3). `dependency-analyzer.ts`'s import index
  used to store bare chunks (`Map<string, CodeChunk[]>`), discarding both the
  raw (pre-normalization) import specifier and per-importer identity once a
  bucket key was computed. That forced `findDependentChunks`'s fuzzy loop to
  reconstruct the #887 (Ruby/Go single-file-vs-package) and #929 (Python
  bare-module) guards itself, per chunk, via two extra `matchesFile` calls
  instead of calling the single guarded primitive directly — the same three
  guards expressed in two different shapes, with nothing forcing them to
  agree (the root cause behind #934 and #955 shipping the same guard gap
  twice).

  Each index entry now carries `{ chunk, rawSpecifier }` (`ImportIndexEntry`,
  newly exported), so `findDependentChunks`'s fuzzy loop and both of the
  index's own builders (`buildImportIndex` for `analyzeDependencies`,
  `indexImportEntry`/`addChunkToImportIndex` for `findDependents`) route
  through `importMatchesTarget` uniformly. `addFuzzyMatchChunks`'s signature
  changed accordingly (bucket entries + a normalizer, instead of a normalized
  specifier + bare chunk list) — it and `findDependentChunks` are both public
  exports of `@liendev/parser`, hence the minor bump.

  `buildReExportGraph`'s one remaining raw `matchesFile` call is unchanged: it
  is a same-normalizer file-identity check (skip the target file itself when
  scanning re-exporter candidates), not an import-vs-file match, so there was
  never a specifier for `importMatchesTarget` to guard there in the first
  place — see `path-matching.ts`'s updated design comment.

  Pure consolidation, not a behavior change: verified byte-identical
  `lien annotate` output before and after on this repo and on tracked
  multi-language fixtures (`lien-review-testbed`'s Python and Rust files).
  `lien delta` (gate 6) reports 2 improved functions (`analyzeDependencies`,
  `addFuzzyMatchChunks`), 0 regressions.

- 921cd76: Fix `get_dependents` reporting `0` (with no caveat) for every file in a PHP
  project whose `composer.json` declares the same PSR-4 namespace prefix in
  both `autoload` and `autoload-dev` — the standard library layout, where a
  package's tests share its own namespace (#1002). `resolvePsr4Map`
  (`php-psr4.ts`) used to build a flat `Map<prefix, string>`, and
  `autoload-dev` was processed second, so it silently overwrote `autoload`'s
  directory for the shared prefix. On Monolog's real `composer.json`
  (`"Monolog\\"` declared as both `src/Monolog` and `tests/Monolog`), every
  `use Monolog\Logger;` in `src/` resolved to the nonexistent
  `tests/Monolog/Logger`, and `get_dependents` reported `0` dependents for
  all 232 of Monolog's files with `attributionCaveat: null` — indistinguishable
  from "nothing depends on this file."

  Both directories are simultaneously correct (`Monolog\Logger` really lives
  under `src/Monolog`, `Monolog\LoggerTest` really lives under
  `tests/Monolog`), so a flat `Map<prefix, string>` can't represent the data —
  reordering to prefer `autoload` would just invert the bug and break PHP test
  association (#867), the reason this module exists. The map now stores
  `Map<prefix, string[]>`, appending rather than overwriting (this also
  resolves, for free, the previously-ignored case of a PSR-4 prefix mapping to
  an array of Composer fallback directories — only the first entry used to be
  kept). `resolvePsr4Import` tries each candidate directory in declaration
  order (`autoload` before `autoload-dev`) and prefers whichever resolves to a
  real `.php` file on disk, falling back to the first-registered candidate
  when neither exists (matching prior behavior for the single-candidate case).

  Verified end to end against a real `Seldaek/monolog` clone: before this fix,
  `0 edges / 232 orphans (100.0%)`; after, `src/Monolog/Logger.php` correctly
  reports all 13 of its real production importers as dependents. Confirmed no
  over-correction (no production file's import resolves to a `tests/`
  candidate that doesn't apply to it). Swept the sibling manifest resolvers
  this module says it "mirrors" (`workspace-packages.ts`, `rust-crate-map.ts`)
  for the same last-write-wins shape — both are clean, because npm/Cargo
  package names are uniqueness-enforced by their respective package managers,
  unlike Composer's PSR-4, which explicitly permits the same prefix in two
  sections.

- 62ad43e: Finish the complexity-analysis migration into `@liendev/parser` (#994 Phase
  4). `@liendev/core`'s `ComplexityAnalyzer` used to carry a hand-synchronized
  ~350-line copy of the violation/report/enrichment algorithm that already
  lived in parser's `analyzeComplexityFromChunks` — the divergence risk that
  let #979 ship (the copy's testAssociations enrichment was never wired up).
  `ComplexityAnalyzer.analyze()` now fetches chunks from the structural store
  and delegates straight into `analyzeComplexityFromChunks`, same as the
  static `analyzeFromChunks()` already did; the class is now a thin bridge
  from `VectorDBInterface` to that pure function, with no independent copy of
  the algorithm left to drift.

  Also moves `effortToMinutes`/`formatTime` (Halstead-effort-to-readable-time
  conversion) out of `@liendev/core`'s text formatter, which had its own copy,
  and re-exports the single implementation from `@liendev/parser`.

  No output change for any existing caller (`lien complexity`, `get_complexity`,
  `lien annotate`, `lien delta`) — verified byte-identical on this repo except
  for `complexity-analyzer.ts` itself, which naturally drops the complexity
  violation it used to report on its own now-deleted 350-line implementation.

- Updated dependencies [1f94a12]
- Updated dependencies [921cd76]
- Updated dependencies [62ad43e]
- Updated dependencies [7db9264]
- Updated dependencies [5947350]
  - @liendev/parser@0.75.0
  - @liendev/core@0.75.0

## 0.74.0

### Patch Changes

- d5cc178: Fix the Claude Code read-hook's per-session annotation dedup silently
  bypassing the #938 never-suppress policy for an incomplete
  dependent-attribution result, a complexity warning, or a headroom concern
  (#978).

  `isTrivial` and `belowRiskFloor` (`annotate-cmd.ts`) both already guarantee
  those signals are never silenced, but a THIRD gate — `annotate-read.sh`'s
  per-session dedup — ran _before_ `lien annotate` on a file's second Read this
  session and exited unconditionally once its touchfile existed, with no way to
  know whether the annotation it was suppressing carried one of those signals.
  `lien annotate` now exits `2` (instead of the default `0`) whenever the
  annotation it just printed carries a never-suppress signal
  (`hasNeverSuppressSignal`, the single predicate `isTrivial`/`belowRiskFloor`
  both gate on), and the hook records that in the touchfile's _content_ — `1`
  means "never dedup-skip this file again this session," so a signal-carrying
  file re-invokes `lien annotate` on every read for the rest of the session,
  while an ordinary file keeps the existing, cheap existence-only dedup.

  `annotateCommand` now returns whether the printed annotation carried that
  signal (previously `void`); the CLI's `process.exit` wiring moved to a new
  `annotateCli` wrapper so tests can keep calling `annotateCommand` directly.

- 10806a7: Fix `get_dependents`'s `attributionCaveat.reason` prose, which had drifted
  out of sync across its five model-facing surfaces (#980). `#941` wrote the
  explanation into three surfaces at once; `#951` fixed two of them and
  needed a second sub-commit for the third; two surfaces were never revisited
  and were still wrong at HEAD:
  - The `symbol` parameter's JSON Schema description (read by every MCP
    client on connect) still had the pre-`#951` unhedged wording — it didn't
    mention that an unconfirmed symbol may simply be a typo, a hallucinated
    name, or a removed one, rather than always a real method/constructor.
  - The `AttributionCaveatReason` type's JSDoc (dev-facing) had the same gap.

  Both now carry the same hedge already present in the tool description and
  server instructions.

  Consolidated all four reasons' explanatory text into one exported record
  (`ATTRIBUTION_CAVEAT_REASON_TEXT` in `packages/cli/src/mcp/attribution-caveat-reasons.ts`,
  keyed by `AttributionCaveatReason` so the compiler rejects a stale entry
  count), and had the tool description, server instructions, and JSON Schema
  description all interpolate it instead of hand-writing the explanation
  again — closing off the exact drift pattern that caused this bug three
  times in a row.

  Also fixes the public docs page
  (`packages/site/docs/guide/mcp-tools.md`), which asserted `reason` is "one
  of" a list of exactly three names — `dependent-attribution-partial`
  (added by `#930`) appeared zero times in the file, leaving no documented
  way to interpret the `confidence: "inferred"` entries that reason implies.
  Added a test (`attribution-caveat-reasons.test.ts`) asserting the docs
  page, the server instructions, and the tool description each mention
  every member of the `AttributionCaveatReason` union, so a future fifth
  reason fails CI on any surface that isn't updated, rather than shipping
  silently incomplete.

- e95429f: Fix `ComplexityAnalyzer.analyze()` (the persisted-index path used by `lien
complexity` and the `get_complexity` MCP tool) always reporting
  `testAssociations: []` for every violation, even when a real test file
  imports the offending code (#979).

  `packages/core/src/insights/complexity-analyzer.ts` set `testAssociations: []`
  with a "will be enriched later" comment and never enriched it — the only
  occurrence of `testAssociations` in the file. Its in-memory-chunks twin,
  `analyzeComplexityFromChunks` (`@liendev/parser`, used by the static
  `ComplexityAnalyzer.analyzeFromChunks()` and reached via `lien annotate`),
  already ran `findTestAssociationsFromChunks` and enriched the report
  correctly — a half-finished migration where the static delegating method
  was pointed at the parser implementation but the instance method's own copy
  was left behind. `get_complexity` is the tool CLAUDE.md-style agent
  instructions point at before refactoring to find hotspots; it was silently
  claiming none of them had tests.

  Fixed by calling the same `findTestAssociationsFromChunks` from `analyze()`
  after dependency enrichment, mirroring the parser twin. `SearchResult[]`
  (what `analyze()` has, off the persisted index) is a structural superset of
  `CodeChunk[]` (what the parser function's signature expects), so no type
  changes were needed — verified via `tsc`, not assumed.

  Also threaded `testAssociations` through the `get_complexity` MCP tool's
  `transformViolation()` response shape, which previously omitted the field
  from its output entirely regardless of what `analyze()` returned — without
  this, the fix would be invisible through the exact tool named in the bug
  report; the CLI's `--format json` output already included it as a
  pass-through of the whole report.

  Added a same-input parity test between `analyze()` (`SearchResult[]`) and
  `analyzeFromChunks()` (`CodeChunk[]`) asserting they agree on
  `testAssociations` — the check whose absence let this divergence ship
  silently (a prior commit, 93191c41, had to hand-sync an unrelated one-line
  dedup-key change across both files; nothing enforced that these two
  `testAssociations` implementations stayed in sync).

  Does NOT move the canonical implementation into `@liendev/parser` (the
  larger duplication-layering fix suggested in #979) — `chunk-complexity.ts`
  has no dedicated test file today and feeds `lien delta`'s complexity gate,
  so that refactor needs characterization tests first and is left for
  separate follow-up work.

- 231855a: Widen C# `get_dependents`/test-coverage recovery to test-declared types and
  real namespace-scoped disambiguation (#930/#943's remaining gap). Measured
  on a fresh serilog/serilog clone (216 `.cs` files, same corpus that
  motivated #930/#943): despite that prior fix, 114/216 (53%) still reported
  `dependentAttributionIncomplete` ("not determinable") and 216/216 (100%)
  reported test coverage as not determinable — because the recovery's
  uniqueness gate excluded test-declared types as candidate declarations
  entirely, and dropped any name declared in more than one file with no
  attempt at disambiguation.

  `findCSharpTypeReferenceDependents` (`@liendev/parser`) now has two tiers:
  - Tier 1 (widened): the existing global-uniqueness check now also accepts
    test files as declaring files — a type declared ONLY in a test helper
    (e.g. `DummyRollingFileSink.cs`) is a legitimate, real dependency target
    for other tests that reference it, and excluding it was an unjustified
    asymmetry (a test file was already an accepted _dependent_, just never a
    _declarer_). Excludes NESTED types declared in a test file specifically
    from candidacy (a nested type's bare name is resolved by containing-type
    membership, not namespace membership, and is disproportionately likely to
    be a throwaway same-named local double — measured regression, see below),
    while still recovering a nested PRODUCTION type declared in its own
    `partial`-continuation file.
  - Tier 2 (new): for a type name that's ambiguous project-wide, real C#
    namespace-enclosure + shadowing rules (innermost enclosing declaration
    wins) resolve it per-referencer instead of dropping it outright — e.g.
    `Serilog.Core.Sinks` code referencing bare `Logger` resolves to
    `Serilog.Core.Logger` (the closer namespace), not a same-named
    `Serilog.Logger` or a test's own local `Logger`. Costs no schema change:
    each file's own namespace is derived from its own already-indexed chunk
    content (95% hit rate measured), not a new persisted column.

  A referencer that itself declares a competing same-named type is excluded
  entirely from being counted as a reference to either tier's target — a
  word-boundary text match can't tell which declaration a given occurrence
  resolves to once there's a local competitor, so the only safe answer is
  "don't guess" (caught via a real regression during testing: a test file
  constructing its own local double of a production class's name was
  initially still counted as referencing the unrelated production type).

  The exact same recovered signal, filtered to its test-file dependents, is
  now also reused as a fifth `lien annotate` test-association tier (mirroring
  Swift's existing symbol-usage tier) — closing the companion
  100%-not-determinable test-coverage gap the same way, not left for
  follow-up work.

  Measured impact (serilog/serilog, 216 files): `dependentAttributionIncomplete`
  114 (53%) → 63 (29%); test coverage not-determinable 216 (100%) → 100 (46%).
  Zero regressions against the pre-widening baseline once the nested-type and
  same-file-competing-declaration exclusions above were added (verified via a
  full before/after diff of every file's recovered dependents, not just the
  aggregate counts) — one pre-existing false positive from #943 itself
  (a production class getting a spurious test dependent via exactly this
  same-file-competitor shape) was found and fixed as a side effect. A 8-file
  precision spot-check via `grep` confirmed every newly-recovered dependent
  genuinely references its target. Index time and `get_dependents` query
  latency are unaffected (both run entirely at query time; measured
  before/after within noise, ~9ms mean per file on this corpus).

  Does NOT fix: `ILogger.cs` and `PropertyBinder.cs` (the two files this
  round's dogfood evidence specifically checks) still report
  `dependentAttributionIncomplete` — for an unrelated, pre-existing reason
  found while measuring this change, not this recovery mechanism. Both
  contain a method declaration whose signature is split mid-token across an
  `#if`/`#else`/`#endif` preprocessor boundary, which the tree-sitter C#
  grammar cannot represent and recovers from by rooting the entire file in an
  `ERROR` node — no chunk, no symbol, nothing for any recovery signal to work
  with. Affects 2/216 files in this corpus; a related but more tractable
  preprocessor-transparency gap (a declaration wholly inside one `#if` block,
  affecting ~8/216 more files) is filed as
  https://github.com/getlien/lien/issues/970, separate from this fix.

- d7eed3a: Fix `normalizeFilePath` mangling sibling directories that share the workspace
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

- de5fef0: Move `findDependents` (the `get_dependents` MCP tool's engine) from the CLI into `@liendev/parser`, decoupled from `@liendev/core`'s `VectorDBInterface`

  `findDependents` was the hardened, actively-maintained dependency analysis, but it lived in `cli` — the top of the package dependency stack (`parser` ← `core` ← `cli`) — so `packages/review` (which depends on `parser` only) couldn't reuse it and had grown its own weaker, independently-drifting dependency graph.

  The `VectorDBInterface` dependency was an illusion: the CLI file only ever called `vectorDB.scanAll()` and used `import type` for everything else from `@liendev/core`. `SearchResult` is a structural superset of `CodeChunk`, so making `findDependents` and its helpers generic over `<T extends CodeChunk>` (the same technique `#973` applied to `addFuzzyMatchChunks`/`findDependentChunks`) let the whole algorithm move to `@liendev/parser` unchanged in behavior, taking `Iterable<T>` chunks instead of a database handle.

  `@liendev/parser`'s `dependency-analyzer.ts` already held the simpler `analyzeDependencies` (used by `get_complexity`); `findDependents` was merged into the same file rather than a sibling module so the two algorithms could share their low-level helpers (path normalization, file grouping, complexity aggregation, re-export graph building) for real instead of drifting apart in two places — five of the six duplicate-named functions across the two former files are now single, generic implementations.

  The CLI's `dependency-analyzer.ts` is now a thin wrapper: it fetches (and caches) chunks via `vectorDB.scanAll()` and calls `@liendev/parser`'s `findDependents`. The `scanCache` deliberately stays in the CLI (the caller is what knows its `indexVersion`); `@liendev/parser` has no mutable module state.

  No behavioral change — `get_dependents` MCP tool output (`dependentCount`, `productionDependentCount`, `riskLevel`, `attributionCaveat`, and the full dependent-filepath set, for both file-level and symbol-level queries) is byte-identical before and after, verified against this repo's own index.

- 14a34a2: Share the dependent-chunk matching helpers instead of keeping two copies

  `addFuzzyMatchChunks` and `findDependentChunks` existed twice — once in
  `@liendev/parser`'s `dependency-analyzer.ts` and once, copied, in the CLI's MCP
  handler. The bodies were logically identical; the only real difference was the
  chunk type (`CodeChunk` vs `core`'s `SearchResult`).

  That copy is why the `'../..'` fuzzy-match fix had to be applied twice, and why
  one copy could be fixed while the other kept the bug.

  Both helpers are now generic over `<T extends CodeChunk>` and exported from
  `@liendev/parser`, and the CLI imports them. `SearchResult` already satisfies
  `CodeChunk` structurally, so this is a type-level change only — no behavioural
  change to `get_dependents`.

- Updated dependencies [e95429f]
- Updated dependencies [231855a]
- Updated dependencies [d7eed3a]
- Updated dependencies [7f3e85d]
- Updated dependencies [de5fef0]
- Updated dependencies [4b5efb6]
- Updated dependencies [14a34a2]
- Updated dependencies [56bcd9c]
  - @liendev/core@0.74.0
  - @liendev/parser@0.74.0

## 0.73.0

### Minor Changes

- 76a42bc: `list_functions` and `find_similar` reported result counts that could not be
  trusted, and — worse — hid real truncation. **This changes the response
  contract for `nextOffset`, so callers that computed their own offsets should
  read the note below.**

  Three distinct defects, all in `applyResponseBudget`
  (`packages/cli/src/mcp/utils/response-budget.ts`), which builds its note from an
  array the handler had _already_ capped by the request's own `limit`:
  1. **A total that tracked the request, not reality.** On sidekiq (true total:
     703 symbols) the same `pattern: ".*"` query reported `Showing 23 of 50` at
     `limit: 50` and `Showing 23 of 200` at `limit: 200`. Literally true — 23 of
     the N fetched — but any reader takes the denominator as the total, so it
     understated 703 by more than an order of magnitude. The note no longer states
     a total at all; it reports only what the size cap itself dropped.
  2. **Silent truncation.** At `limit: 10` the page genuinely _was_ cut off and
     the tool said nothing. `hasMore` is now forced true whenever items are
     dropped, so a stale upstream `hasMore: false` cannot survive a trim, and
     `list_functions` emits a note for the previously-silent case.
  3. **A pagination cursor that skipped items.** `nextOffset` was computed as
     `offset + limit` _before_ the size cap ran, so following the tool's own advice
     after a trimmed page silently skipped the dropped entries. Verified on an
     isolated sidekiq clone: page 0 returned 24 items and advised `offset: 50`,
     losing 26 real symbols. `nextOffset` is now corrected by the same drop count
     and always equals `offset + items actually delivered`.

  **Contract change:** `nextOffset` is now present whenever `results` is non-empty,
  **regardless of `hasMore`** — previously it appeared only when `hasMore` was true,
  which meant a final page that the size cap then trimmed ended up `hasMore: true`
  with no cursor at all and no way to reach the rest. `hasMore` now answers "is it
  worth paging?" and `nextOffset` answers "where would I resume?". Always pass
  `nextOffset` back verbatim rather than computing `offset + limit` yourself; the
  size cap can shrink a page after the fact and only that field is corrected for it.
  `tools.ts` documents this.

  Also documented (behaviour unchanged): `list_functions` pattern matching is
  case-insensitive and unranked, which was previously undocumented and interacted
  badly with the bogus totals — a real `class Request` in Alamofire didn't surface
  until `offset: 50`, behind lowercase test-method matches, while the "total" was
  misleading throughout.

### Patch Changes

- 76a42bc: The read-time impact nudge was **completely silent** for any project whose path
  resolves through a symlink — which includes every macOS project under `/tmp` or
  `/var`, and any repo reached via a symlinked ancestor.

  Claude Code sends an **absolute** `tool_input.file_path`, while `rootDir` comes
  from `process.cwd()`, which the OS returns already realpath-resolved. Two
  `path.relative` sites compared one against the other without canonicalizing:
  - `toRepoRelativeFile` (`nudge-events.ts`) logged
    `"file": "../../../../tmp/lien-dogfood-460173c9/hono/src/context.ts"` instead of
    `"src/context.ts"`, corrupting the paths the `lien stats` funnel joins on.
  - `resolvePaths` (`annotate-cmd.ts`) — the worse one. There a `..`-prefixed result
    trips an "outside the project root" rejection, so `lien annotate` produced **no
    output at all** for a real in-repo file. Confirmed on the released build:

  ```console
  $ lien annotate /abs/path/behind/symlink/src/utils/url.ts
  (nothing)
  $ lien annotate src/utils/url.ts
  ⚠ Lien: _getQueryParam cognitive 45/15 (over) ...
  Lien impact for src/utils/url.ts: • 11 files import this ...
  ```

  Since `annotate-read.sh` only emits when the annotation is non-empty, the entire
  read-time nudge — and its shown-event recording — vanished for affected users,
  with nothing to indicate it. A nudge that fails by not appearing is
  indistinguishable from a nudge with nothing to say.

  Both sites now canonicalize `rootDir` and the file argument through a shared
  `canonicalizePath` (`fs.realpathSync`, falling back to the parent directory for a
  path that no longer exists, then to identity — it never throws, because these run
  inside hooks on every edit), and reject a result that still escapes the root rather
  than recording it.

  Other `path.relative(process.cwd(), …)` sites were audited and ruled out:
  `delta-git.ts` already had its own equivalent fix (the pattern this mirrors),
  `agent-tools.ts` realpaths `rootDir` once up front, and the indexer paths take
  `rootDir` from the same construction as their file arguments. The review harness's
  `toRepoRelative` is offline tooling, not runtime telemetry, and was left alone.

- 76a42bc: `SERVER_INSTRUCTIONS` — the always-on guidance every MCP client receives on
  `initialize` — told models to "call `search_code` FIRST" for discovery,
  unconditionally, while its own opening paragraph reserved grep for "exact
  literals" and omitted exact symbol names entirely. So an agent that already knew
  the identifier it wanted was being instructed to paraphrase it into a BM25 query
  first.

  CLAUDE.md already carried the correct split ("Use grep/glob ONLY for: exact symbol
  names, literal strings, config keys, TODOs"), so this was one-directional drift —
  and the surface a **model** actually reads was the wrong half.

  Reframed around what the caller already knows: an exact symbol name goes to
  `list_functions`, an exact literal to grep — _don't paraphrase a name you already
  have_ — and a concept without a name goes to `search_code` before falling back to
  grep/glob. Same tools, same BM25 / camelCase-split / no-embeddings caveats, no new
  policy.

  Both texts also now state that **zero results is not proof of absence**: an index
  that hasn't caught up with a recent edit makes a symbol that exists on disk
  unfindable, and the tool cannot tell you which case you're in. Observed during the
  post-release dogfood — a search for a symbol added after the last index returned
  five results ranked `"highly_relevant"`, none of which contained it, and grep found
  it immediately. The tool-side half of that honesty is in the same release; this is
  the always-on guidance half.

  The hand-sync between these two documents is guarded by
  `instructions.claude-md-sync.test.ts`, which requires both to carry the discovery
  framing and all three search caveats.

- f2937c9: #953: `get_dependents` fabricated direct (`hops:1`) dependency edges for any
  relative import that resolves to a bare DIRECTORY path instead of a real
  file — a confident wrong answer, with no caveat, that fed straight into
  `riskLevel`.

  Confirmed via the foreign-repo dogfood on honojs/hono:
  `src/middleware/jwt/index.ts`'s only outward-facing statement is
  `import type {} from '../..'` (a dots-only, empty type import). This resolves
  (correctly) to the bare directory `src`, but nothing then resolved `src` to
  its real entry point (`src/index.ts`). Left as a bare directory name, the
  specifier fuzzy-matched via `matchesFile`'s Python Strategy 5
  (`matchesParentPythonPackage`) against EVERY file anywhere under `src/` — for
  a TypeScript importer with no Python semantics at all. `get_dependents` for
  `src/utils/color.ts` reported `dependentCount: 13` (true: 4), `riskLevel:
"high"` (true: `"medium"`); `src/utils/url.ts` reported 3 of its 12
  production dependents as fabricated. This is the same false-hub shape #929
  already diagnosed (Python's own doc comment names this exact hono repro) but
  left unguarded on the two call sites that build `get_dependents`' actual
  result (`findDependentChunks`'s fuzzy loop in both
  `packages/parser/src/dependency-analyzer.ts` and
  `packages/cli/src/mcp/handlers/dependency-analyzer.ts`), rather than the
  guarded `importMatchesTarget` primitive #929 introduced.

  Two-part fix:
  - **Root cause: resolve a directory-shaped relative import to its real entry
    point.** A new `resolveJsDirectoryIndex` (`packages/parser/src/js-directory-index.ts`)
    checks whether a relative-resolved specifier names a real on-disk directory
    and, if so, redirects it to that directory's `index.<ext>` file (mirrors
    `workspace-packages.ts`'s entry-file detection, scoped to a single
    directory). `../..` now resolves to `src/index`, which participates in
    ordinary EXACT matching — no fuzzy strategy involved at all. This is what
    keeps `jwt/index.ts` et al. correctly attributed as `hops:1` dependents of
    `src/index.ts` (the file `../..` actually names) instead of just deleting
    the edge outright. Generalizes beyond the dots-only case: a named directory
    import (`../utils` where `src/utils/index.ts` exists) is fixed the same
    way.
  - **Residual guard: gate Python Strategy 5 per chunk.** For the case where no
    entry file exists (so the directory-index resolution is a no-op), both
    `addFuzzyMatchChunks` implementations now re-derive the #929 guard per
    chunk — mirroring the existing #887 per-chunk pattern — so a non-Python
    importer's coincidental bare-word match can never count. Real Python
    bare-package matching (`import flask` -> `flask/__init__.py` and children)
    is untouched.

  Verified the BFS depth mechanics needed no changes: once the seed (depth-1)
  edges are correct, `depth: 2+` results clean up for free (checked live on the
  hono corpus).

  Also: `get_dependents`'s response echoed the _requested_ `depth` even for a
  symbol-scoped query, where `depth > 1` is documented as ignored (symbol
  queries always run at depth 1). Now echoes the depth that actually ran.

- 76a42bc: Two MCP notes asserted a cause they had not established — plausible, specific,
  and wrong, which is the failure mode a consuming model cannot detect.

  **`list_functions` / `search_code` blamed your query for a missing index.** With
  gin's index moved aside, a search for `StringToBytes` — which unquestionably
  exists — returned:

  ```json
  "results": [], "note": "0 results. Try a broader regex pattern (e.g. \".*\")
  or omit the symbolType filter. ... Run \"lien index\" to enable faster
  symbol-based queries."
  ```

  Three compounding problems: the advice asserted the search had _run_ and the
  query was at fault; "to enable **faster** queries" framed indexing as a
  performance upgrade when it was a correctness prerequisite; and `indexInfo` in the
  same payload advertised an index dated _today_ with `pendingFileCount: 0`, so
  nothing contradicted a "fresh index, symbol absent" reading.

  Both tools now call `vectorDB.hasData()` on a zero-result response. A genuinely
  empty index escalates to an unmissable `⚠ Lien:` warning (new
  `formatNoIndexNote()`, reusing the pattern `get_dependents` already had from
  #927). An index that is present but has no match for this query hedges instead of
  blaming the query — which also covers the far more common case found during the
  dogfood: **an index that simply hasn't caught up with a recent edit.** Appending a
  function to flask's `helpers.py` and searching for it immediately returned zero
  results with the query-tuning advice, while `indexInfo` reported a 2.7-second-old
  reindex and `pendingFileCount: 0`. An agent that writes a function and cannot then
  find it will conclude it misnamed something.

  **`get_dependents` claimed a symbol was "likely a method or constructor" when it
  had never existed.** The `symbol-attribution-degraded` caveat emitted one
  hardcoded explanation for at least three distinct causes — a real
  method/constructor, a typo'd or hallucinated name, and a symbol that was removed.
  Byte-identical wording for `totallyMadeUpSymbolXYZ123` (which appears nowhere in
  the repo) and for a genuine constructor. Those readings warrant opposite next
  actions: "proceed with the file-level answer" versus "check the name". The caveat
  now checks whether the symbol appears anywhere in the target file's indexed chunks
  and words each case honestly, keeping the genuinely useful part — that the numbers
  below are file-level, not verified symbol callers — unchanged either way.

  Both `SERVER_INSTRUCTIONS` and the `tools.ts` tool descriptions carried the same
  overclaim and were corrected. The `tools.ts` half was itself caught by Lien Review
  on the first pass of this fix, which had updated only `instructions.ts` — the two
  surfaces a model reads must move together.

- 76a42bc: A single unrelated test run silently disabled the did-you-run-the-tests nudge for
  an entire session.

  `classifyTestCommand` had only two outcomes: `scoped` (a path-like token was
  found) or `broad` (none was). A run scoped by test **name** carries no path-like
  token, so it fell into `broad` by construction, and `computeUnverifiedFiles`
  treats any broad run as evidence the whole edit set was exercised. Reproduced
  end-to-end on the published 0.72.0 binary against pallets/flask:

  ```text
  # edit recorded, no test run — correctly nags
  • src/flask/helpers.py → tests/test_helpers.py (+35 more)

  # same edit, then: pytest -k test_totally_unrelated_name
  (completely silent)
  ```

  Verified reproducing on all eight runners checked, plus one found while
  investigating (`swift test --filter`, invisible through a different path):
  `pytest -k`, `dotnet test --filter`, `rspec -e`, `mocha --grep`, `go test -run`,
  `cargo test <name>`, `vitest -t`, `jest -t`.

  This is the false-"tests ran" direction, and it invisibly switches off the
  mechanism a foreign-repo trial showed actually changes agent behaviour — the Stop
  recap blocking a finish is what sent that agent back to run the check it had
  skipped.

  Adds a third classification outcome — name-filtered — that is neither `broad` nor
  a `scopeTokens` contributor, so a name-filtered run no longer licenses "everything
  is verified". The fail-safe direction is to keep nagging: the nudge already carries
  its own escape hatch ("if you already ran them, disregard and stop again"), so a
  false nag costs one line while a false silence costs the whole mechanism.

  Recognition uses **per-runner-family flag allow-lists rather than one global set**,
  because the same spelling means different things per ecosystem — `tox -e py311`
  selects an environment while `rspec -e NAME` selects a test, and a global set would
  have wrongly un-broadened tox. Runner-specific value-skip sets keep build-config
  flags from being misread as positional test names (`cargo test --features foo`,
  `-p`, `--manifest-path`) and keep pnpm's workspace `--filter` broad (including the
  `--filter=@scope/pkg` form, and the `pnpm --filter=<sel> test` ordering which
  previously matched no runner pattern at all). Both collisions are pinned by
  regression tests.

  Documented explicitly, with tests, because a review raised it twice: **a
  scope-broadening flag does not make a name-filtered run broad.** `./...`,
  `.`, `--workspace` and `--all` broaden which _packages_ compile; `-run Foo` and a
  bare positional still filter which _tests execute_. `go test -run TestFoo ./...`
  runs none of an unrelated file's tests, so it correctly nags — treating it as broad
  would reintroduce this very bug.

- c4203e8: Issue `#916`: an empty `nudge-events.jsonl` window in `lien stats` used to render
  identically whether nobody ever qualified for a nudge, a nudge fired and got
  ignored every time, or the deployed plugin hooks predated this
  instrumentation entirely and recording was never possible. That third case
  actually happened on a real machine: a directory-source plugin install
  pinned to a stale branch produced a silently empty ledger, and the resulting
  telemetry read had to be forensically reconstructed before a product
  decision could be made.

  Every recorded `shown`/`signal` event now carries a `build` stamp
  (`{ cliVersion, hooksHash? }`) — the running CLI's version plus a content
  hash of the plugin hooks directory the recording hook script lives in. CLI
  version alone isn't enough: the failure mode is stale _hooks_ running
  alongside an otherwise-current CLI install. The hash is computed once per
  session and cached (`nudge-build/<sessionId>.json` next to the other
  per-session state, GC'd the same way), so the hooks directory is never
  re-hashed per event.

  `lien stats` now tells the three cases apart: a non-empty window reports the
  build that recorded it (`Recorded by: ...`); a window with zero events but a
  capable build seen elsewhere in the ledger says so and reports when
  (`Zero events in this window, but a recording-capable build was last seen
...`); a ledger that has never once seen a build-stamped event says
  recording may never have been possible, rather than implying disengagement.
  Existing (pre-#916) ledger entries have no `build` field — they're read as
  "build unknown", never as a known-good build.

  New `lien nudge doctor [--hooks-dir <path>]` command: a manual drift check
  that flags the exact fingerprint of the incident above (the telemetry
  instrumentation's signal-recording hook missing from a live plugin hooks
  directory entirely), plus CLI-version/hooks-hash drift against the ledger's
  own history.

- 76a42bc: The habituation guard's risk floor silenced the "Dependents not determinable
  from imports" annotation — the exact message #938/#939 shipped to prevent an
  agent reading an unknown as a zero — **in the default plugin configuration**.

  `annotate-cmd.ts` runs two suppression gates back to back. #938 taught
  `isTrivial` about `dependentAttributionIncomplete`; `belowRiskFloor`, three
  lines below it, never learned. A file whose dependents are indeterminable has
  low risk _by construction_ (zero **known** dependents), so it fell below a
  `medium` floor and was dropped. This was not opt-in: `annotate-read.sh:68` sets
  `min_risk="${LIEN_ANNOTATE_MIN_RISK:-medium}"` and passes `--min-risk` on every
  read-time annotation.

  Reproduced on the published 0.72.0 binary against serilog/serilog:

  ```console
  $ lien annotate src/Serilog/Capturing/PropertyBinder.cs
  Lien impact for src/Serilog/Capturing/PropertyBinder.cs:
    • Dependents not determinable from imports (enclosing-namespace access).
    • Test coverage not determinable from imports (enclosing-namespace access).

  $ lien annotate src/Serilog/Capturing/PropertyBinder.cs --min-risk medium
  (no output — suppressed)
  ```

  Not an edge case: an exhaustive pass found **114 of 216** serilog `.cs` files
  (53%) carry that note. Serilog is one hierarchical namespace tree, so C#'s
  enclosing-namespace access lets the whole library reference its own members
  with zero `using` directives — `ILogger.cs`, the central interface, genuinely
  has no import-determinable dependents. For C# of this shape, suppression was
  the common path.

  `belowRiskFloor` now takes `dependentAttributionIncomplete` as a defaulted
  trailing parameter (matching #938's own approach for `isTrivial`) and treats it
  as high-value, clearing the floor exactly as `complexityWarnings` and
  `headroomCount` already do.

  Deliberately **not** extended to the sibling "Test coverage not determinable"
  flag, measured across four freshly re-indexed corpora: coverage-indeterminable
  is 100% of serilog's C# files and 83% of Alamofire's Swift files, because
  `wholeModuleImports` (Swift) and `enclosingNamespaceAccess` (C#) make coverage
  structurally undecidable from imports. Clearing the floor for it would
  blanket-annotate two entire language ecosystems — precisely what the
  habituation guard exists to prevent. Dependents-indeterminable is the rarer,
  higher-signal flag and the right one to promote.

  This was reported by Lien Review on #938 itself, correctly and specifically,
  and shipped anyway because the finding was stated in summary prose rather than
  as an addressable item — see #958 and #960.

- 10474a9: Two symbol-extraction gaps (#949), both reproduced against the published
  0.72.0 artifact on foreign repos and confirmed to still repro on the
  published binary before this fix:

  **Ruby `module` declarations were invisible as symbols.** `list_functions`
  could not find `module Sidekiq` (sidekiq's own root namespace, at
  `lib/sidekiq.rb:42`) or `module Job` (its central job mixin) at all — a
  regex query for either returned zero hits. Root cause: `RubyTraverser`
  treats `module` as a transparent namespace so `module → class → method`
  still yields method chunks (deliberately, to avoid breaking the container
  depth budget `isTargetNode` enforces), but that meant the module's own AST
  node was never pushed to the chunker's node list, so it never became a
  chunk/symbol at all — the dead `case 'module'` branch in
  `RubySymbolExtractor.extractSymbol` was structurally unreachable. Fixed by
  adding a `transparentContainerTypes` field to `LanguageTraverser` (optional,
  undefined for every other language — a no-op): the chunker now emits a
  chunk for a node in this list while still traversing its children at the
  same depth, keeping the transparency for nested content. Module contents
  (nested classes/methods) were never the problem — they were already fully
  indexed; only the module's own entry was missing.

  `module`'s `symbolType` is `interface`, not `class` — a Ruby module can
  never be instantiated, so `class` would misdescribe it. `interface` is an
  imperfect but honest fit (closest of the four existing `SymbolInfo` types
  to a mixin contributing shared behavior, similar to a Rust trait), chosen
  over adding a fifth `module` type to avoid rippling into the `symbolType`
  filter, MCP schemas, and every consumer of the closed four-value enum — the
  same tradeoff `csharp.ts` made mapping properties to `method` rather than
  adding a `property` type.

  **Nested type declarations never reported a `parentClass`.** A type
  declared directly inside another type (Java/C#'s `public static class
Builder` nested in `Retrofit`, `RequestFactory`, etc. — confirmed on
  square/retrofit; C#'s `ContextStackBookmark` nested in `LogContext`,
  `SelfLogFailureListener` nested in `SelfLog` — confirmed on
  serilog/serilog) always reported `parentClass: null`, making
  same-named nested types (six `Builder` results) indistinguishable except
  by file path. Root cause: the chunker already resolves the enclosing
  type's name for every top-level node via `findParentContainerName` (not
  just methods), but each language's `extractClassInfo`/`extractInterfaceInfo`/
  etc. either didn't accept the parameter at all or silently dropped it.
  Fixed for C#, Java, Python, Swift, and Kotlin (all of which support real
  nested type declarations) by threading `parentClass` through every
  type-declaration handler, the same way it already worked for methods. The
  existing `enclosingSymbol` MCP metadata field is derived from `parentClass`
  - `symbolName`, so it's fixed for free with no separate change.

  Not fixed (no repro path, confirmed by traverser inspection): JavaScript/
  TypeScript (no `class_declaration`-in-`class_declaration` construct — a TS
  namespace nesting classes is a related, separate, still-open gap), PHP (no
  nested class-declaration construct), Go (flat structure by design, no
  containers at all), Rust (`impl`/`trait` blocks cannot nest in valid Rust;
  a `mod` nested in another `mod` doesn't interact with `parentClass` since
  `mod` isn't a class-like container — though Rust's `mod` shares Ruby's
  Bug 1 shape, invisible as its own symbol, which is out of scope here and
  left as a follow-up).

- 21c5d55: Concurrent MCP tool calls against a cold or rebuilding index could kill the
  server connection outright, surfacing to the client as
  `MCP error -32000: Connection closed` rather than a tool-level error. Observed
  at roughly a 50% failure rate with four servers racing on one brand-new
  `structural.db`.

  Root cause: `openDatabase()` set the `busy_timeout` pragma _after_
  `journal_mode`/`synchronous`. `busy_timeout` only governs pragmas issued after
  it, so a process losing the create/open race hit an uncaught
  `SQLITE_BUSY: database is locked` inside `initializeComponents()` and called
  `process.exit(1)` — **before the MCP transport had connected**, which is why the
  client lost the whole server instead of one call. At higher concurrency a second
  error class appeared during WAL-mode conversion (`SQLITE_IOERR`/`SQLITE_CANTOPEN`)
  that `busy_timeout`'s internal retry does not cover at all.

  `busy_timeout` now goes first, and every cross-process-racy open is wrapped in
  `withOpenRetry` — a jittered linear backoff (the jitter matters: without it,
  processes that started racing together retry in lockstep and keep re-colliding).

  **The retry budget is deliberately bounded by the plugin's hook timeout.** Three
  hooks (`annotate-read`, `augment-explore-task`, `api-delta-write`) invoke CLI
  commands that call `createVectorDB().initialize()`, and Claude Code kills a hook
  at 5000 ms with an unmaskable SIGKILL. A ladder that outlived that would leave the
  stale in-flight marker that the npx circuit breaker reads as an unreachable
  registry, silencing every nudge for its 300-second cooldown. The budget is
  therefore 16 attempts × 25 ms — a computed 3904 ms worst case with max jitter,
  about 1.1 s of headroom — and a regression test forces max jitter, sums the real
  requested delays, and fails if a future constant change breaks that ceiling.

  Disclosed honestly: this bound leaves a small residual. The originally reported
  shape (N=4) is clean across 14 trials, but N=6 is 9/10 and N=10 is 5/6. Tighter
  budgets were measured and are _worse_ (1730 ms / 2153 ms / 2579 ms configurations
  all showed 15–33% failure at N=6, so base-delay size matters independently of
  total time). Closing that residual properly means degrading to an honest
  empty-index answer instead of exiting when the ladder is exhausted, which is
  tracked separately.

  Also fixes a latent bug in `SqliteBackend.reconnect()` and
  `OverlayBackend.reconnect()`, and a worse one introduced while fixing it: both
  closed the _old_ handle in a `finally`, so on the failure path — where the swap
  never happened and the "old" handle still **was** `this.db` — the live connection
  was closed, leaving the backend holding a closed database for the rest of the
  process instead of continuing on the still-valid old one. The close now happens
  only after a successful swap, in both backends (`OverlayBackend` retires two
  handles), with a deterministic regression test per backend that forces the open to
  fail and asserts the backend still works.

- 48767ca: `signature` for a class/interface/struct/record/enum (and Rust's
  impl/trait) dropped generic type parameters and the base-type/interface
  list entirely — found in a post-release audit of the published 0.72.0
  artifact. `list_functions` on serilog reported `LogEventPropertyValueVisitor<TState,
TResult>` as bare `class LogEventPropertyValueVisitor` and `Logger :
ILogger, ILogEventSink, IDisposable` as bare `class Logger`, discarding
  exactly the information a model needs to tell one symbol from another and
  to judge blast radius before changing it (`signature` is what
  `list_functions`/`get_dependents` show, not the source).

  Confirmed the same gap and fixed it in six languages: **C#**
  (`class`/`interface`/`struct`/`record`, including `record struct`, plus
  `enum`'s base type, e.g. `enum Status : byte`), **Java**
  (`class`/`interface`/`enum`/`record`), **Kotlin**
  (`class`/`interface`/`object`), **TypeScript** (`class`/`interface`, plus
  plain JavaScript's `extends` clause, which shares the same code path),
  **Swift** (`class`/`struct`/`actor`/`enum`/`extension`/`protocol`), and
  **Rust** (`impl`/`trait` — an `impl` block's `signature` now names the
  trait it implements, e.g. `impl<T> Trait for Type<T>`, previously just
  `impl Type`, silently losing the single most useful fact about an impl
  block). Generic constraints (`where T : class, new()` / Rust's
  `where`-clauses) are deliberately excluded, not truncated — out of scope,
  since a "some constraints, some not" signature would be worse than none.

  Also fixed as a direct consequence, found via dogfooding against Serilog's
  actual `Logger` class: a base/heritage list that itself spans multiple
  physical lines (e.g. a base wrapped in a C# `#if`/`#endif` preprocessor
  block) previously leaked raw newlines into `signature`; all six languages
  now collapse it to a single line via a new shared `collapseWhitespace`
  helper, matching the existing `extractSignature` convention.

  Checked but left unchanged (already correct, not touched): Ruby's `class …
< Base` already includes its superclass. Checked and found to share the
  same gap but out of scope for this fix (no generics/heritage list in the
  task's brief, left as a follow-up): PHP and Python's `class` declarations,
  and Go's generic `type Foo[T any] struct`.

- Updated dependencies [f2937c9]
- Updated dependencies [10474a9]
- Updated dependencies [21c5d55]
- Updated dependencies [48767ca]
  - @liendev/parser@0.73.0
  - @liendev/core@0.73.0

## 0.72.0

### Minor Changes

- 7a87fac: Fix `get_dependents`' risk verdict contradicting its own components (#933),
  and unify its three attribution-caveat flags into one field (#940).

  **#933**: `computeBlastRadiusRisk` only ever factored complexity into the
  verdict through `hasHighComplexityUncovered`, which requires an untested
  dependent to fire at all — so a file with zero untested dependents but a
  `critical`-complexity caller came back `riskLevel: "low"` while its own
  `complexityMetrics.complexityRiskBoost` read `"critical"` (confirmed on
  symfony/console's `Cursor.php`: 4 fully-tested production callers, max
  complexity 31, `riskLevel: "low"`). `riskLevel` is the field
  `instructions.ts` tells agents to gate on before editing an exported symbol,
  so the wrong verdict misled even though the underlying counts were correct.

  Fixed by adding an optional `complexityRiskBoost` input to
  `computeBlastRadiusRisk`: a `high`/`critical` boost now floors the verdict
  one tier below its own severity (`critical` → at least `high`, `high` → at
  least `medium`), regardless of test coverage — testedness lowers the odds
  of a _silent_ break, it doesn't shrink the blast radius. The
  untested-and-high-complexity case (`hasHighComplexityUncovered`) already
  reaches full severity on its own and is unaffected; verified against gin's
  `bytesconv.StringToBytes` (1 untested, critical complexity) staying `high`,
  not escalating to `critical`.

  **#940**: `symbolAttributionDegraded`/`symbolAttributionNote`,
  `dependentAttributionIncomplete`/`dependentAttributionNote`, and `note` all
  meant some version of "this count isn't a verified clear," with three
  different names and shapes for a model to learn — and were mutually
  exclusive by construction, so a single field always sufficed. Replaced with
  one optional `attributionCaveat: { reason, note }`, where `reason` is
  `'unresolved-target' | 'symbol-attribution-degraded' |
'dependent-attribution-incomplete'`. This is a breaking response-shape
  change with no deprecation window — acceptable pre-1.0, and the fields were
  only weeks old. `targetIndexed` stays internal, as before.

  Both `tools.ts`'s tool description and `instructions.ts`'s server
  instructions (the two surfaces a connecting model actually reads) are
  updated accordingly, along with the `symbol` parameter's own schema
  description and the `get_dependents` docs page.

### Patch Changes

- d6c41a7: Follow-up to #930/#936: `annotate` (and the read-hook nudge it powers) now
  prints `"Dependents not determinable from imports (enclosing-namespace
access)."` whenever a C# file's dependents can't be determined from imports
  — the same `dependentAttributionIncomplete` signal `get_dependents` already
  carries, now surfaced in `annotate` too. Previously the annotation stayed
  silent about dependents in exactly this case (a zero-dependent result was
  never printed at all), and could even suppress the whole annotation via the
  low-impact "stay quiet" rule despite dependents being genuinely
  indeterminate rather than genuinely zero.
- fe8160c: #935: a bare same-directory self-import specifier (`import { x } from '.'`)
  was never resolved, so a same-directory barrel re-export test never
  associated with the sibling file(s) it directly imports.

  Root cause: `resolveRelativeImport` only recognized specifiers starting
  with `./` or `../`. JS/TS's import extractor stores the raw source text
  verbatim, and `import { x } from '.'`'s specifier is the literal string
  `"."` — no leading slash, so it fell through unresolved and was stored in
  chunk metadata exactly as written. None of `matchesFile`'s five strategies
  can match an unresolved `"."` against anything.

  Reproduced on a real indexed honojs/hono corpus:
  `src/middleware/jsx-renderer/index.test.tsx` imports its own directory's
  barrel via `from '.'`, and `lien annotate` reported "No test coverage" for
  `src/middleware/jsx-renderer/index.ts` despite the test directly exercising
  it. Same shape on `src/middleware/secure-headers/index.test.ts`.

  Fix: `resolveRelativeImport` now also matches the bare, slash-free `.`/`..`
  themselves (Node/TS module resolution treats them as "this directory" and
  "the parent directory", exactly like their slash-suffixed forms) via a
  single anchored regex, `RELATIVE_IMPORT_PATTERN`. This resolves to the
  importer's own directory (or its parent) the same way an already-supported
  `./` /`../` specifier does, so downstream matching needs no changes.
  Python's own leading-dot relative imports (`.foo`, `..pkg`) are unaffected —
  `PythonImportExtractor` already converts those to the `./`/`../`-prefixed
  form before this function runs (#904), so the new bare-dot case only ever
  fires for languages (JS/TS today) whose extractor stores the raw specifier
  as-is.

  Verified end-to-end on the real hono repro (both files now report their
  own test file under "Test coverage") and via a 25-file coverage sample
  across hono, gin, and flask confirming no regression.

- d525966: Follow-up to #930 (`global using` no longer producing false import edges,
  shipped in #932): removing those false edges alone left `get_dependents`
  reporting a confidently-empty `dependentCount: 0` / `riskLevel: "low"` for a
  C# file with real callers Lien simply has no signal for — a false-all-clear
  that's arguably worse than the fabrication it replaced, since C#'s
  enclosing-namespace access means a real caller needs no per-file `using` at
  all once a `global using` exists for a namespace.

  `get_dependents` now sets `dependentAttributionIncomplete: true` plus a
  `dependentAttributionNote` for exactly that shape (a file-level query with
  zero dependents found, in a language where `hasEnclosingNamespaceAccess` is
  set) — mirroring the `symbolAttributionDegraded` pattern already shipped for
  symbol-level queries (#928). `dependentCount: 0` in that case now reads as
  "the import graph found nothing," not a verified "nothing depends on this
  file."

  This does not recover the true dependents (that needs type-reference-based
  resolution the codebase doesn't have today — tracked separately); it makes
  the failure mode honest instead of silently misleading.

- 988b1d3: #930: `global using Namespace;` was resolved as a file-to-file import of
  every file in that namespace, so a boilerplate `GlobalUsings.cs` (no code,
  just a list of `global using` directives) became a false "dependent" of,
  and false "test coverage" for, every file in every namespace it lists —
  while the file's own `dependentCount`/`riskLevel`/`riskReasoning` were
  computed entirely from that boilerplate. Confirmed on a real 254-file C#
  corpus (serilog/serilog): 13 of 25 sampled files' "confident" test-coverage
  line was driven 100% by `GlobalUsings.cs` pollution; after this fix, zero
  files anywhere in the corpus list a `GlobalUsings.cs` as an importer or as
  test coverage.

  Fixed in `CSharpImportExtractor` (`packages/parser/src/ast/languages/csharp.ts`):
  a `using_directive` node with a leading, unnamed `global` token now
  contributes no import path, since a global using's effect is project-wide,
  not scoped to the file that declares it — that file has no real dependency
  relationship with the namespaces it lists.

  This does not recover the _true_ dependents/test-coverage that a global
  using makes invisible (C# needs no per-file `using` once a global using
  exists for a namespace, so the import graph has no signal for those real
  usages) — that requires a type-reference-based resolution mechanism this
  codebase doesn't have today (unlike the directory-based same-package/
  same-directory heuristics `test-associations.ts` already has for Go/Java),
  and is tracked separately. This change only removes the false edges.

- 6ef268f: Recover real C# `get_dependents` dependents lost to `global using` (#930,
  part 2). #932/#936 stopped the tool from fabricating dependents out of
  `GlobalUsings.cs` boilerplate and made the resulting zero honest
  (`dependentAttributionIncomplete`), but a file with `global using` in scope
  still reported `dependentCount: 0` / `riskLevel: "low"` even when it had
  real callers — honest-and-blind, not correct. Confirmed on a fresh
  serilog/serilog clone: `Alignment.cs` has 5 real production dependents and
  1 real test dependent, none reachable via a per-file import.

  Adds a lower-confidence recovery signal, `findCSharpTypeReferenceDependents`
  (`@liendev/parser`): for a file whose type name is declared exactly once
  project-wide (so a same-named reference elsewhere can't be an unrelated
  declaration — the C# compiler itself would refuse to build over that
  ambiguity), scan every other C# file's source text for an
  identifier-boundary occurrence of that name. Only attempted when the import
  graph found zero dependents for a file-level query on an
  `enclosingNamespaceAccess` language (C# today).

  Recovered dependents are tagged `confidence: "inferred"` on `DependentInfo`
  (a new optional field, absent on every ordinary import-verified dependent)
  and never folded in unhedged — the response also gets a new
  `attributionCaveat` reason, `"dependent-attribution-partial"`, explaining
  that the count is a recovered lower bound, not a verified/complete answer.
  `dependentAttributionIncomplete` now only fires when this recovery attempt
  _also_ finds nothing. Both are purely additive: no existing field is
  removed, renamed, or changed shape.

  Verified end-to-end via the real MCP `get_dependents` tool against a fresh
  serilog/serilog clone: `Alignment.cs` goes from `dependentCount: 0` /
  `"low"` to all 5 real production dependents + its test dependent (`medium`
  risk); `PropertyToken.cs` (a file with a genuine import-verified test
  dependent) is unaffected; a 25-file serilog sample recovered dependents for
  21 files, left 2 honestly `dependent-attribution-incomplete` (no
  recoverable signal), and left 2 real import-based hits untouched; a
  TypeScript control (hono) confirmed zero cross-language impact.

  `tools.ts` and `instructions.ts` (the two model-facing surfaces) are
  updated accordingly.

- 8c3b2ce: #928: `get_dependents` fabricated dependency graphs via language-blind
  bare-module matching — a confident wrong answer, not a degraded one, since
  the tool exists specifically to catch "is this safe to change?" before an
  edit.

  Two independent shapes, found via the foreign-repo dogfood (#917):
  - **Rust `self::`/`super::` collapsed to a directory-less string.**
    `RustImportExtractor` stripped these keywords down to a bare or merely
    `../`-prefixed specifier with no knowledge of the importer's real location,
    which `matchesFile`'s generic bare-identifier leniency (designed for the
    legitimate `crate::auth` -> `src/auth.rs` convention) then had to guess at
    match time — and could coincidentally match an unrelated same-named file
    elsewhere with a single leading directory. Reproduced on tokio-rs/tokio:
    `benches/copy.rs` (a leaf benchmark nothing can import) fuzzy-matched
    `tokio/src/fs/mod.rs`'s `self::copy` and
    `tokio/src/io/util/copy_bidirectional.rs`'s `super::copy`, fabricating 80
    dependents. Fixed by resolving `self::`/`super::` precisely against the
    importer's own file-to-module-aware location (`resolveRustRelativeModulePath`
    in `ast/languages/rust.ts`) instead of the old lossy string convention —
    this also makes real Rust cross-file dependency tracking MORE accurate
    (the 79 real callers of `tokio::fs::copy` are now correctly attributed to
    `tokio/src/fs/copy.rs`, not to the unrelated benchmark).
  - **No existence check before the fuzzy search.** A nonexistent path that
    collides on a namespace/directory suffix with a real file silently
    inherited that file's entire graph — `src/Command/Command.php` (guessed,
    doesn't exist) returned the same 93 dependents as the real
    `Command/Command.php`, because `matchesFile`'s multi-segment boundary
    strategy has no cap on extra leading target directories (deliberately, to
    support e.g. PHP PSR-4 vendor prefixes) — there is no purely textual way to
    tell a real deep path from a fabricated one with the same suffix. Fixed by
    checking the target actually has chunks in the index before running the
    fuzzy search at all (`get_dependents`'s new `targetIndexed` result field);
    an unresolvable target now always comes back with zero dependents and an
    explicit `note`, never someone else's graph.

  Also reconciles the reported `dependentCount`/`riskReasoning` mismatch (e.g.
  `dependentCount: 80` next to `"14 callers"`): the reasoning already counted
  production-only callers by design (test callers shouldn't weigh into risk
  the same way), just without saying so — now labeled "N production callers"
  explicitly.

  `targetIndexed`'s `note` defers to #927's manifest-based `note` whenever both
  would fire for the same target (the overwhelming common case — a
  nonexistent path is both "not in the manifest" and "has no chunks"): only
  one note is ever shown, never two competing explanations of the same zero.

- 1195abe: #929: a direct-importing test file could be omitted from `lien annotate`'s
  "Test coverage" line and from `get_files_context`'s `testAssociations`,
  crowded out by unrelated files that matched only through a false hub.

  Root cause: `matchesFile`'s Strategy 5 (`matchesPythonModule`) applies
  Python's "a bare package import covers every file nested under it" semantic
  unconditionally, regardless of the importer's actual language. A resolved
  bare specifier from any other language can coincidentally look exactly like
  a Python identifier -- confirmed on a real TypeScript repo (hono), where a
  test's own package-root barrel import (`import { Hono } from '../..'`,
  resolved to the bare specifier `src`) matched every single file under `src/`,
  and on a real Go repo (gin), where an ordinary whole-package import
  (`"github.com/gin-gonic/gin/binding"`, resolved to the bare `binding` after
  module-prefix stripping) matched every file in that package directory. Both
  shapes fabricated "this test covers everything" for files with no real
  relationship to the target, sometimes displacing the file's own genuine
  direct importer once the result list was truncated for display.

  Fix: `matchesFile` gains an `allowPythonModuleMatching` parameter (default
  `true`, preserving this function's own behavior for direct callers);
  `importMatchesTarget` -- the shared choke point behind `get_dependents`,
  `get_files_context`, and `lien annotate`'s test-association matching --
  now derives it from the importer's actual language via the new
  `hasPythonModuleSemantics`, mirroring the existing `hasSingleFileImportSemantics`
  (#887) guard. Genuine Python bare-package matching is unaffected (verified:
  zero result changes across a 25-file Python corpus sample).

  Additionally, `collectImportMatchedTests`/`collectImportMatchedTestFiles` now
  rank an exact, literal direct import ahead of any fuzzier match, so a real
  direct importer can no longer sort behind other real matches and be
  truncated out of the displayed list purely due to chunk-scan order. That
  exact-match check applies the same #884 whole-module guard as the fuzzy
  path, so a Swift bare `import Module` can't jump the queue into the exact
  bucket just because the target file's basename happens to equal the module
  name.

- ecf89ae: #869: a measure-gated spike recovering non-import test-association signal
  for Swift/XCTest, where whole-module imports (`import Alamofire`) carry zero
  per-file information (see the existing "not determinable" honesty label).

  New deterministic, zero-LLM signal (`packages/parser/src/swift-symbol-usage-signals.ts`,
  mirroring `stale-literal-signals.ts`'s template): a test chunk's own
  `callSites` versus which single source file uniquely defines the referenced
  symbol. Three gates keep this precise:
  - A new, stricter `isMultiSegmentIdentifier` helper (>= 2 camelCase/
    underscore segments) — the shipped `isUnambiguousIdentifierShape` (docRefs'
    gate) passes every single Capitalized word trivially (`Get`, `Run`,
    `Session`, `Client`), so it's insufficient as a collision-resistance gate
    on its own. Both gates apply together; `isUnambiguousIdentifierShape`
    itself is untouched.
  - `extension <ForeignType>` declarations are excluded from the definition
    side unless the type also has a real, non-extension declaration
    in-project — one false-positive shape measured on Alamofire (a file
    merely extending a Foundation type like `HTTPURLResponse` otherwise looks
    like it "defines" that type to every test that references it).
  - `isTypeShapedIdentifier`: an edge needs at least one leading-uppercase,
    multi-segment driving symbol, or it's demoted. Added after adversarial
    re-verification (opening actual call sites, not just re-confirming
    declaration uniqueness) found real false positives where a bare method
    name collided with something the indexer can't see at all — a stdlib
    protocol witness (`Decoder.singleValueContainer()`), a stdlib type's own
    extension overload (`TaskGroup.addTask(name:...)`), or an external
    package's free function (`swift-dependencies`' `withDependencies`). This
    gate is necessary (one calibration repo failed precision without it) but
    costly: roughly half of all previously-good edges are lost project-wide,
    including every edge to Alamofire's `Request.swift` — see the #869 PR for
    the full before/after precision tables.

  Calibrated on Alamofire/Alamofire plus two additional real Swift repos of
  different shapes (vapor/vapor, pointfreeco/swift-composable-architecture);
  see the #869 PR for the full precision tables.

  Surfaced as a DISTINCT third label tier in `lien annotate` — "inferred from
  symbol usage", never merged into the confident import-based association —
  mirroring #902's Go same-directory tier-2 discipline. Deliberately kept out
  of `get_files_context`, `@liendev/review`'s gap detection, and
  `verify-tests`'s ledger/scope-matching, same conservative call as that
  precedent.

- 5a21f45: Fix `get_dependents({ filepath, symbol })` reporting `dependentCount: 0` /
  `riskLevel: "low"` for methods, constructors, and package-qualified
  functions that have real callers (e.g. Go's `bytesconv.StringToBytes`, PHP's
  `Cursor::__construct`). CLAUDE.md marks this exact call **REQUIRED** before
  any signature change, so the false zero was a confident "safe to edit"
  verdict on code with many callers.

  Two independent causes, both fixed:
  - No language's import statement names a class member or (for Go) a
    package's individual function independently of the class/package itself
    (`use Ns\Cursor;` records `Cursor`, never `__construct`; `import
"app/bytesconv"` records `bytesconv`, never `StringToBytes`). Once a
    chunk is confirmed to import from the target path at all, `get_dependents`
    now also accepts a real call site named `symbol` in that same chunk as
    evidence. When neither a named import nor a call site can confirm usage
    and `symbol` isn't a top-level export (the structural shape of a
    method/constructor query), the response degrades to the file-level answer
    instead of asserting an unverifiable symbol-scoped zero, and sets
    `symbolAttributionDegraded: true` plus a `symbolAttributionNote` so
    callers can tell a floor from a verified count.
  - Go's grouped `import (...)` blocks only ever recorded the first non-stdlib
    spec's symbols, silently dropping every import after it in the same
    declaration from `chunk.metadata.importedSymbols` (confirmed on real gin
    source: `render/json.go` groups `codec/json` and `internal/bytesconv`
    together; only `codec/json` was ever recorded). `processImportSymbols`
    callers now go through a new `processImportSymbolsList`, mirroring the
    existing `extractImportPaths`/`toImportPathsArray` pattern for the plural
    case.

  Verifying the PHP case against a real symfony/console checkout also
  surfaced a PSR-4 empty-root resolution bug that made `get_dependents`
  return false zeros even for plain class-name and file-level queries there —
  independently found and fixed by #926, since merged.

- Updated dependencies [fe8160c]
- Updated dependencies [988b1d3]
- Updated dependencies [6ef268f]
- Updated dependencies [8c3b2ce]
- Updated dependencies [1195abe]
- Updated dependencies [7a87fac]
- Updated dependencies [ecf89ae]
- Updated dependencies [5a21f45]
  - @liendev/parser@0.72.0
  - @liendev/core@0.72.0

## 0.71.1

### Patch Changes

- 1c48852: Fixes #894: `lien annotate` (and every other read-side command that resolves
  a project root without an explicit `--root`/`--path` — `gc`, `path`,
  `store-paths`, `recap`, `nudge`, `verify-tests`) now prefers the nearest
  ancestor directory that has actually completed a `lien index` build over the
  nearest `.git`. Previously, a directory with no `.git` of its own — a
  monorepo subdirectory indexed as its own project, or a repo nested inside a
  larger checkout — would resolve past its own (real, populated) index to an
  unrelated outer `.git` root that was never indexed, silently reporting
  against the wrong store.

  `resolveProjectRoot` (`packages/cli/src/cli/project-root.ts`) is the single
  shared helper behind all of the commands above; the fix lives entirely in
  its resolution algorithm, so every consumer gets it for free. `lien
index`/`init`/`serve` are deliberately unchanged — they take `process.cwd()`
  (or an explicit override) as the root verbatim, which is how a repo-less
  subdirectory gets indexed as its own project in the first place.

  Additionally, `lien annotate` now warns loudly (one line, via stdout — the
  read-hook pipes its stderr to `/dev/null`) instead of silently printing a
  plausible-looking but empty annotation when the resolved root's index has
  never been built, using the same `hasData()` signal the MCP server's
  auto-index gate already relies on.

  `@liendev/core` gains one new export, `VERSION_FILE` (the `.lien-index-version`
  marker filename), so the CLI can check for a completed index synchronously
  without pulling in `readVersionFile`'s async read/parse path.

- Updated dependencies [1c48852]
- Updated dependencies [0620b0b]
  - @liendev/core@0.71.1
  - @liendev/parser@0.71.1

## 0.71.0

### Patch Changes

- bbe0692: Honesty-only fix for #875: C# lets a nested namespace body reference an
  _enclosing_ namespace's members unqualified, with no `using` directive at
  all (`namespace AutoMapper.UnitTests { ... }` can reference
  `AutoMapper.TypeMap` purely via ordinary C# name resolution). Confirmed
  against AutoMapper/AutoMapper: 355/364 `UnitTests/` files rely on exactly
  this and carry no relevant `using`, so import-based test-association has no
  per-file signal for them — a structural gap, not a matching bug. `lien
annotate`'s test-coverage line no longer claims `No test coverage.` on
  these files; it now reports `Test coverage not determinable from imports
(enclosing-namespace access).` instead, for any language whose new
  `LanguageDefinition.enclosingNamespaceAccess` flag is set (only C# today,
  checked via the new `hasEnclosingNamespaceAccess()` export).

  This is deliberately a separate flag from `wholeModuleImports`: C#'s
  _explicit_ dotted `using AutoMapper.X;` still resolves real per-file
  associations correctly (the other 9/364 files, #866/#868) — folding this
  into `wholeModuleImports` would make `isUnresolvableWholeModuleImport`
  discard those working usings too (C# usings are dotted, never slashed, so
  every one of them is "bare" by that check) and regress them. No heuristic
  recovery (no name-proximity matching) — every other language's wording and
  behavior is unchanged.

- f65df04: Fixes #902: Go's dominant same-package unit-test convention (`foo_test.go`
  in the same directory and `package foo` as `foo.go`, with NO import
  statement at all — Go forbids a package importing itself) left import-based
  test-association matching structurally blind to it. Measured against a real
  `cli/cli` clone: 336/356 (94.4%) of `_test.go` files basename-pair with a
  same-named sibling; applying that pairing to the 457 files the issue
  identified as having a same-directory `_test.go` sibling closes the entire
  previously-dark set.

  Two tiers, no AST/package-clause parsing needed (Go's compiler already
  enforces one package per directory, so same-directory is itself reliable
  evidence):
  - **Tier 1 — basename pairing** (`foo.go` <-> `foo_test.go`, same
    directory): folded directly into the existing test-association signal
    everywhere it's computed (`findTestAssociationsFromChunks`,
    `get_files_context`'s `testAssociations`), so it flows through to
    `lien annotate`, the MCP-mandated `get_files_context` tool,
    `@liendev/review`'s test-coverage signals, and `verify-tests`/`recap`
    automatically — no signature changes.
  - **Tier 2 — package-level fallback** (every `_test.go` file in the
    directory, only when tier 1 finds nothing for that specific file): real,
    same-package signal but coarser, so it gets a distinct, honestly-worded
    label scoped only to `lien annotate`'s printed text (mirroring the
    #869/#875 Swift/C# honesty-label precedent) — deliberately not folded
    into `get_files_context`, `@liendev/review`'s gap detection, or
    `verify-tests`'s ledger/scope-matching.

  New `LanguageDefinition.sameDirectoryTestConvention` flag (Go only) +
  `hasSameDirectoryTestConvention()` registry predicate, and a new
  `go-same-directory-tests.ts` module (`buildGoTestDirIndex`,
  `pairGoBasenameTest`, `findGoPackageLevelTests`) exported from
  `@liendev/parser`.

- 0ad6608: Fixes #908: `isCoveredByScope` (the did-you-run-the-tests nudge behind
  `lien verify-tests note-run`/`report`/`recap`) now recognizes a
  directory-scoped test run as covering the files inside it, not just an
  exact basename/stem match. Go's own idiomatic `go test` invocation always
  names a package directory, never an individual file — `go test
./pkg/x/...` (recursive) and `go test ./pkg/x` (that package only, no
  subdirectories) previously matched nothing and left the whole package
  nagging as unverified even after a correctly, narrowly-targeted run.

  The new directory-scope check is path-segment-aware, not a string prefix:
  `./pkg/cmd/label` (with or without the recursive `/...` suffix) does not
  cover a different, unrelated package that merely shares a text prefix
  (`./pkg/cmd/labeler`). The check is intentionally not Go-gated — any scope
  token that names a directory rather than a specific file (no recognized
  source extension) gets the same treatment, since `scopeTokens` carry no
  record of which runner produced them and the same directory-scope
  reasoning is valid for any other ecosystem's directory-scoped invocation
  (e.g. `pytest tests/unit/`).

  Purely additive: existing basename/stem matching, `classifyTestCommand`,
  and every current `RUNNER_PATTERNS` entry are unchanged.

- 4d1a872: Fix #905: `RUNNER_PATTERNS` in the did-you-run-the-tests nudge (`lien
verify-tests note-run`) now sees through package-manager/environment-runner
  wrapper prefixes — `uv run pytest`, `poetry run pytest tests/foo.py`,
  `pipenv run pytest`, `rye run pytest`, and `pdm run pytest` all classify
  exactly like their unwrapped form, including flags-with-values on the
  wrapper's own invocation (`uv run --group tests pytest`). Also adds `tox`
  (and `nox`) as recognized runners in their own right — `tox`/`tox run`/`tox
-e py311` are broad (no file named), while a `--` passthrough naming a path
  (`tox -e py311 -- tests/test_x.py`) is scoped, same convention already
  supported for `npm test -- path/to/x.test.ts`. Together these recognize
  flask's own real CI command (`uv run --locked --no-default-groups --group
dev tox run`), which previously went completely unrecognized. Purely
  additive recognition — `isCoveredByScope` and every existing pattern are
  unchanged.
- Updated dependencies [bbe0692]
- Updated dependencies [6fc55ab]
- Updated dependencies [f65df04]
- Updated dependencies [db565d2]
- Updated dependencies [da1ec69]
- Updated dependencies [99cf7e5]
- Updated dependencies [ac0480f]
- Updated dependencies [4a863f2]
  - @liendev/parser@0.71.0
  - @liendev/core@0.71.0

## 0.70.0

### Patch Changes

- e017f0b: `RUNNER_PATTERNS` in the did-you-run-the-tests nudge (`lien verify-tests
note-run`) now recognizes each swept ecosystem's own standard test-invocation
  form: Ruby's Rake/Minitest convention (`rake test`, `rake test:core`,
  `bundle exec rake test:core`, or any other `test:<namespaced-task>` form),
  PHP's vendored/wrapped phpunit
  (`vendor/bin/phpunit`, `./vendor/bin/phpunit`) and Composer script alias
  (`composer test`), Swift's SwiftPM invocation (`swift test`, `swift test
--filter X`), and the Gradle wrapper script, including common multi-task
  invocations (`./gradlew test`, `./gradlew clean test`, `./gradlew
:module:test`, `gradlew test`). Previously these commands silently failed to
  register as a test run, so the nudge kept nagging even after the correct
  tests had genuinely been run. Purely additive recognition — `isCoveredByScope`
  is untouched, and the only existing pattern modification is folding the bare
  `phpunit` pattern into a strict superset that also matches vendored paths;
  every other existing pattern is unchanged, so no prior classification moves.
- 4a51d22: Honesty-only fix for #869: for whole-module-import languages (Swift's
  `import Alamofire` / `@testable import Alamofire` gives import-based
  matching no per-file signal to work with — a structural gap, not a
  matching bug), `lien annotate`'s test-coverage line no longer claims `No
test coverage.` on files that may in fact be heavily tested. It now reports
  `Test coverage not determinable from imports (whole-module import).`
  instead, for any language whose `LanguageDefinition.wholeModuleImports` flag
  is set (only Swift today, checked via the new `hasWholeModuleImports()`
  export). No heuristic recovery (no `Package.swift` parsing, no
  name-proximity matching) — every other language's wording and behavior is
  unchanged.
- 7c9316f: Fix #884: a source file whose basename coincidentally equals its own
  module's name (Swift's `Source/Alamofire.swift` in the `Alamofire` module)
  sat inside #868/#883's deliberate one-leading-segment leniency window (the
  same window that legitimately allows Rust's bare `auth` -> `src/auth.rs`)
  and falsely hubbed every whole-module test file (`import Alamofire`) onto
  that one file — reported as ~38 test associations and ~43 dependents on a
  43-line file.

  Extends #869's honesty treatment rather than touching the shared matcher:
  for a `wholeModuleImports` language (Swift), `SwiftImportExtractor` never
  emits anything but the bare module name, so the _only_ way such an import
  can ever win a `matchesFile` comparison is this coincidental basename
  match — never a real per-file relationship. New
  `isUnresolvableWholeModuleImport(importSpecifier, importerFile)` in
  `@liendev/parser` lets callers skip a bare whole-module import before it
  ever reaches `matchesFile`, wired into all seven callers that
  independently implement import matching: `findTestAssociationsFromChunks`,
  `analyzeDependencies`/`buildImportIndex`, the exported `chunkImportsFrom`
  primitive, and `collectImportedSymbolsFromSource` (the shared re-export
  symbol collector behind `findReExportedSymbolsForFile`) in
  `@liendev/parser` — plus the CLI's own `get_dependents` import index,
  `get_files_context`'s `findTestAssociations`, and `get_dependents`'s
  symbol-level `fileImportsSymbolFromAny`. Covers the "N files import this"
  dependents count, `lien annotate`'s dependents line, the
  `testAssociations` field every pre-edit `get_files_context` call returns,
  symbol-level `get_dependents` queries, re-export/barrel-file tracking, and
  `get_complexity`'s dependents. `Source/Alamofire.swift` now correctly
  falls back to #869's "not determinable from imports" signal (or an empty
  dependents/test-associations/re-export result) everywhere instead of
  reporting a false hub.

  `matchesAtBoundaryPrecise`'s general one-leading-segment guard is
  untouched — Rust's `auth` -> `src/auth.rs` and every other non-whole-module
  language keep matching exactly as before; the fix is scoped entirely to the
  caller layer for `wholeModuleImports` languages.

- Updated dependencies [0867ea3]
- Updated dependencies [94e7fd2]
- Updated dependencies [6e65321]
- Updated dependencies [a7cf15c]
- Updated dependencies [f730ac1]
- Updated dependencies [4a51d22]
- Updated dependencies [7c9316f]
  - @liendev/parser@0.70.0
  - @liendev/core@0.70.0

## 0.69.1

### Patch Changes

- Updated dependencies [242892d]
- Updated dependencies [cf0d462]
- Updated dependencies [4fd502b]
  - @liendev/parser@0.69.1
  - @liendev/core@0.69.1

## 0.69.0

### Minor Changes

- a8b279b: Add nudge telemetry v2 (shown → acted-on funnels) and a habituation guard on the read-time annotation. The nudges talked; now `lien stats` checks whether anyone listens, and the read annotation talks only when it counts. Everything is deterministic, zero-LLM, local-only, and fail-open. The funnels are observational — "acted-on" is a same-session, later-in-time co-occurrence, not proof the nudge caused the action; `lien stats` says so verbatim, and no lift claim is made anywhere. See docs/architecture/nudge-telemetry.md.
  - **Funnels in `lien stats`.** A new durable, session-id-keyed JSONL log (`packages/cli/src/utils/nudge-events.ts`, `<indexDir>/nudge-events.jsonl`) records `shown` events (a nudge surfaced) and `signal` events (a follow-up tool call), joined at report time (`nudge-stats.ts`) into per-nudge "shown → acted-on" funnels over 7/30-day windows: complexity delta (reused from `delta-events.jsonl` — `resolvedAfterFlag`), read-time impact (→ `get_files_context`/`get_dependents`), exported-signature (→ `get_dependents`), did-you-run-tests (→ a recognized test run). Unlike the session-GC'd test-ledger, this log accumulates across sessions (the 7/30-day windows require it) and is bounded by the same 2 MB front-trim as its siblings. Kill switch: `LIEN_NUDGE_EVENTS=off`.
  - **New `lien nudge <note-shown|note-signal>`** command group (fail-open, like `verify-tests`): the emitting hooks call `note-shown` when a nudge fires; a new `nudge-signal.sh` (`PostToolUse` on the Lien MCP tools, prefix-robust matcher) calls `note-signal` on `get_dependents`/`get_files_context`; and `verify-tests note-run` fans one `test_run` signal by reusing its single `classifyTestCommand` detection (no second detector, the session test-ledger untouched).
  - **Habituation guard** on `annotate-read.sh` (default on; opt out with `LIEN_ANNOTATE_GUARD=off`): (a) per-session dedup — annotate a file at most once per session, integrating with the existing touchfile rather than stacking a new mechanism; (b) a risk floor — `lien annotate --min-risk <level>` (`LIEN_ANNOTATE_MIN_RISK`, default `medium`) suppresses below-floor files unless they carry a complexity/headroom concern, which always fire. The `medium` default is grounded in this repo's distribution (86% of source files currently annotate; ~30% are low-risk, 16% pure habituation) and documented. No cooldowns or cross-session state; the write-side nudges are unchanged. Guard off = byte-for-byte the previous always-on behavior.

- d8f5303: Add the session risk-ledger recap: a single Stop-time advisory that re-raises UNRESOLVED risk from the current session at the finish line. A nudge shown at minute 5 is gone from context by minute 90; the recap consolidates three per-session signals and surfaces whatever is still unresolved when the agent tries to stop, as exactly one block per stop episode. Zero-LLM, local-only, fail-open. It replaces the single-source `test-verify-stop.sh`, folding the unrun-tests advisory in verbatim. See docs/architecture/session-risk-recap.md.
  - **New `lien recap --session <id>`** (`packages/cli/src/cli/recap-cmd.ts`) + a pure, unit-tested join (`packages/cli/src/utils/session-recap.ts`). Three UNRESOLVED-only sources — the credibility axis, since a recap item the agent already fixed destroys trust: (1) **tests** reuse `computeUnverifiedFiles` and the frozen advisory verbatim (a tests-only recap is byte-identical to the old `verify-tests report`); (2) **delta** is a LIVE working-tree `lien delta` recompute (via the shared `computeComplexityDelta` primitive) scoped to session-touched files — a crossing already simplified reads clean right now and never appears; (3) **blast** inverts the `nudge-stats` blast matched-join — a blast nudge shown this session with no later `get_dependents` for its symbol/file.
  - **Why a live delta, not the event log:** `delta-events.jsonl` has no `session_id`, no before/after values, and no unambiguous per-file resolution signal, so it can't back a clean session-scoped, numerically-rich, resolution-accurate join. The recap asks the same question `lien delta` asks, live at Stop, and can't diverge from it.
  - **`recap-stop.sh`** replaces `test-verify-stop.sh` (kill switch `LIEN_RECAP=off`) and emits one `{"decision":"block","reason":...}` for all recap content. Both loop-prevention layers from #843 are kept — `stop_hook_active` plus the ledger recent-block suppression window — reusing the same `blocked` event so there is one suppression window across all sources. `recordBlocked` is now exempt from `LIEN_TEST_VERIFY=off` so a delta/blast-only recap still self-suppresses.
  - **PreCompact half dropped, with evidence:** a `PreCompact` hook has no documented channel to inject into the compaction summary or the post-compaction context (only `decision:block`, which blocks compaction and is shown to the user), so the recap ships Stop-only; the command is session-scoped and reusable if a `SessionStart:compact` surface is added later.

### Patch Changes

- 2fa5ed1: Fix the session-recap `blocked` loop-prevention marker so its write obeys one consistent switch, `LIEN_RECAP`, everywhere. `recordBlocked` is exempt from `LIEN_TEST_VERIFY=off` by design (it's the recap's loop-prevention, not test-verify recording), but the legacy `lien verify-tests report` path (`runReport`) previously gated it by neither switch — so a user with the recap disabled still wrote a suppressing marker. `runReport` now gates the write on `recapEnabled()`, matching the recap hook path, via a single shared `recapEnabled()` helper in `test-ledger.ts`.

## 0.68.0

### Minor Changes

- 6063324: Add the blast-radius nudge — closing the honor-system gap in CLAUDE.md's "run `get_dependents` before changing an exported symbol's signature" rule, the same way `lien delta` already automates the complexity rule.
  - New `lien api-delta` command: detects, content-only (`chunkFile`'s existing exported-name and signature metadata, zero index), when a working-tree edit changed or removed the signature of an exported function or class method. `--file <path>` mirrors `lien delta`'s fast path for the edit hook; `--base <ref>` mirrors CI parity. Advisory only — there is no gate, so it always exits 0; the JSON `changes[]` array is what a caller reads.
  - Best-effort enrichment against the structural index (`findDependents` + the shared blast-radius-risk primitive) adds dependent counts and a risk level when an index is available; degrades gracefully (signature-only, no counts) when it isn't, or if the lookup fails for a given symbol — never blocks, never throws.
  - The Claude Code plugin gains an `api-delta-write.sh` hook on `PostToolUse:Edit|Write|MultiEdit` (a sibling of `delta-write.sh` and `test-reminder.sh`) that surfaces a one-line warning via `additionalContext` after an edit that changed/removed an exported signature. Kill switch: `LIEN_BLAST_HOOK=off`.
  - A local, append-only `blast-events.jsonl` ledger (kill switch `LIEN_BLAST_EVENTS=off`) records every edit that changed an exported signature; `lien stats` gains a second "exported-signature nudge" section (7/30-day runs, distinct symbols changed, risk-level breakdown) alongside the existing complexity-delta stats, additive to the existing JSON shape.

- 8c87642: Shift docs-drift detection left onto the blast-radius nudge: when `lien api-delta` detects a REMOVED exported symbol, it now also reports how many indexed documentation chunks still reference it.
  - `@liendev/parser` gains `wordBoundaryRe` and `isDistinctiveToken`, lifted out of the review engine's docs-drift pass (`packages/review/src/docs-drift-signals.ts`, now a thin consumer of these instead of duplicating them) so the CLI can reuse the exact same word-boundary + distinctiveness matching precision.
  - `lien api-delta`'s enrichment gains `docRefCount`/`docRefPaths` on every `removed` change (`null`/`[]` for `signature-changed`, or when the index is unavailable): a zero-LLM, fail-open lookup over the indexed `type: 'doc'` chunks for the removed symbol's name.
  - The `api-delta-write.sh` PostToolUse hook appends a short sentence to its existing warning — `"N docs reference X: path1, path2, path3 (+K more)."` — when a removed symbol still has doc references; silent otherwise.
  - The `blast-events.jsonl` ledger gains an additive, optional `docRefCount` field per change.

- 2833f1c: Add the did-you-run-the-tests verification nudge — a session-scoped ledger that advises, at session Stop, on edited files whose associated tests were never observed running in a Bash command. Closes the honor-system gap in CLAUDE.md's "Verification Before Done" rule the same way `lien delta` and the blast-radius nudge already automate the complexity and `get_dependents` rules.
  - New `lien verify-tests <note-edit|note-run|report>` command group: `note-edit` records an edited file's test associations (replacing `annotate --tests-only` in the edit hook, byte-identical reminder text) and prints the same reminder; `note-run` records a Bash command as a test run when `classifyTestCommand` recognizes it; `report` reads the session ledger and prints an advisory naming edited files whose associated tests were never observed running, or nothing when everything's covered.
  - Pure `classifyTestCommand`/`computeUnverifiedFiles` (`packages/cli/src/utils/test-run-matcher.ts`): a conservative test-runner allow-list (npm/yarn/pnpm/bun/vitest/jest/mocha/pytest/go/cargo/rspec/phpunit/dotnet/deno/gradle/mvn, plus workspace-scoped forms) classifies a command as broad (whole-suite) or scoped (specific files); any observed broad run silences the report entirely, and scoped-run coverage matching is deliberately generous to bias toward silence over a false "you didn't test" nag.
  - Session-scoped, append-only ledger (`packages/cli/src/utils/test-ledger.ts`, `<indexDir>/test-sessions/<sessionId>.jsonl`), cleaned up at SessionEnd and by SessionStart's 24h GC alongside the existing `annotated-sessions/` cleanup. Kill switch: `LIEN_TEST_VERIFY=off`.
  - The Claude Code plugin gains two new hooks: `test-run-note.sh` (`PostToolUse:Bash`, silent recording only, with a coarse shell pre-filter so a non-test command never spawns a `lien` process) and `test-verify-stop.sh` (`Stop`, the model-visible surface — blocks the stop once with an advisory `reason` when unverified tests exist, with `stop_hook_active` loop prevention). `test-reminder.sh` is rewired to call `verify-tests note-edit` instead of `annotate --tests-only`, so one process now both reminds and records.

### Patch Changes

- Updated dependencies [8c87642]
  - @liendev/parser@0.68.0
  - @liendev/core@0.68.0

## 0.67.0

### Minor Changes

- ead2bc9: feat(parser,core): YAML structural chunking for `search_code`

  YAML files (`.yml`/`.yaml`) are now chunked by top-level mapping key instead
  of the generic fixed-size line window, so `search_code` / `get_files_context`
  can retrieve a coherent config section (e.g. a GitHub Actions `jobs.review`
  block) rather than an arbitrary 75-line slice.
  - **New chunk kind** (`packages/parser/src/yaml-chunker.ts`): YAML chunks are
    tagged `type: 'config'`, `language: 'yaml'`, with `metadata.symbolName`
    carrying a dotted key-path breadcrumb (e.g. `jobs.review.env`) built from an
    indentation ancestor stack, analogous to the markdown chunker's heading
    stack. Multi-document files (`---`/`...` separators) prefix breadcrumbs
    with `doc[N]`. Pure line heuristics — no real YAML parser is invoked — so
    the chunker never throws on malformed, partial, or templated (Helm/Jinja)
    input; a document with zero top-level keys degrades to a single
    whole-document chunk.
  - **`type: 'config'` is excluded from symbol-lookup** (`core`'s
    `matchesSymbolFilter` and `review`'s `listFunctions`, mirroring the
    existing `'doc'` exclusion): key-path breadcrumbs aren't code symbols, so
    they never surface via `list_functions`/`querySymbols`, but remain fully
    searchable via `search_code` and retrievable via `get_files_context`.
  - **CI workflow coverage**: the default include-pattern list now adds
    `.github/**/*.yml` and `.github/**/*.yaml` alongside the plain `**/*.yml`/
    `**/*.yaml` patterns. This is required, not cosmetic — glob's default
    `dot:false` means a bare `**/*.yml` never descends into a dot-directory
    like `.github/`, so without the explicit `.github/**` entries, CI workflow
    YAML (`.github/workflows/*.yml`) would silently never be indexed. Other
    dot-directory CI configs (`.circleci/`, a root `.gitlab-ci.yml`) remain
    out of scope for now.
  - `pnpm-lock.yaml` is added to the always-ignored patterns (this repo uses
    npm and has none, but the exclusion is defensive for consumers who do).

  Dogfooded against this repo's own index: previously-unindexable content in
  `.github/workflows/*.yml` and `packages/action/action.yml` (e.g. harness
  evidence-gate skip logic, review token-budget allocation) is now retrievable
  via `search_code`, with `get_files_context` showing `type: 'config'` chunks
  and `jobs`/`on`/`permissions`-style breadcrumbs.

### Patch Changes

- Updated dependencies [ead2bc9]
  - @liendev/parser@0.67.0
  - @liendev/core@0.67.0

## 0.66.0

### Minor Changes

- 19188f7: Add the plan-time complexity nudge — surfacing near/over-budget functions as an imperative warning _before_ an agent edits, not just after (`lien delta`) or as inert data (`get_files_context`'s `complexityHeadroom`).
  - `get_files_context` gains an optional `complexityHeadroomWarning` string field, spread ahead of `complexityHeadroom` in the response so it's the first thing an agent reads when a function in the file is at/near its complexity budget. Purely additive — `complexityHeadroom` itself is unchanged.
  - `lien annotate` (and therefore the plugin's `annotate-read.sh` read-hook) now computes the same headroom for the file it annotates and, when non-empty, leads the printed annotation with the same shared warning line — reusing `get_files_context`'s exact computation so the two can never disagree. The annotation now also fires (instead of staying silent) when a file has a near-budget function even if it would otherwise look trivial (no dependents, existing test coverage).
  - No new hook: a `PreToolUse:Edit|Write` hook was considered and rejected — per `docs/architecture/claude-code-hook-channels.md`, `PreToolUse` has no channel that delivers model-visible content for `Edit`/`Write` without either doing nothing or blocking the edit outright (`exit 2`). The existing `PostToolUse:Read` annotation hook already fires right before the mandatory `get_files_context` → `Edit` sequence, so it carries the nudge instead — inheriting the existing per-file TTL suppression for free.

- a662147: Add the post-edit test-association reminder — closing the read → write → verify loop the way the plan-time nudge closed read → write.
  - `lien annotate` gains a `--tests-only` flag: prints one compact line naming the tests associated with the file ("Lien: you changed \<file\> — associated tests: \<tests\>. Run them before completing."), or nothing when the file has no associated tests. It's the cheap path — a single index scan for test associations, skipping the full annotation's dependency-graph BFS and complexity analysis entirely.
  - The Claude Code plugin gains a `test-reminder.sh` hook on `PostToolUse:Edit|Write|MultiEdit` (a sibling of `delta-write.sh`, each script stays single-purpose) that surfaces that line via `additionalContext` after an edit. Silent when there are no associations or the repo has no index; TTL-suppressed per file per session (same touchfile pattern as `annotate-read.sh`, namespaced so the two never collide); fail-open throughout — hook errors never block the edit. Kill switch: `LIEN_TEST_REMINDER=off`.

### Patch Changes

- 0e74ffb: Cap the complexity headroom warning line at the 3 worst entries. A dogfood run of PR #772 surfaced a real 5-entry file rendering as a ~250-char single line — past 3-4 entries the warning became hard to read. The line now shows the 3 worst entries (over-threshold first, by highest overage ratio, then nearest-to-threshold) and folds anything beyond that into an explicit "… and N more at/near budget" remainder — never a silent truncation. The full, uncapped list is unaffected: `get_files_context`'s `complexityHeadroom` array still carries every near/over-budget entry; only the human-readable warning string is capped. Shared by both consumers (`get_files_context`'s `complexityHeadroomWarning` field and `lien annotate`'s printed nudge line) since both call the one formatter.
- Updated dependencies [8175bf5]
  - @liendev/parser@0.66.0
  - @liendev/core@0.66.0

## 0.65.0

### Minor Changes

- 7aaf413: `search_code` now blends BM25 with structural importance instead of ranking by lexical relevance alone.
  - **Ranking boost** (`packages/core/src/vectordb/sqlite/fts-search.ts`): within the already-fetched bm25 candidate window, each result's relevance ratio is multiplied by `min(2, 1 + 0.15 * log(1 + dependentCount))` — `dependentCount` being how many other indexed files import that file (a cheap, index-connection-cached approximation; see `dependent-counts.ts`, not the authoritative `get_dependents` analysis). `log1p` keeps the boost sublinear, the `min(2, ...)` caps runaway growth for pathologically large dependentCounts, and the result is never less than the original ratio, so bm25 still dominates in the normal case and the boost usually just breaks ties. Caveat: because relevance bands are continuous, no capped multiplicative boost can _guarantee_ it never crosses a band — a very well-connected hub file with a merely-relevant match can still outrank an unconnected file with a marginally-better lexical match. This is an accepted tradeoff, not a bug. Set `LIEN_STRUCTURAL_RANKING=off` to fall back to pure bm25 ordering.
  - **Richer metadata**: `search_code` results now carry `metadata.dependentCount` inline (added to its metadata-shaper allowlist) so an agent can triage a result's blast radius without a follow-up `get_dependents` call. Populated unconditionally, independent of the ranking flag above.

  Dogfooded against this repo's own index across 8 representative queries: the top hit never changed for any query; 3/8 queries saw lower-ranked slots (positions 3-5) reorder in favor of files with more dependents (e.g. a test fixture function displaced by the production file it tests; a docs appendix displaced by the implementation file it describes).

- a215a4d: Add local `lien delta` event recording + `lien stats` — the first move of measuring whether the nudge loop actually works.

  Every `lien delta` invocation (manual, the plugin's write-time hook, or a CI `--base` run) now appends one line to a local, append-only `delta-events.jsonl` next to your project's index (`~/.lien/indices/<repoId>/`). This is instrumented in the `lien delta` command itself, not the shell hook, so every invocation path counts the same way. Strictly local: no network call, no telemetry, nothing leaves your machine. The log is capped (trimmed from the front past 2 MB) so it never grows unbounded. Disable recording entirely with `LIEN_DELTA_EVENTS=off`.
  - **`lien stats`** — a new command reporting 7/30-day windows: total `lien delta` runs, runs with new crossings, distinct functions flagged, and functions later seen clean after being flagged (`resolvedAfterFlag` — an honest presence/absence signal, not a causal claim that the warning caused the fix), plus the share of flagged runs that were `--soft`.
  - Kept as a separate command rather than folded into `lien status`: `status` is a point-in-time index-health snapshot: `stats` aggregates a growing historical log over time windows — different data shape, different concern.

### Patch Changes

- Updated dependencies [7aaf413]
  - @liendev/core@0.65.0

## 0.64.2

### Patch Changes

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
- Updated dependencies [e2b0e24]
- Updated dependencies [93191c4]
- Updated dependencies [8d1056c]
  - @liendev/parser@0.64.2
  - @liendev/core@0.64.2

## 0.64.1

### Patch Changes

- 12c70ad: refactor: single source of truth for re-export intersection logic
- Updated dependencies [12c70ad]
  - @liendev/parser@0.64.1

## 0.64.0

### Patch Changes

- Updated dependencies [c6abb00]
  - @liendev/parser@0.64.0
  - @liendev/core@0.64.0

## 0.63.0

### Patch Changes

- Updated dependencies [b0da86b]
  - @liendev/core@0.63.0

## 0.62.0

### Patch Changes

- Updated dependencies [2b2e259]
  - @liendev/parser@0.62.0
  - @liendev/core@0.62.0

## 0.61.0

### Minor Changes

- d5c1fc2: `lien delta --base <ref>` — compare against any ref, not just `HEAD`, and give the sixth commit gate a CI backstop.

  Until now `lien delta` only ever compared the working tree to `HEAD`, so a crossing introduced by an earlier commit in a PR (already sitting at `HEAD`, with a clean working tree) was invisible to the gate — the other five commit gates are enforced in CI, but this one ran purely on an agent's honor system. `--base <ref>` compares the current state against any ref instead: `git diff --name-status` scoped to that ref, `before` content read via `git show <ref>:path`, same file filtering and edge-case handling (added/deleted/renamed/unborn) as the default mode. Composes with `--file`, `--format json`, `--soft`, and `--threshold`; omitting `--base` is byte-for-byte unchanged.

  CI now runs `lien delta --base "origin/$GITHUB_BASE_REF"` on every pull request, so a complexity crossing introduced anywhere in a PR's commits — not just its latest one — fails the build instead of merging silently.

### Patch Changes

- Updated dependencies [5789e1c]
- Updated dependencies [e6efbb3]
- Updated dependencies [a39644a]
  - @liendev/parser@0.61.0
  - @liendev/core@0.61.0

## 0.60.0

### Minor Changes

- 58234a7: feat(gc): garbage-collect stale and orphaned index directories

  `~/.lien/indices` accumulated one directory per project root ever opened —
  repos, worktrees, clones, scratch dirs — and nothing ever removed them. This
  adds index garbage collection.

  New `lien gc` command:
  - **Orphan GC (default):** removes indices whose recorded source root no longer
    exists on disk. The core indexer now records `sourceRoot` in `manifest.json`
    at index time; legacy indices lacking it are reported as "unknown provenance"
    and removed only via `--stale`. Missing roots on an offline `/Volumes` mount
    (unplugged external drive) are skipped, not treated as orphans.
  - **Legacy lance sweep (default):** removes dead `code_chunks.lance` directories
    left inside surviving index dirs after the LanceDB removal (#661).
  - **`--stale [days]` (opt-in, default 60):** removes indices not accessed within
    N days, using a new `.lien-accessed` stamp touched on serve start.
  - **`--dry-run`** previews every candidate with size and reason and deletes
    nothing; a summary (removed / freed / skipped) always prints. `--format json`
    is available for scripting.
  - **Safety rails:** never deletes the current project's index, and skips any
    index a live process holds open (probed via a `BEGIN IMMEDIATE` busy-check on
    its `structural.db`). Deletions happen one directory at a time.

  Auto-GC on serve start: after the MCP server is up, a background, non-blocking
  pass runs orphan GC + the lance sweep (never stale GC), throttled machine-wide
  to at most once per 24h via a stamp + atomic lock so piled-up serves don't
  stampede. It logs a single line only when something was collected. Opt out with
  `LIEN_AUTO_GC=off`.

### Patch Changes

- Updated dependencies [58234a7]
  - @liendev/core@0.60.0

## 0.59.0

### Patch Changes

- 62d12ec: fix(core): make worktree overlay rebuilds reader-atomic and livelock-free

  Two composing concurrency bugs in worktree overlay indexing (shipped in #667)
  could make `list_functions` / `querySymbols` intermittently return 0 results for
  a file that exists, while the overlay's `indexVersion` churned with zero file
  edits when more than one `lien serve` had the worktree as cwd.
  - **Reader atomicity.** `buildOverlay` no longer clears then repopulates the
    overlay across many autocommitted statements. It now does all scan/hash/chunk
    work up front, then applies the whole swap (delete + insert of chunks and
    mask, plus metadata) in ONE `BEGIN IMMEDIATE` transaction via
    `OverlayBackend.applyRebuild`, so other connections observe the rebuild
    all-or-nothing under WAL snapshot isolation — never a base file masked with no
    replacement rows. Disk reclamation moves to a best-effort post-commit
    `VACUUM` + WAL checkpoint (same file identity, preserving #667's multi-process
    safety fix). Union reads (`unionRecords`, `search`, `scanPaginated`) now read
    overlay rows + mask inside one deferred snapshot so a commit landing between
    the two statements can't be seen half-applied.
  - **Rebuild livelock.** A rebuild that reproduces a byte-identical overlay
    (same diverged-file/hash set + mask) no longer bumps the version stamp — a
    cheap content signature, checked inside the swap transaction, makes redundant
    rebuilds silent. So piled-up serves stop mutually re-triggering reconnects and
    rebuilds; genuine content changes still bump. A `SQLITE_BUSY` busy-skip lets a
    peer's in-flight rebuild serve everyone rather than contending.

- Updated dependencies [62d12ec]
- Updated dependencies [68e98ef]
  - @liendev/core@0.59.0
  - @liendev/parser@0.59.0

## 0.58.1

### Patch Changes

- 2901b56: Fix `get_dependents` reporting complexity metrics for files that aren't actually dependents. For symbol-level queries, `complexityMetrics`/`highComplexityDependents`/`riskReasoning` were computed from the pre-symbol-filter candidate set (every file that imports the target file) instead of the resolved `dependents` list, so an unrelated file that merely imports the target — without using the requested symbol — could inflate the reported risk even when zero real dependents were found. Complexity is now joined against exactly the resolved dependents.

## 0.58.0

### Minor Changes

- 6e502dd: `lien delta` Phase 2 — surface the complexity-delta verdict at the moment of the edit.

  Phase 1 made the verdict available as a gate the agent chooses to run. Phase 2 moves it to edit time via two advisory (non-blocking) mechanisms, plus fixes for five review findings on the Phase-1 code.
  - **PostToolUse edit hook** (`plugins/claude/hooks/delta-write.sh`, registered in the Claude Code plugin): after an `Edit`/`Write`/`MultiEdit`, computes the complexity delta for just that file and emits an `additionalContext` warning **only** when the edit introduces a NEW threshold crossing. Silent otherwise. Driven by a new single-file fast path.
  - **`lien delta --file <path>`**: analyze one file vs `HEAD` (instead of scanning the whole working tree) — bounds the per-edit hook to the file that changed. Resolves absolute-or-relative paths and canonicalizes symlinked segments; out-of-repo, unsupported, or absent files produce no output.
  - **`get_files_context` complexity headroom**: the response now includes a lean `complexityHeadroom` array listing functions at ≥ 80% of a cyclomatic/cognitive budget (worst-first, capped, with an overflow count), computed from complexity metrics already stored in the index (no re-parse). It lets an agent steer around near-budget functions before editing. Omitted entirely when nothing is near budget.
  - **Phase-1 review-finding fixes** in the shared primitive and CLI: a still-over-threshold decrease is now `pre-existing` rather than `improved` (`classifyMetric` is exported for testing); `--threshold` requires a positive integer (rejects negatives/floats/zero → exit 2); a config-load failure exits 2 instead of crashing; single-file reads only treat `ENOENT` as "deleted"; and Halstead-effort display floors rather than rounds so it can never overstate past a limit.

### Patch Changes

- Updated dependencies [6e502dd]
  - @liendev/parser@0.58.0
  - @liendev/core@0.58.0

## 0.57.0

### Minor Changes

- d36fb55: Add `lien delta` — flag NEW complexity threshold crossings before commit.

  Lien already scores per-function complexity and reports threshold violations in PR review, but only _after_ code is pushed. `lien delta` moves that signal to edit time: a ~50 ms deterministic check that compares the working tree against `HEAD` and fails only when a change pushes a function's complexity over a threshold it was under before (a new-over-threshold or crossed function). Improving, or merely touching, a pre-existing violation never fails.
  - **Shared primitive** `computeComplexityDelta` in `@liendev/parser` computes per-function before/after verdicts (`crossed`, `new-over-threshold`, `worsened`, `pre-existing`, `improved`, `unchanged`, `new-under-threshold`, `removed`) from two content strings, reusing the existing complexity machinery (`chunkFile` + cyclomatic/cognitive/Halstead metrics). Because the PR-review engine depends on parser only, it can adopt the same primitive so write-time and review-time verdicts never structurally disagree.
  - **`lien delta` CLI** compares the working tree vs `HEAD` across changed files (staged + unstaged + untracked, with rename and unborn-HEAD handling), prints a concise per-function crossing table, and uses gate-friendly exit codes: `0` clean (or `--soft`), `1` on new crossings, `2` on operational failure. Thresholds come from `.lien.config.json`'s `complexity.thresholds` (the same source PR review reads), overridable with `--threshold`.

### Patch Changes

- Updated dependencies [d36fb55]
  - @liendev/parser@0.57.0
  - @liendev/core@0.57.0

## 0.56.0

### Minor Changes

- d538e74: `lien status` now reports worktree-aware indexing status when run inside a linked git worktree: the resolved mode (overlay vs standalone, with the reason for a standalone fallback), the main checkout and base index location and whether it was found, the overlay index location and file count, and whether the `LIEN_WORKTREE_STANDALONE=1` escape hatch forced standalone. Output in a normal checkout is unchanged.

## 0.55.0

### Minor Changes

- 9e095f6: Add worktree-aware indexing: when Lien's root is a linked git worktree, it now shares the main checkout's index as a read-only base and stores only a small per-worktree overlay, instead of building a full independent index per worktree.
  - **Detection** is state-based: a root is a linked worktree when `git rev-parse --git-dir` differs from `--git-common-dir`; the main checkout is located via `git worktree list --porcelain`.
  - **Reads** union the writable overlay with the read-only base, suppressing base rows for files the worktree changed or deleted (a per-overlay mask). The base is opened `{ readonly: true }` and is never written by a worktree process.
  - **The overlay** holds full chunk rows only for files whose current content differs from what the base indexed (diff via the parser content-hash vs the base manifest), plus new files. It is rebuilt automatically when the base is reindexed.
  - **Fallbacks never error**: if the main checkout has no index, its index format is incompatible, or the base is otherwise unavailable, Lien uses a standalone index as before. Set `LIEN_WORKTREE_STANDALONE=1` to force standalone behavior.
  - **FTS caveat**: BM25 scores from the base and overlay corpora are merged approximately (documented as a v1 limitation).

  This eliminates the N× index duplication that produced a 21 GB index pile across ~30 agent worktrees of one repo.

### Patch Changes

- Updated dependencies [9e095f6]
  - @liendev/core@0.55.0

## 0.54.0

### Minor Changes

- 9153080: **BREAKING:** Remove LanceDB and the embeddings stack entirely. The SQLite structural store (better-sqlite3 + FTS5 lexical search) is now the only backend, and no code path computes embeddings.
  - Deleted the `@lancedb/lancedb` and `@huggingface/transformers` dependencies. Installs are smaller and no model is ever downloaded.
  - `VectorDBInterface` no longer takes embedding vectors: `insertBatch(metadatas, contents)`, `updateFile(filepath, metadatas, contents)`, and `search(query, limit?)` (lexical). `searchCrossRepo` is removed; `scanCrossRepo`/`supportsCrossRepo` remain as single-repo stubs.
  - Removed the `embeddings.enabled` and `core.embeddingBatchSize` project config keys and the `lien index --no-embeddings` flag. Old configs that still contain these keys continue to load — the retired keys are dropped on the next save.
  - The global `backend` config key is unchanged: it validates `sqlite`, and a config or `LIEN_BACKEND` pinned to the retired `lancedb`/`qdrant` value warns once and maps forward to `sqlite`.

  If you upgraded from a LanceDB build, run `lien index` once to rebuild (it is fast and downloads nothing). A stale `code_chunks.lance/` directory left in `~/.lien/indices/<repo>/` is no longer used and can be safely deleted to reclaim disk; automated cleanup is future work.

### Patch Changes

- Updated dependencies [9153080]
  - @liendev/core@0.54.0

## 0.53.0

### Minor Changes

- 7318371: **BREAKING:** the `semantic_search` MCP tool is renamed to `search_code`.

  The old name promised embeddings-based semantic matching; since the switch to lexical FTS5 search it no longer does, so the name now says what the tool is: full-text keyword search over code. There is no alias — update `semantic_search` references in your CLAUDE.md, agent prompts, and MCP configs to `search_code`. Parameters, behavior, and response shape are unchanged.

  Also fixes `lien index` spinner copy that still claimed embeddings were being generated ("Generating embeddings", "Downloading AI brain") — indexing messages now describe what actually happens: parsing, chunking, dependency mapping, and building the FTS5 index.

## 0.52.0

### Minor Changes

- 5e6890e: **BREAKING with graceful degradation:** SQLite is now the only backend and lexical FTS5 search replaces semantic search.
  - `sqlite` is now the default (and only reachable) backend. A config or `LIEN_BACKEND` pinned to the retired `lancedb` value no longer errors — it warns once and falls back to `sqlite`. On first run the index rebuilds automatically (fast, and nothing is downloaded).
  - `semantic_search` is now full-text lexical search: BM25 over code, docstrings, and camelCase-split identifiers. Query with concrete keywords and identifiers that appear in the code, not natural-language questions — there are no embeddings, so meaning-only paraphrases won't match. The tool keeps its name for compatibility; `find_similar` and `get_files_context`'s related-chunks now use the same lexical matching.
  - Embeddings are no longer computed. Indexing never downloads a model or spawns an embedding worker. The `embeddings.enabled` config key and `lien index --no-embeddings` flag are still accepted but are inert.

- 36c14e3: Add an opt-in SQLite structural backend behind the existing vector-DB factory seam. Set `backend: sqlite` in the global config (`~/.lien/config.json`) or `LIEN_BACKEND=sqlite` to store chunks in a better-sqlite3 database with an FTS5 lexical index instead of LanceDB; the SqliteBackend implements the same `VectorDBInterface`, so no handler or indexer changes are needed. The default backend is unchanged (`lancedb`), so this release is purely additive.

### Patch Changes

- 297883e: Exclude `.claude/worktrees/**` from indexing by default. Claude Code agent
  worktrees are full nested repo clones used as scratch space — indexing them
  duplicates the entire project once per worktree (seen in production: ~30
  worktrees produced a 21 GB index and pegged 8 CPU cores). This directory is
  now added to `ALWAYS_IGNORE_PATTERNS`, the shared exclude list used by the
  scanner, watcher, and gitignore filter, so it's never indexed regardless of
  user configuration — the same treatment `node_modules/**` and `.lien/**`
  already get.
- Updated dependencies [297883e]
- Updated dependencies [5e6890e]
- Updated dependencies [36c14e3]
  - @liendev/parser@0.52.0
  - @liendev/core@0.52.0

## 0.51.2

### Patch Changes

- 57d1529: Honor the `LIEN_HOME` environment variable for Lien's global store (`~/.lien/indices/*`, `~/.lien/config.json`), via a new `getLienHome()` helper in `@liendev/parser`.

  `LIEN_HOME` has been documented in the configuration guide ("Index location") since it was written, but nothing in the code ever read it — every store-path resolver (`VectorDB`, `loadGlobalConfig`/`saveGlobalConfig`/`mergeGlobalConfig`, `lien path --store`, `lien status`, `lien config`) called `os.homedir()` directly. This patch makes the documented override actually work, and falls back to `os.homedir()` when `LIEN_HOME` is unset, so behavior is unchanged for anyone not setting it.

  This was discovered while fixing a test-hygiene bug: test suites across `packages/core` and `packages/cli` were writing real indices into `~/.lien/indices/` on every run and never cleaning them up (thousands of leaked `test-*`/`lien-test-*`/`lien-bench-*` directories accumulate over time). Tests now set `LIEN_HOME` to a per-run temp directory via a new vitest `globalSetup` in both packages, so all index/config I/O during a test run is isolated and removed automatically in teardown — no more manual per-suite cleanup needed.

- Updated dependencies [57d1529]
  - @liendev/core@0.51.2
  - @liendev/parser@0.51.2

## 0.51.1

### Patch Changes

- ca61516: Pin `@liendev/*` sibling dependencies to a real semver range instead of `"*"`.

  `packages/cli/package.json` (published as `@liendev/lien`) declared `@liendev/core` and `@liendev/parser` as `"*"`, and `packages/core/package.json` declared `@liendev/parser` as `"*"`. Since `"*"` is never rewritten at publish time, npm installs of `@liendev/lien` could resolve to whatever `@liendev/core`/`@liendev/parser` happens to be latest on npm at install time — not the versions `lien` was actually built and tested against. This is the same `"*"`-in-published-package.json family as the earlier phantom `@liendev/review` dependency bug (#620).

  It worked so far mostly by luck (packages are usually published together in the same release), but the drift is real: `@liendev/parser` is currently stuck at `0.50.0` on npm while `@liendev/core`/`@liendev/lien` are at `0.51.0`.

  Fixed by replacing every `"*"` cross-package reference with the actual current semver range (e.g. `^0.51.0`), for both published packages (`cli`, `core`) and private ones (`review`, `action`) for consistency. `changeset`'s `updateInternalDependencies: "patch"` will now correctly keep these ranges in sync on future releases, since a `"*"` range is never considered "violated" and was silently defeating that mechanism.

  Note: `workspace:*` (the pnpm/yarn workspace protocol) is not usable here — this repo uses plain npm workspaces, and npm has no equivalent rewrite step; `npm install --package-lock-only` fails immediately with `EUNSUPPORTEDPROTOCOL` if you try it. A real pinned range is the correct fix for npm workspaces.

- Updated dependencies [ca61516]
  - @liendev/core@0.51.1

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

### Patch Changes

- Updated dependencies [ff7a9b0]
  - @liendev/core@0.51.0

## 0.50.1

### Patch Changes

- 40943f8: Speed up `get_files_context`'s test-association scan: it now calls `scanAll` (a direct column-projected `table.query()`) instead of an unfiltered `scanWithFilter`, which routed through a full-table zero-vector ANN search — roughly 10x slower on large indexes. Results are also cached per `indexVersion`, mirroring `get_dependents`' scan cache, so repeated calls in one session skip the full-table scan entirely until the index is rebuilt. `get_files_context` is the tool CLAUDE.md mandates before every file edit, so this is the hottest call in the daily agent loop.
- Updated dependencies [40943f8]
  - @liendev/core@0.50.1

## 0.50.0

### Minor Changes

- e81a04d: Fix Python AST chunking to handle decorated functions, methods, and classes. Previously any `@decorated` function/method (Flask routes, FastAPI endpoints, `@staticmethod`, `@property`, dataclasses, etc.) collapsed into an anonymous chunk with no symbol name, type, complexity, or call sites - and decorated methods nested in a class body were dropped from indexing entirely. Decorators are now unwrapped to their inner definition so decorated code gets the same semantic metadata as undecorated code, with the decorator source folded into the signature.
- 356c2f4: Fix TypeScript abstract classes not being chunked. tree-sitter-typescript parses `abstract class Foo {}` as a distinct `abstract_class_declaration` node (and an unimplemented method as `abstract_method_signature`), separate from `class_declaration`/`method_definition`. Neither was recognized by the traverser, so an abstract class collapsed into a single anonymous `block` chunk and its methods didn't exist as searchable symbols. Abstract classes now chunk like regular classes: the class itself is a named `class` symbol, concrete methods keep their body/complexity, and abstract method signatures are extracted sanely (no body to measure, so complexity defaults to a baseline of 1).

### Patch Changes

- Updated dependencies [e81a04d]
- Updated dependencies [356c2f4]
  - @liendev/parser@0.50.0

## 0.49.1

### Patch Changes

- a8cbed7: Security: `safeRegex` (used by the `list_functions` MCP tool and vector DB pattern filters) missed alternation-based ReDoS — `(a|a)+$` compiled to a live RegExp whose `.test()` could hang `lien serve`. Replaced the hand-rolled heuristic with `safe-regex2` (nested-quantifier detection) plus a targeted check for duplicate alternation branches under a repeated group, and added a 256-character pattern length cap enforced before any analysis runs.
- Updated dependencies [a8cbed7]
  - @liendev/core@0.49.1

## 0.49.0

### Minor Changes

- ceed8e1: Retire the Qdrant backend. Lien is local-first and LanceDB is now the only vector database backend. The Qdrant implementation, its `@qdrant/js-client-rest` dependency, the `qdrant.*` config keys, the `qdrant` backend option, and the `LIEN_QDRANT_URL`/`LIEN_QDRANT_API_KEY` environment variables are removed. BREAKING with graceful degradation: existing configs with `backend: "qdrant"` or `qdrant.*` keys do not crash — Lien warns once and falls back to local LanceDB. The `VectorDBInterface`/`createVectorDB` factory seam is deliberately retained. See ADR-0010.

### Patch Changes

- Updated dependencies [ceed8e1]
  - @liendev/core@0.49.0

## 0.48.3

### Patch Changes

- b814bd0: Batch manifest deletions: removing K files now performs a single manifest read+write instead of one per file, matching the batched update path. Speeds up incremental indexing after branch switches and directory renames.
- Updated dependencies [b814bd0]
  - @liendev/core@0.48.3

## 0.48.1

### Patch Changes

- 9df4535: fix: remove unpublished @liendev/review from dependencies; npm install was failing with E404.

## 0.48.0

### Minor Changes

- 9642c43: feat: add Swift AST support

  Swift (`.swift`) now uses full Tree-sitter AST parsing instead of line-based
  chunking — symbols, imports, call sites, complexity, and test associations —
  bringing the count of AST-supported languages to 11. struct/class/actor/enum/
  extension are recognised (keeping the keyword in the signature), protocols map
  to interfaces, and `Tests/` directories / `*Tests.swift` files are detected as
  tests. Validated with an e2e index of SwiftyJSON.

### Patch Changes

- Updated dependencies [9642c43]
  - @liendev/parser@0.48.0

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

### Patch Changes

- Updated dependencies [fe4ba43]
  - @liendev/parser@0.47.0

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

### Patch Changes

- Updated dependencies [29ac90c]
  - @liendev/parser@0.46.0

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
  - @liendev/core@0.45.0

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
  - @liendev/core@0.44.0

## 0.43.0

### Minor Changes

- 43e38ce: feat(parser): add C# language AST support

### Patch Changes

- Updated dependencies [43e38ce]
  - @liendev/parser@0.43.0

## 0.42.0

### Minor Changes

- 66ac7e9: feat(parser): add Java language AST support

### Patch Changes

- Updated dependencies [66ac7e9]
  - @liendev/parser@0.42.0

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
  - @liendev/core@0.41.0

## 0.40.0

### Minor Changes

- 402758a: Extract `@liendev/parser` from `@liendev/core` for clean package boundaries. AST parsing, complexity analysis, chunking, and dependency analysis now live in `@liendev/parser` (~5-10MB) while `@liendev/core` retains embeddings and vector DB integration. `@liendev/review` now depends only on `@liendev/parser`, significantly reducing its deployment size.

### Patch Changes

- Updated dependencies [402758a]
  - @liendev/parser@0.40.0
  - @liendev/core@0.40.0

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

### Patch Changes

- Updated dependencies [844ceab]
  - @liendev/core@0.39.0

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

- Updated dependencies [4b1dddf]
  - @liendev/core@0.38.1

## 0.38.0

### Minor Changes

- 6c3bd23: ### Features
  - Add CommonJS import/export extraction — `module.exports`, `exports.X`, and `require()` patterns are now detected by the dependency analyzer, enabling full metadata for CommonJS codebases like Express (#213)

### Patch Changes

- Updated dependencies [6c3bd23]
  - @liendev/core@0.38.0

## 0.37.0

### Minor Changes

- be82a7b: ### Features
  - Add CommonJS import/export extraction — `module.exports`, `exports.X`, and `require()` patterns are now detected by the dependency analyzer, enabling full metadata for CommonJS codebases like Express (#213)

### Patch Changes

- Updated dependencies [be82a7b]
  - @liendev/core@0.37.0

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

### Patch Changes

- Updated dependencies [ac9fce5]
  - @liendev/core@0.36.0

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

### Patch Changes

- Updated dependencies [5c62ebc]
  - @liendev/core@0.35.0

## 0.34.0

### Minor Changes

- 19ada7b: Add Rust as the 5th AST-supported language with full support for traversal, export extraction, complexity analysis, and semantic search. Also upgrades @lancedb/lancedb and apache-arrow to fix a schema mismatch error that prevented indexing.

### Patch Changes

- Updated dependencies [19ada7b]
  - @liendev/core@0.34.0

## 0.33.0

### Minor Changes

- 0490c67: ### Features
  - Add diagnostic notes to empty search results so LLMs get actionable guidance to self-correct (semantic_search, find_similar, list_functions)
  - Derive `enclosingSymbol` in tool response metadata for richer context
  - Add response size budgeting to prevent oversized MCP responses
  - Add limit/offset pagination to `list_functions`

  ### Fixes
  - Fix `get_files_context` returning empty chunks for some indexed files
  - Fix `querySymbols` symbolType filtering by converting Arrow Vectors
  - Fix barrel/re-export files producing zero chunks during indexing
  - Cap `list_functions` offset to 10,000 to prevent pathological DB queries

  ### Docs
  - Document response shapes in MCP tool descriptions
  - Document that symbol tracking only works for direct imports

## 0.32.0

### Minor Changes

- aa39d54: feat(core): add symbolType filtering to scanWithFilter in VectorDB

  fix(core): emit class chunks alongside method chunks in AST chunker
  fix(core): add missing chalk dependency
  fix(core): resolve file paths relative to rootDir in indexer
  fix(core): log per-file indexing errors instead of swallowing silently

### Patch Changes

- Updated dependencies [aa39d54]
  - @liendev/core@0.32.0

## 0.31.0

### Minor Changes

- a738d2a: feat(core): add symbolType filtering to scanWithFilter in VectorDB

  fix(core): emit class chunks alongside method chunks in AST chunker
  fix(core): add missing chalk dependency
  fix(core): resolve file paths relative to rootDir in indexer
  fix(core): log per-file indexing errors instead of swallowing silently

### Patch Changes

- Updated dependencies [a738d2a]
  - @liendev/core@0.31.0

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
