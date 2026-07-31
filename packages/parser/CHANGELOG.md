# @liendev/parser

## 0.74.0

### Minor Changes

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

- 4b5efb6: **Breaking:** `getLienHome`, `getIndexDir`, and `extractRepoId` have moved from
  `@liendev/parser` to `@liendev/core`.

  These three utilities resolve `~/.lien` (honoring `LIEN_HOME`), the per-repo
  index directory (`<LIEN_HOME>/.lien/indices/<repoId>`), and the repo-id hash
  respectively — none of them depend on anything about the source code being
  analyzed, only on decisions Lien itself makes about where its own state
  lives. `parser` is meant to be a pure function of the files in front of it
  (parsing, chunking, complexity, dependency resolution); these three utilities
  had nothing to do with that and had drifted into the wrong package. `core` —
  storage, config, git, "where the database lives" — is where they belong.

  Removed with no deprecation window (acceptable pre-1.0, per this repo's own
  precedent for the `node-tree-sitter` legacy-backend removal): `parser` and
  `core` are versioned in lockstep by changesets (`linked` in
  `.changeset/config.json`) and consumed only inside this monorepo — no
  external caller can ever see a `@liendev/core` or `@liendev/lien` published
  without the matching `@liendev/parser` these three functions moved to. A
  repo-wide sweep (including test files, `.github/`, `scripts/`, `plugins/`)
  found zero consumers outside `packages/cli` and `packages/core` itself, and
  zero consumers in `@liendev/review` or `@liendev/action` (both of which
  depend only on `@liendev/parser`, not `@liendev/core`).

  Import `getLienHome`, `getIndexDir`, and `extractRepoId` from `@liendev/core`
  going forward.

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

### Patch Changes

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

- 7f3e85d: Fix `extractExports()` exporting explicitly non-public interface/protocol
  members in Java and Kotlin, and dropping a redundant, buggy bypass with the
  same shape in Swift (#974).

  `java.ts`'s `extractMemberExport` used `if (isInterface || hasPublicModifier(member))`
  — when `isInterface` is true the `||` short-circuits, so `hasPublicModifier`
  is never evaluated and every `method_declaration`/`constructor_declaration`
  in an interface body was exported, including explicitly `private` ones.
  Java 9+ permits `private` interface methods (helpers backing a `default`
  method), so this was reachable in real code:
  `public interface Repository { void save(); private void helper() {} }`
  returned `['Repository', 'save', 'helper']` — `helper` should not be there.

  `csharp.ts` already had the correct guard (`hasExplicitAccessModifier`,
  gating an "implicitly public" fallback to only apply when the member carries
  no explicit access modifier). Ported the same shape to `java.ts` (Java's
  modifiers are `public`/`private`/`protected` — no `internal`, unlike C#).

  Swept every other language whose extractor handles interfaces/protocols for
  the same defect shape ("one decision, N language files, fixed at fewer than
  N"):
  - **Kotlin**: same bug (`isInterface || isExported(member)`), reachable —
    Kotlin 1.4+ allows `private` interface members. Fixed by dropping the
    `isInterface` bypass entirely: `isExported`'s existing "public unless
    explicitly private/internal" rule already matches interface-member
    visibility exactly, so the bypass was both redundant for the correct case
    (no modifier) and wrong for the explicitly-private case — no separate
    C#-style helper was needed.
  - **Swift**: same shape (`isProtocol || isExported(member)`). `private`/
    `fileprivate` aren't valid Swift on a real protocol requirement, but the
    `tree-sitter-swift` grammar still parses them, so the extractor could still
    mis-export one from malformed/non-compiling input. Fixed the same way as
    Kotlin (dropped the bypass, relying on `isExported`) for defense in depth
    and consistency, even though it's not reachable from valid, compiling
    Swift.
  - **C#**: already correct (the reference implementation for this fix).
  - **Go, Rust, PHP, TypeScript/JavaScript, Python, Ruby**: verified
    architecturally unaffected — none of them export interface/trait/protocol
    members individually via an `isInterface`-style bypass at all. Go and Rust
    gate purely on identifier capitalization / a `pub`/visibility-modifier
    check at the container level and never dig into interface/trait bodies to
    export member names separately; PHP and TypeScript/JavaScript only export
    whole top-level declarations (PHP also can't have non-public interface
    methods at all); Python has no interface-like construct in the export
    extractor; Ruby's `private`/`protected` are runtime calls, not per-
    declaration modifiers the extractor inspects.

  Added the C#-style regression test ("should not export explicitly non-public
  interface members") to `java.test.ts` and `kotlin.test.ts`, and the protocol
  equivalent to `swift.test.ts` — confirmed each fails on the pre-fix code and
  passes after.

- 56bcd9c: Fix `signature` for Python/PHP/Go type declarations dropping generic type
  parameters and the heritage clause (base class / interface list) — #965
  recurring in the three languages that fix missed (#976).
  - Python: `class Dog(Animal, Serializable):` reported `signature: "class Dog"`;
    now `"class Dog(Animal, Serializable)"`. PEP 695 generics are also
    covered — a generic class with a base class keeps both its type
    parameter and its base in the signature.
  - PHP: `class Dog extends Animal implements Serializable {}` reported
    `"class Dog"`; now `"class Dog extends Animal implements Serializable"`.
  - Go: `type Stack[T any] struct { items []T }` reported `"type Stack struct"`;
    now `"type Stack[T any] struct"`.

  Six languages (C#, Java, Kotlin, Swift, JS/TS, Rust's impl/trait blocks)
  already had this via their own `typeParamsAndX`-shaped helper, each
  explicitly documented as "the <language> analog of C#'s
  `typeParamsAndBaseList`" — the clearest possible signal the underlying rule
  should be asserted once. A new cross-language test
  (`type-declaration-signature.test.ts`) now asserts, for every language with
  a type-level symbol extractor, that a declaration exercising whichever of
  {generics, heritage} its grammar supports round-trips into `signature` —
  so a future language can't silently reintroduce this gap.

  Verified against real OSS source (not just synthetic snippets): Monolog's
  `FilterHandler` (PHP, 3-interface `implements` clause), Requests' `Session`
  (Python, mixin base class), and samber/lo's `switchCase[T comparable, R any]`
  (Go, two-parameter generic struct) all now report their full signature.

  Out of scope: Rust's `struct_item`/`enum_item` aren't symbol-extracted at
  all yet (only `impl_item`/`trait_item`, via the differently-shaped
  `extractImplInfo`) — a bigger gap tracked separately, not fixed here.

## 0.73.0

### Patch Changes

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

## 0.71.1

### Patch Changes

- 0620b0b: Fixes #918: `matchesWithSourcePrefix` (one of `matchesPythonModule`'s four
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

## 0.71.0

### Minor Changes

- 99cf7e5: Closes part of #878: after #877's PSR-4 manifest mapping, 58/67 guzzle
  `src/*.php` files resolved real test coverage via declaration-based (`use
...;`) import extraction. The remaining 9 files are referenced by their
  tests only through a fully-qualified class name or a factory — `new
\GuzzleHttp\RetryMiddleware(...)`, `\GuzzleHttp\Exception\ClientException::class`
  — with no corresponding `use` import anywhere in the file, since PHP
  resolves a leading-`\` name absolutely regardless of what's imported.
  Declaration-based extraction (`namespace_use_declaration` nodes only) is
  structurally blind to this.

  `PHPImportExtractor` gains a new optional `extractReferencedFQCNs` method
  (added to the `LanguageImportExtractor` interface as an optional member —
  every other language simply omits it, zero behavior change) that
  recursively scans a whole PHP file for three unambiguous expression shapes
  whose class-name part is a fully-qualified (leading-`\`) `qualified_name`
  node: `new \Foo\Bar\Baz(...)`, `\Foo\Bar\Baz::class` (or any other static
  constant access), and `\Foo\Bar\Baz::method()`. A "qualified but not fully
  qualified" name (`Foo\Bar`, no leading `\`) is deliberately excluded — PHP
  resolves it relative to the current namespace or a `use`-imported alias,
  which is genuinely ambiguous without cross-referencing the file's own
  `use` imports, and is exactly the false-positive shape #868/#883 guard
  against. A fully-qualified single-segment name (`\DateTime`, `\Exception`)
  is also excluded: it can only ever name a PHP built-in or global-namespace
  class, never a Composer-autoloaded project file. `ast/symbols.ts`'s
  `extractImportPaths` merges these reference specifiers in through the
  exact same resolution pipeline (including PSR-4) as declaration-based
  imports, deduplicated, so `path-matching.ts`'s matcher needs no changes at
  all.

  Honest remainder, per #869/#881's precedent: the dominant shape among
  guzzle's 9 remaining files — `Middleware::retry()` internally `new`-ing
  `RetryMiddleware` from a _different_ file (`Middleware.php`), with zero
  textual mention of `RetryMiddleware` anywhere in the test itself — needs
  transitive reasoning across files that a single-file structural scan
  cannot provide. That case is not resolved here and stays an honest "no
  signal" rather than a guess; #878 stays open to track it.

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

- 6fc55ab: Fix two related bugs where lexical ignore rules silently dropped real,
  committed source from the index (#899, #900), reproduced against a clone of
  `cli/cli`:
  - **#899**: the hardcoded `build/**`/`**/build/**` entries in
    `ALWAYS_IGNORE_PATTERNS` unconditionally swallowed any directory literally
    named `build`, with no way to distinguish generated output from real
    source (`internal/build/build.go`, a hand-written Go file defining
    `Version`/`Date`, was entirely absent from the manifest).
  - **#900**: `.gitignore` was applied lexically to every file with no
    tracked-file exemption. Real git only ever ignores UNTRACKED files, so a
    stale bare-name pattern (a root `.gitignore` line `gh`, meant to hide a
    locally built binary) matched — and silently dropped — the unrelated,
    fully tracked `cmd/gh/` and `internal/gh/` source trees, including the
    literal `func main()` entrypoint.

  **Fix**: in a git repository, `scanCodebase` and `createGitignoreFilter` now
  union the lexical scan/filter with git's tracked-file list
  (`getGitTrackedFiles`, one `git ls-files -z` call, cached for the life of
  one scan/filter — never a per-file subprocess). A path git tracks is
  rescued from `ALWAYS_IGNORE_PATTERNS`, `.gitignore`, and ecosystem excludes
  regardless, with one exception: `NEVER_INDEX_EVEN_IF_TRACKED_PATTERNS`
  (`.git/**`, `.lien/**`, `node_modules/**`, `.claude/worktrees/**`) is a hard
  carve-out that stays excluded even if git tracks it, since git _can_ track
  a committed `node_modules` or a nested `.claude/worktrees` clone and
  indexing either reproduces the 21GB-index blowup `ALWAYS_IGNORE_PATTERNS`
  exists to prevent. Non-git directories are unaffected — the tracked-file
  set is empty and the union is a no-op, preserving today's pure-lexical
  behavior exactly.

  New regression coverage in `gitignore.test.ts`/`scanner.test.ts`: tracked
  source at depth inside a `build`-named directory, tracked source shadowed
  by a bare-name `.gitignore` pattern, the tracked-vs-untracked distinction
  (an untracked file under the same paths stays excluded), and the hard
  carve-out (a tracked `node_modules` file is never rescued).

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

- db565d2: Consolidate the five match-side reverse-dependency call paths
  (`findTestAssociationsFromChunks`, `chunkImportsFrom`,
  `collectImportedSymbolsFromSource`, `fileImportsSymbolFromAny`,
  `findTestAssociations`) behind one guarded primitive, `importMatchesTarget`,
  in `packages/parser/src/utils/path-matching.ts` (#886).

  Each of the five used to open-code
  `!isUnresolvableWholeModuleImport(imp, importerFile) && matchesFile(normalize(imp), target)`
  independently — the exact two-line idiom that was forgotten at a new call
  site three times across #885's review rounds (the #884 whole-module guard
  missing from a freshly-added site). `importMatchesTarget(importSpecifier,
importerFile, normalizedTarget, normalize)` couples the guard to `matchesFile`
  so a match-side caller can no longer invoke one without the other; the two
  build-side sites with no target in scope (`buildImportIndex`,
  `indexImportEntry`/`addChunkToImportIndex`) still call
  `isUnresolvableWholeModuleImport` directly, and `findDependentChunks`'s fuzzy
  loop and `buildReExportGraph` are deliberately left on raw `matchesFile` (see
  the #886 design comment for why those four don't fit the primitive).

  No exported signature changes to any of the five migrated functions or to
  `matchesFile`/`isUnresolvableWholeModuleImport` themselves — `importMatchesTarget`
  is a new, additive export. Behavior-preserving by construction: verified via a
  byte-identical before/after diff of `get_dependents`/test-association output
  across this repo and the multi-language `lien-review-testbed` fixture (see the
  PR body's golden-proof evidence).

  Also fixes #887: a multi-segment bare `require`/import specifier (e.g. Ruby's
  `require 'rack/protection'`) fanned out to every file nested under its own
  directory (`rack-protection/lib/rack/protection/*`) instead of matching only
  that directory's own entry point. The fix is language-aware, not a blanket
  change to `matchesFile`: Ruby's bare multi-segment `require` names exactly
  one file, but Go's `import "pkg/sub"` (normalized to the bare `pkg/sub` by
  #877's module-prefix stripping) names a _package_ — every file in that
  directory is a legitimate member, so the same "must reach the end of the
  compared string" tightening would have wrongly rejected real Go dependents
  if applied unconditionally (an earlier revision of this fix did exactly that
  and was caught in review — see the PR body's Correction section for the
  proof and the fix).

  `matchesFile` gains an optional third parameter,
  `requireExactTailForMultiSegment` (default `false`, preserving every
  existing caller's behavior unchanged), and a new `LanguageDefinition`
  flag — `singleFileImports` (set on Ruby only) — drives it via the new
  `hasSingleFileImportSemantics` helper. `importMatchesTarget` derives the
  flag from the importer's language for the five migrated call sites;
  `findDependentChunks`'s fuzzy-match loop (in both `@liendev/parser` and the
  CLI) applies the same derivation per chunk, since its import-index bucket
  can span multiple importer files sharing one normalized specifier. Verified
  against both a real sinatra clone (820 spurious dependent edges removed,
  gem/library entry points unchanged) and a real gin clone (all 67 dependent
  edges preserved, including the `internal/fs` package-directory case) — see
  the PR body.

- da1ec69: Fix Java `import static a.b.ClassName.member;` (a specific, non-wildcard
  static-member import) never resolving to a test association or dependent for
  its defining class file (#864). `extractImportPath` was already returning a
  syntactically-correct path, but one segment deeper than the class's own file
  — `com.example.Utils.method` where the file is `com/example/Utils.java`, not
  `com/example/Utils/method` — so `matchesFile`/`matchesPythonModule` could
  never match it.

  `JavaImportExtractor.extractImportPaths` now returns the class's derived FQN
  (the raw path with its trailing segment dropped) as a second candidate
  alongside the original, unchanged single path from `extractImportPath`. This
  is safe rather than a guess: Java requires every top-level type to live in a
  file named after it, and nested types/members always live inside their
  enclosing top-level type's file, so dropping the trailing segment always
  yields that type's correct FQN — whether the segment names a static member
  (the common case) or a nested class (`import static a.B.Inner;`, correct by
  the same rule). A static import reaching two-plus levels into nested classes
  under-matches silently (the same behavior as before the fix) rather than
  mismatching. Wildcard static imports and ordinary (non-static) imports are
  unaffected.

  Confirmed on a real clone of google/gson: `JsonReaderTest.java` statically
  imports 8 specific members of `JsonToken` (`STRING`, `NUMBER`, `BEGIN_ARRAY`,
  ...) and was invisible to `lien annotate`'s test-coverage line for
  `JsonToken.java` despite directly testing `JsonReader.peek()`'s `JsonToken`
  return values; it now appears. A full before/after diff of every file's
  test-association set across gson's 264 Java files shows exactly one changed
  entry — this addition — confirming no new false positives elsewhere.

  Kotlin's narrower analogous shape (`import a.b.myFunction` for a top-level
  function/property defined in an arbitrarily-named file) is deliberately left
  as an honest, undetermined gap rather than a guess: unlike Java, there is no
  syntactic marker (no `static`-equivalent keyword) distinguishing a top-level
  declaration from a class/object-member access in this grammar — both parse
  to an identical flat `identifier` of `simple_identifier` segments — so
  guessing risks the false-positive fan-out #868 warned against. This is
  documented in `KotlinImportExtractor`'s class doc comment and pinned by a
  regression test; #864 stays open for the Kotlin side.

- ac0480f: Fixes #901 and #904: two Python import-resolution gaps found on
  pallets/flask, both remainders after #859/#861.

  #904 — relative imports (`from .module import X`, `from ..pkg import Y`)
  never matched anything, because `matchesPythonModule`'s regex rejects a
  leading dot and the generic relative-import strategy in `matchesFile` only
  understands JS/TS's slash-based `./`/`../`. `PythonImportExtractor` now
  converts the grammar's leading-dot form to a `./`/`../`-prefixed specifier
  at extraction time (mirroring `RustImportExtractor`'s `super::` -> `../`
  conversion), and `python` is added to `chunker.ts`'s
  `RESOLVE_RELATIVE_IMPORTS` set so `filepath` is threaded through and
  `resolveRelativeImport` resolves it against the importing file's own
  directory — the same path JS specifiers already take. On flask,
  `src/flask/app.py`'s `from .globals import ...` now resolves to
  `src/flask/globals`, closing 11 of `flask.globals`'s 16 real dependents that
  were previously invisible (5/16 reported -> full ground truth).

  #901 — a bare package import (`import flask`) never matched anything:
  `matchesPythonModule`'s regex required at least one dot, so a dot-free
  specifier failed the gate before any of its four sub-strategies ran. The
  gate now also accepts a bare word, but routes it through only the two
  position-anchored sub-strategies (exact/parent-package match) — the
  unrestricted suffix/source-prefix strategies stay reserved for genuinely
  multi-segment dotted paths, per #883's precedent against widening
  leniency for short bare identifiers. Separately, flask's `src/`-layout
  (package lives at `src/flask/`, one directory below where a bare import
  resolves) has no reliable manifest declaration to read — even flit*core,
  flask's own build backend, only declares the package \_name*, not its
  directory — so a new `python-src-layout.ts` (mirroring `php-psr4.ts`/
  `go-module.ts`'s manifest-root pattern from #877) detects a real on-disk
  `src/<package>/__init__.py` and resolves `flask` -> `src/flask` before
  `matchesFile` ever runs. Together, `import flask` now reaches
  `src/flask/__init__.py` and (via the parent-package strategy, exactly like
  the existing dotted `django.http` -> `django/http/*.py` behavior) every file
  under `src/flask/` — including `app.py`, which previously reported no test
  coverage at all despite being the package's most heavily-tested file.

  `resolvePythonSrcLayoutImport` verifies each candidate path actually exists
  on disk before rewriting a specifier — needed because a single git repo can
  hold more than one Python project (flask's own repo does: `examples/celery/`
  and `examples/tutorial/` each have their own nested `src/<pkg>/` or
  flat-layout package). Without that check, a bare import in one of those
  nested projects (`examples/celery/make_celery.py`'s `import task_app`) would
  misresolve against the _outer_ `src/flask` root; the existence check keeps
  that case an honest no-op instead.

  Both fixes are additive and gated behind the exact shape they target (a
  leading dot / a dot-free bare word / a detected, existence-verified `src/`
  layout); every existing dotted-import test-association and dependent-analysis
  behavior is unchanged (verified via a corpus-wide before/after dependents
  diff across all 80 `.py` files in flask's repo: 0 regressions, 0 unexplained
  new edges).

- 4a863f2: Fixes #903 (the third leg of #867, alongside PHP's PSR-4 map and Go's module
  path): `convertRustModulePath` only recognized `crate::`/`self::`/`super::`
  as internal-path prefixes, so any Cargo workspace member crate's `tests/`
  integration tests — which Cargo always compiles as a SEPARATE crate, and
  which therefore reference the crate under test by its published name (`use
tokio_util::codec::Framed;`) rather than `crate::` — were indistinguishable
  from a genuinely external crates.io dependency and silently dropped. On
  tokio-rs/tokio, this left 225/231 (97.4%) of the workspace's integration
  test files with empty `imports`, blind to `get_files_context`'s
  `testAssociations`, `verify-tests`/`recap`, and `annotate`'s test-coverage
  line.

  Adds `rust-crate-map.ts`, a manifest reader mirroring `php-psr4.ts`/
  `go-module.ts`'s existing pattern: it parses a Cargo workspace root's
  `Cargo.toml` `[workspace] members` (glob-expanded) plus each matched
  member's own `[package] name` (and the root's own `[package]`, for a
  single-crate project or a workspace root that's also a member crate) into a
  `Map<crateName, crateSrcDir>`, normalizing hyphens to underscores to match
  the identifier form Rust `use` paths actually use (`tokio-util` the package
  vs. `tokio_util` the path). Unlike PHP/Go, this map is threaded straight
  into `RustImportExtractor` (a new optional `rustCrateMap` parameter on
  `extractImportPaths`/`processImportSymbols`, widening the
  `LanguageImportExtractor` interface) rather than applied as post-extraction
  string resolution in `ast/symbols.ts` — Rust's extractor has to decide
  "internal vs. external crate" before it ever emits a specifier, which
  happens before `resolveImportSpecifier`'s pipeline ever sees it. Only
  workspace-member crates resolve; a genuinely external crate (`serde`,
  `futures`, ...) is dropped exactly as before this fix, so single-crate
  projects and true external dependencies see zero behavior change.

  v1 scope (deliberately KISS/YAGNI, matching #867's PHP/Go precedent): only
  `[workspace] members` and each matched member's `[package] name` are read.
  Module-path resolution mirrors the existing `crate::` transform exactly
  (`<crate>::<rest>` -> `<crateDir>/src/<rest>`), the same "first leg" the
  issue's own suggested-fix section calls out as acceptable — full
  `<mod>.rs`/`<mod>/mod.rs` file resolution is unchanged from the pre-existing
  `crate::`-relative behavior. `[dependencies] path = "..."` entries and
  workspace `exclude` are out of scope.

## 0.70.0

### Minor Changes

- 94e7fd2: Fix C# properties being invisible to symbol tooling (#871): `property_declaration` and `indexer_declaration` are now chunked as their own symbols, so `api-delta`, `get_dependents`, and `list_functions` can see a property being removed or changing type — properties are C#'s dominant public-API idiom (auto-properties, expression-bodied properties, DTO/POCO surfaces), and previously not one of them was chunked as a symbol.

  Chunked as `symbolType: 'method'` (Route A), reusing the existing type rather than adding a new `'property'` value to the `symbolType` union — no language emits `'property'` today, and `signature-delta.ts`'s `functionMetadataByKey`/`isExportedChunk` already treat `'method'`-typed chunks as part of a class's exported surface when the class itself is exported, so this requires zero changes outside `csharp.ts`.

  Covered forms:
  - Accessor-list properties (`public string Name { get; set; }`), including a getter-only shape and `init` accessors.
  - Expression-bodied properties (`public int Count => …`) — the signature captures the contract (type + normalized accessor shape, `{ get; }`) and deliberately excludes the getter's expression, mirroring how a method's body is excluded from its own signature: editing the expression is not a signature change, but changing the property's type or accessor shape is.
  - Static properties.
  - Interface properties.
  - Indexers (`public int this[int index] { get; set; }`), named `this` (indexers have no `name` field in the grammar).

  Deliberately not covered: record primary-constructor properties (`record Person(string Name)`) — the grammar represents them as plain `parameter` nodes inside the record's `parameter_list`, a different node shape than `property_declaration`, out of scope for this fix.

  Honest cost: chunking every property means a DTO/POCO-heavy C# codebase's index grows. Measured on a shallow clone of AutoMapper/AutoMapper (560 files, 512 `.cs`): chunk count went from 11,175 to 12,411 (+1,236, +11.1%; +1,053 of those are the new `method`-typed property/indexer chunks), and `structural.db` grew from ~23.4 MiB to ~24.4 MiB (+~1.08 MiB, +~4.6%). No other language's chunking changed.

- 6e65321: Fix Go grouped `import (...)` blocks silently dropping every target but the
  first from `chunk.metadata.imports` (#863). A single `import (...)` block
  commonly groups 2+ non-stdlib packages (e.g. `import ( "fmt";
"github.com/foo/utils"; "github.com/foo/models" )`), and each is a distinct
  target — but `GoImportExtractor.extractImportPath()`'s one-string-per-node
  contract could only ever report one, so `findTestAssociationsFromChunks`
  (which reads only `chunk.metadata.imports`) was structurally blind to any
  test file that imported a later package in the group. Confirmed on a real
  shallow clone of gin-gonic/gin: `gin.go`'s own grouped import (6 non-stdlib
  targets across `internal/bytesconv`, `internal/fs`, `render`, and three
  external packages) previously recorded only the first
  (`["internal/bytesconv"]`); it now records all six.

  Widens the shared `LanguageImportExtractor` interface with a new
  `extractImportPaths(node): string[]` method (returning every target in
  source order) alongside the existing singular `extractImportPath` (kept
  as-is — still used directly by ~60 existing per-language regression tests,
  and by `extractImportPaths`'s own default implementation). Every language
  extractor now implements it: nine languages (JS/TS, PHP, Python, Kotlin,
  C#, Ruby, Swift, Java, Rust) get the default shape — `extractImportPath`'s
  single result wrapped in an array via the new `toImportPathsArray` helper,
  zero behavior change — and only `GoImportExtractor` overrides it with real
  multi-target extraction; `extractImportPath` itself becomes a thin
  `extractImportPaths(node)[0] ?? null` delegate so the two can never
  disagree. `ast/symbols.ts`'s internal `extractImportPaths` (the function
  that builds `chunk.metadata.imports`) now iterates every path an import
  node yields instead of taking at most one.

  Deliberately scoped to Go only, per the #859 audit's existing "first wins"
  mitigation for PHP's grouped `use Ns\{A, B};` and Rust's bare-root
  `use crate::{a::X, b::Y};` groups (both already fixed to keep at least the
  first target instead of losing the whole declaration) — those two are
  pinned by regression tests added in that audit and are intentionally NOT
  widened to capture every target here; only Go's genuinely common,
  previously-total-loss case is fixed in this PR.

  Does not touch `processImportSymbols` (the `importedSymbols` map, used for
  symbol-usage tracking, not test-association) — Go's existing first-wins
  behavior there is unchanged; `findTestAssociationsFromChunks` reads only
  `imports`, so that was the entire blast radius for #863.

- f730ac1: Fix a 100% test-association failure on standard PHP (Composer PSR-4) and Go
  (module-path) project layouts (#867). `matchesFile()`'s namespace/module
  matching in `path-matching.ts` guesses a project's source layout by aligning
  literal directory-name segments, but neither ecosystem's dominant convention
  is guessable that way: Composer's PSR-4 autoloading maps a namespace prefix
  to a directory declared in `composer.json` (e.g. `"GuzzleHttp\\": "src/"`),
  and Go imports are always full module paths (`github.com/org/repo/pkg`)
  whose root segment never equals the literal checkout directory name. Neither
  manifest was ever read, so `GuzzleHttp\Cookie\SetCookie` and
  `github.com/gin-gonic/gin/binding` could never match their real files —
  confirmed on real OSS repos as 67/67 PHP files (guzzle/guzzle) and 59/59 Go
  files (gin-gonic/gin) silently reporting "No test coverage" despite complete,
  passing test suites.

  Two small manifest readers, mirroring `workspace-packages.ts`'s existing
  pattern exactly (parse once per workspace root, cache, no-op when the
  manifest is absent): `php-psr4.ts` parses `composer.json`'s `autoload.psr-4`
  / `autoload-dev.psr-4` maps; `go-module.ts` parses `go.mod`'s `module` line.
  Both are wired in as a third specifier-resolution step (`ManifestRoots`, in
  `ast/symbols.ts`'s `resolveImportSpecifier`), built once per file in
  `ast/chunker.ts`'s `prepareASTContext` from the existing `workspaceRoot`
  option — no new public option was needed. `extractImports`/
  `extractImportedSymbols` gained a new optional trailing parameter to thread
  it through; existing callers that don't pass it are unaffected.

  PHP's PSR-4 resolution runs on the raw backslash-separated specifier
  (`GuzzleHttp\Cookie\SetCookie`), matching the longest registered namespace
  prefix and converting the remainder to `/`-separated form — this
  deliberately happens _before_ `path-matching.ts`'s `normalizePath` would
  otherwise convert `\` to `/`, since the prefix lookup needs the native PHP
  separator. Go's resolution is exact string-prefix stripping once the module
  line is known, no guessing required.

  Verified against a live shallow clone of guzzle/guzzle: 58 of 67 `src/*.php`
  files now resolve real test coverage (up from 0), including the issue's
  named target (`src/Cookie/SetCookie.php` → `tests/Cookie/SetCookieTest.php`).
  The remaining 9 are a separate, pre-existing gap (test files that exercise
  the class through a factory or FQCN reference rather than a `use` import of
  it directly — nothing to resolve from import data alone) and are out of
  scope for this fix. Gin's Go re-sweep is deferred to #868 (a separate
  `matchesAtBoundary` false-positive that still causes a bare tail-segment
  collision after prefix stripping), so Go acceptance is not claimed here.

  Scope: only `autoload.psr-4`/`autoload-dev.psr-4` (not `classmap`/`files`,
  not PSR-0) and the single `go.mod` `module` line, matching the issue's
  explicit "no general manifest framework" constraint.

### Patch Changes

- 0867ea3: Fix `matchesAtBoundary`/`matchesFile` (and the parallel `matchesPHPNamespace`
  reverse-component matcher) so a bare, slash-free import specifier no longer
  wins a coincidental boundary match against an unrelated multi-segment path.

  Confirmed independently in three languages during an OSS dogfood sweep:
  - **Go**: `github.com/gin-gonic/gin/internal/fs` tail-matched the unrelated
    top-level `fs.go`, misattributing a real dependency away from
    `internal/fs/fs.go` to the wrong file.
  - **Ruby**: a bare `require 'sinatra'` matched every file under `lib/sinatra/`
    (`base.rb`, `main.rb`, `show_exceptions.rb`, `version.rb`), not just the
    gem's own entry point (`lib/sinatra.rb`).
  - **Swift**: `import Combine` (Apple's system framework) falsely matched the
    unrelated `Source/Features/Combine.swift` purely because the basenames
    coincide.

  The fix is one targeted guard, not a scoring system: a bare (no `/`)
  specifier must reach the _end_ of the longer string (not merely appear as an
  interior component — this alone fixes the Ruby fan-out), and the number of
  directory segments allowed before it depends on which side is bare. A bare
  _import_ matching within a longer _target_ may have at most one leading
  segment — the established "source directory prefix" convention (bare `auth`
  resolving to `src/auth.rs`). A bare _target_ (a short top-level file's own
  basename) matching within a longer _import_ gets no leading-segment leniency
  at all: there's no confirmed legitimate case for it, and it's exactly the Go
  bug's shape — `internal/fs` (already module-prefix-stripped by #867) must not
  tail-match an unrelated top-level `fs` target just because only one directory
  segment happens to precede the match. Multi-segment patterns, and a cleaned
  `./`/`../` relative import (already proof the specifier names a real project
  file, not an ambiguous external package), are both unaffected.

  `matchesPHPNamespace` independently implements the same reverse
  tail-matching idea for PHP-style namespaces and had the identical gap for a
  single-component import (e.g. the Swift `Combine` case actually flows
  through this fallback strategy, not just `matchesAtBoundary`), so it gets the
  same "at most one leading directory" guard.

  Fixes #868.

- a7cf15c: Fix `isTestFile()` in path-matching.ts to recognize the dominant .NET
  xUnit/NUnit/MSTest test-naming convention: a `Tests` suffix glued onto a
  longer identifier (`UnitTests/`, `IntegrationTests/`, `AutoMapper.DI.Tests/`
  directories) rather than a delimited `test`/`spec` path segment, and
  filenames ending in `Test.cs`/`Tests.cs` (`ScopeTests.cs`,
  `ConfigurationFeatureTest.cs`).

  `isTestFile()` is the pre-filter gating all test-association discovery
  (`findTestAssociationsFromChunks`), so this was a 100% test-association
  failure for C# projects using the standard .NET project-template layout
  (confirmed on `AutoMapper/AutoMapper`, where none of its 364 test files
  under `src/UnitTests/`, `src/IntegrationTests/`, or
  `src/AutoMapper.DI.Tests/` ever cleared the gate). Scoped to `.cs` paths;
  both the directory-segment and filename regexes require a literal
  capital-T `Tests`/`Test` suffix (no case-insensitive flag), so
  `Latest.cs`/`Contest.cs` and a `latest/`-style directory are not
  misclassified, and no other language's behavior moves, mirroring how the
  existing Swift branch is scoped to `.swift`.

  Fixes #866.

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

## 0.69.1

### Patch Changes

- 242892d: Fix the #859 bug class (`extractImportPath` returning an unmatchable value
  instead of a clean path) in three other languages found by auditing every
  import extractor against it:
  - **Java / Kotlin**: wildcard imports (`import com.example.*;` /
    `import a.b.*`) returned the raw `pkg.*`-suffixed string, which never
    satisfies `matchesPythonModule()`'s dotted-identifier check in
    path-matching.ts (an asterisk never matches `[A-Za-z_]\w*`) — so a wildcard
    import could never resolve to a test association or dependent for anything
    in that package. `extractImportPath` now strips the trailing `.*` and
    returns the clean package path, matching what `processImportSymbols`
    already computed separately.
  - **PHP**: grouped `use` declarations (`use App\Models\{User, Post};`, PHP
    7+) returned `null` from both `extractImportPath` and `processImportSymbols`
    — tree-sitter-php parses this as a `namespace_name` prefix sibling plus a
    `namespace_use_group` of clauses, a shape the extractor didn't recognize at
    all, so the whole statement (every item in the group) was invisible to
    test-association discovery. Now captures the first item's full path,
    mirroring `GoImportExtractor`'s existing "first wins" precedent for its own
    multi-target grouped imports.
  - **Rust**: `use crate::x;` / `use self::x;` / `use super::x;` (a single
    segment directly off a bare root, with tree-sitter-rust giving
    `crate`/`self`/`super` their own named node types) resolved a path via
    `extractImportPath` but returned `null` from `processImportSymbols`, since
    it converted the bare root's text alone (no `::` for the prefix-strip to
    match) instead of combining it with the imported name. Grouped bare-root
    imports with divergent per-item paths
    (`use crate::{auth::AuthService, config::Settings};`) returned `null`
    entirely for the same reason — now fixed with the same Go-style "first
    wins" mitigation as PHP.

  Also adds regression-pinning import-extraction tests across every audited
  language (TypeScript, JavaScript, PHP, Ruby, Rust, Go, Java, C#, Kotlin,
  Swift) covering their main import forms, so this bug class can't silently
  regress in any of them again. Two remaining structural gaps found by the
  audit — Go's grouped-import "first wins" behavior only ever keeps one target
  per `import (...)` block, and Java static member-imports / Kotlin top-level
  function imports don't match their defining file — are filed as separate
  issues (#863, #864) rather than fixed here, since both need a design call
  beyond a mechanical extractor fix.

- cf0d462: Fix Python test-association discovery being silently broken for every import
  form: `PythonImportExtractor.extractImportPath()` was returning the raw,
  unparsed statement text (e.g. `"from starlette.responses import FileResponse, ..."`)
  instead of a clean dotted module path, so `chunk.metadata.imports` never
  contained anything `matchesPythonModule()` could match. It now returns the
  clean module path (e.g. `"starlette.responses"`, `"os"`, `".foo"` for
  relative imports) by delegating to the same symbol-processing logic already
  used to build `importedSymbols` — the two can no longer disagree. Also fixes
  two related latent bugs in that shared logic: relative from-imports
  (`from . import x`, `from .foo import x`) silently dropped their imported
  symbols entirely, because the module-path lookup didn't account for the
  `relative_import` wrapper node; and wildcard from-imports (`from x.y import
*`) were dropped in their entirety (module path included), because the
  symbol collector didn't recognize `wildcard_import` nodes and treated the
  resulting empty symbol list as "no import here" — it now records a `'*'`
  placeholder symbol, mirroring `RustImportExtractor`'s existing convention for
  `use crate::models::*;`.
- 4fd502b: Fix a silent duplicate-index bug: `extractRepoId()` hashed the project-root path exactly as given, with no symlink canonicalization. `lien serve --root <path>` (and any other caller passing an explicit, non-`cwd`-derived root — a hook-provided cwd, an MCP client's configured root, etc.) for a directory reachable through a symlinked path segment resolved to a **different** repo ID than plain `cd <dir> && lien index`/`lien serve` for the exact same physical directory — because `process.cwd()` is already realpath-resolved by the OS, but an explicit path string is not. The server then reported "No index found" and silently built a second, empty index next to the real one; every MCP tool (`search_code`, `get_dependents`, etc.) returned empty/wrong results for that session. Reproduced on macOS via `/tmp` → `/private/tmp` (see #858), but the same class of bug applies to any symlinked path — home-dir symlinks, Docker bind mounts, CI workspace symlinks.

  `extractRepoId()` now resolves symlinks (`fs.realpathSync`) before hashing, falling back to the previous `path.resolve()` behavior when the path doesn't exist yet or `realpath` fails for any other reason (e.g. permissions). This is the single chokepoint every caller funnels through (`getIndexDir`, `SqliteBackend`, `getStoreRoot`, `lien status`, `lien gc`'s current-project guard), so `cwd`, `--root`, hook-provided cwd, and MCP root all derive the same repo ID for the same physical directory without any caller-side changes.

  **Migration note:** this changes the computed repo ID for any project whose path (or an ancestor segment) is a symlink — plain `cwd`-based usage is unaffected, since `process.cwd()` was already OS-resolved. Affected users get one silent re-index the next time they run `lien index`/`lien serve` against the same project (their old index is simply superseded, not corrupted). The now-abandoned old index directory is reclaimed by `lien gc`: if its recorded source root has itself disappeared, a bare `lien gc` collects it as an orphan immediately; if the symlinked path persists (the common case — e.g. macOS's `/tmp`), the old directory is classified "present" (not orphan) and is instead reclaimed by `lien gc --stale` once it ages past the staleness window (default 60 days), since it will never be touched again post-upgrade. A dual-ID back-compat lookup (recognizing both the old and new hash for one project) was considered and declined: the affected population is limited to symlinked-path setups, the fix is a one-time re-index (not data loss), and `lien gc`/`--stale` already reclaims the orphaned directory without extra machinery — adding a compat layer for this would be YAGNI.

## 0.68.0

### Minor Changes

- 8c87642: Shift docs-drift detection left onto the blast-radius nudge: when `lien api-delta` detects a REMOVED exported symbol, it now also reports how many indexed documentation chunks still reference it.
  - `@liendev/parser` gains `wordBoundaryRe` and `isDistinctiveToken`, lifted out of the review engine's docs-drift pass (`packages/review/src/docs-drift-signals.ts`, now a thin consumer of these instead of duplicating them) so the CLI can reuse the exact same word-boundary + distinctiveness matching precision.
  - `lien api-delta`'s enrichment gains `docRefCount`/`docRefPaths` on every `removed` change (`null`/`[]` for `signature-changed`, or when the index is unavailable): a zero-LLM, fail-open lookup over the indexed `type: 'doc'` chunks for the removed symbol's name.
  - The `api-delta-write.sh` PostToolUse hook appends a short sentence to its existing warning — `"N docs reference X: path1, path2, path3 (+K more)."` — when a removed symbol still has doc references; silent otherwise.
  - The `blast-events.jsonl` ledger gains an additive, optional `docRefCount` field per change.

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
