# Test Association Flow

Test association links each source file to the tests that cover it, so an AI assistant (or a developer) knows which tests to run after changing a given file.

## How it works today

Association runs as a single pass: `findTestAssociationsFromChunks` in `packages/parser/src/test-associations.ts`. For each target file, it checks every indexed test file's declared imports against that target using boundary-aware string matching, entirely from in-memory chunk metadata (no filesystem access at match time). This runs uniformly across all 11 registered languages (TypeScript, JavaScript, Python, Go, Rust, Java, C#, PHP, Ruby, Kotlin, Swift). There is no separate convention-matching pass, no per-language tier split, and no test-framework detection (jest, vitest, pytest, and so on are not identified).

## Identifying test files

`isTestFile` (`packages/parser/src/utils/path-matching.ts`) filters which files are scanned as candidate test files:

- `.test.` / `.spec.` extensions (`user.test.ts`, `auth.spec.js`)
- `_test.` / `_spec.` suffixes (`parser_test.py`, `math_spec.rb`)
- a `test`, `tests`, `spec`, `specs`, or `__tests__` path segment
- Swift: `Tests.swift` / `Test.swift` files, or a `Tests`/`Test` directory segment
- C#: a `Tests`/`Test` suffix on a filename or directory segment, case-sensitive (`ScopeTests.cs`, `AutoMapper.DI.Tests/`), so `Latest.cs` or a `latest/` directory is never misclassified

## Matching an import to its target

`matchesFile` (same file) tries, in order: an exact match; the target appearing at a path boundary inside the import; the import appearing at a path boundary inside the target; a relative import (`./`, `../`) cleaned and retried; PHP namespace matching (`matchesPHPNamespace`, case-insensitive, matched from the end of the path); and Python dotted-module matching (`matchesPythonModule`, four strategies covering direct, parent-package, suffix, and single-source-directory-prefix matches).

A bare, slash-free identifier (a package name, a Ruby `require`, a Swift framework import) gets extra scrutiny before it can win one of these boundary matches, so it cannot fan out across an unrelated subtree just because its basename happens to coincide with part of a longer path. Three cases this guards against, verified against real repositories:

- Go: `github.com/gin-gonic/gin/internal/fs` no longer tail-matches an unrelated top-level `fs.go`
- Ruby: a bare `require 'sinatra'` no longer matches every file under `lib/sinatra/`, only the gem's own entry point (`lib/sinatra.rb`)
- Swift: `import Combine` (a system framework) no longer matches an unrelated `Source/Features/Combine.swift`

The exception is a bare import resolving to a same-named file one directory below the source root (for example Rust's `auth` resolving to `src/auth.rs`), which stays allowed as an established convention.

## Resolving import specifiers before matching

Before `matchesFile` runs, a raw import specifier is resolved in `resolveImportSpecifier` (`packages/parser/src/ast/symbols.ts`) in three steps: relative-import resolution, workspace-package resolution (for JS/TS monorepos, via `workspace-packages.ts`), and manifest-root resolution for languages whose imports are never filesystem-relative:

- PHP: `packages/parser/src/php-psr4.ts` reads `composer.json`'s `autoload.psr-4` / `autoload-dev.psr-4` maps and resolves an import by its longest matching namespace prefix. This is what makes a standard, non-Laravel PSR-4 layout resolvable (a namespace root like `GuzzleHttp\` rarely equals a literal directory name; only `composer.json` declares the real mapping to `src/`).
- Go: `packages/parser/src/go-module.ts` reads `go.mod`'s `module` line and strips that exact prefix from an import path, since Go imports are always full module paths and the module's own root segment never corresponds to a literal directory in a real checkout.

Both readers are intentionally narrow: parsed once per workspace root, cached, and a no-op when the manifest is absent or has no matching entry, so a non-Composer or non-Go-module project sees no behavior change. PHP's `classmap`/`files` autoloading and PSR-0 are out of scope; Go's per-module (as opposed to per-repo) `go.mod` files are not read separately.

Verified directly: a `composer.json` with `"GuzzleHttp\\": "src/"` correctly associates a test under `tests/` that imports `GuzzleHttp\Cookie\SetCookie` with `src/Cookie/SetCookie.php`, and a `go.mod` declaring `module example.com/gadget` correctly associates a test importing `example.com/gadget/internal/foo` with `internal/foo/foo.go`.

## Whole-module-import languages: an honest limitation

Swift test files import their subject as a whole module (`import Alamofire`, `@testable import Alamofire`) rather than a specific file or symbol path, so there is no per-file signal for the matcher to resolve. This is a structural gap, not a fixable false negative: every test file in a module carries the identical bare-module import string.

Rather than reporting the misleading `No test coverage.` on a file that may in fact be heavily tested, `lien annotate` reports:

```
Test coverage not determinable from imports (whole-module import).
```

for any file whose language sets `LanguageDefinition.wholeModuleImports` (checked via `hasWholeModuleImports()` in the language registry, verified empirically against a fixture). Only Swift sets this flag today.

A related guard, `isUnresolvableWholeModuleImport`, additionally excludes the one case a whole-module import can otherwise "win" a match: a coincidental basename, where a source file's name happens to equal its own module's name (`Source/Alamofire.swift` inside a module also named Alamofire). Without it, that file would falsely appear to be imported by every test in the module. The guard is applied at each of the four independent places that match imports against files: `findTestAssociationsFromChunks` (this document), `get_dependents`'s import index, and the two callers above that share `path-matching.ts`.

## Enclosing-namespace-access languages: an honest limitation

A C# namespace body gets implicit, unqualified access to every *enclosing* namespace's public members — `namespace AutoMapper.UnitTests { ... }` can reference `AutoMapper.TypeMap` with no `using` directive at all, per ordinary C# name resolution. Confirmed against AutoMapper/AutoMapper: 355/364 `UnitTests/` files rely on exactly this and carry no relevant `using`, so there is no per-file import signal for them ([#875](https://github.com/getlien/lien/issues/875)). The remaining 9/364 files use an explicit dotted `using AutoMapper.X;` and resolve correctly through ordinary import matching (same mechanism as the section above).

Rather than reporting the misleading `No test coverage.` on a file that may in fact be heavily tested, `lien annotate` reports:

```
Test coverage not determinable from imports (enclosing-namespace access).
```

for any file whose language sets `LanguageDefinition.enclosingNamespaceAccess` (checked via `hasEnclosingNamespaceAccess()` in the language registry, verified empirically against a real AutoMapper clone: 47 previously-misleading `No test coverage.` files across `src/AutoMapper/**` all switched to this message, with the 26 files that had genuine associations via the dotted-`using` path unaffected). Only C# sets this flag today.

This is a deliberately separate flag from `wholeModuleImports`, not a reuse of it: unlike Swift's bare module imports, which never carry per-file signal at all, C#'s explicit dotted usings do resolve real per-file associations correctly. C# usings are dotted rather than slashed, so folding this into `wholeModuleImports` would make `isUnresolvableWholeModuleImport`'s slash check treat every C# `using` as an unresolvable bare import too, discarding the working dotted-`using` cases.

The structural remainder — which specific test covers which specific file within an enclosing namespace — stays genuinely unrecoverable from import data alone, the same as Swift's whole-module gap: there is no heuristic recovery here (no name-proximity matching), per the same false-positives-are-worse-than-silence reasoning as the bare-identifier guard above.

## Go's same-package test convention: a recovered signal, not just an honest label

Go's dominant unit-test shape colocates a `_test.go` file in the same directory and `package` as the file it tests, with **no import statement connecting them at all** — Go forbids a package from importing itself, so `chunk.metadata.imports` carries zero signal for this convention ([#902](https://github.com/getlien/lien/issues/902)). Measured against a real `cli/cli` clone: 336/356 (94.4%) of `_test.go` files basename-pair with a same-named sibling (`foo.go` <-> `foo_test.go`); the remainder are either external `package foo_test` files (still resolved via ordinary import matching, since an external test package must import what it tests) or the rare directory with no sibling source file at all (e.g. a repo-wide acceptance test).

Unlike the whole-module/enclosing-namespace gaps above, this one needs no heuristic and no honesty label for its primary tier — Go's compiler already enforces one package per directory, so "same directory" is itself deterministic evidence, recoverable with pure filepath-string reasoning (`packages/parser/src/go-same-directory-tests.ts`), no AST or `package`-clause parsing required:

- **Tier 1 (`pairGoBasenameTest`)**: `foo.go` <-> `foo_test.go`, same directory, exact stem match. Folded directly into the same result as a real import match — no hedging — in both `findTestAssociationsFromChunks` (this document) and `get_files_context`'s own separate `findTestAssociations`, gated by `LanguageDefinition.sameDirectoryTestConvention` (checked via `hasSameDirectoryTestConvention()` in the language registry; only Go sets this today). This is why it flows automatically to every consumer listed below with no signature changes.
- **Tier 2 (`findGoPackageLevelTests`)**: every `_test.go` file in the target's directory, consulted only when tier 1 finds nothing for that specific file. Real, same-package signal, but coarser — a directory's one test file may not literally exercise every sibling (though Go's own per-directory build-tag convention, e.g. platform-specific `embed_linux_amd64.go` variants of a single abstraction, is the common shape here). `lien annotate` reports this distinctly rather than folding it into the same claim as tier 1 or an import match:

  ```text
  Test coverage (package-level, no dedicated test file for this specific file): licenses_test.go.
  ```

  Deliberately scoped to `lien annotate`'s own printed text only (mirroring the whole-module/enclosing-namespace sections' single-site discipline) — **not** threaded into `get_files_context`'s `testAssociations`, `@liendev/review`'s test-coverage gap detection, or `verify-tests`'s ledger/scope-matching. A file with only tier-2 coverage still reads as a gap to those three, which is the conservative, correct call: tier 2's evidence is real but not precise enough to suppress a review finding or clear a verification nudge on its own.

Both tiers are structurally bounded to the same directory (Go's own compiler guarantee) — the worst either can produce is "attributed to the wrong file in the same package," never the cross-directory textual collisions the bare-identifier guard above protects against.

## Swift symbol-usage association: a measure-gated non-import signal

Swift's whole-module-import gap (above) is a genuine structural blind spot — but the SQLite chunk store already carries a DIFFERENT signal that doesn't depend on imports at all: a test chunk's own `callSites` (the AST-extracted symbols it references) versus which single source file uniquely DEFINES that symbol. Measured against real Alamofire/vapor/swift-composable-architecture clones ([#869](https://github.com/getlien/lien/issues/869)), this recovers real, individually-verified coverage for a subset of the files the whole-module gap above leaves dark.

`packages/parser/src/swift-symbol-usage-signals.ts` implements the rule: test `T` associates with source `S` iff `T`'s `callSites` reference a symbol `X` such that:

1. `X` passes **both** the shipped `isUnambiguousIdentifierShape` (docRefs' gate) **and** this module's own, stricter `isMultiSegmentIdentifier` — at least 2 camelCase/PascalCase/underscore segments. The shipped gate alone is insufficient here: its case-transition check is satisfied by the first two characters of ANY Capitalized word (`Ge` in `Get`, `Se` in `Session`), so it passes `Get`/`Run`/`Map`/`Session`/`Client` just as readily as `TypeMap`/`HTTPHeaders` — fine for its original prose-vs-code job, useless as a collision-resistance gate. `isMultiSegmentIdentifier` is a separate, additional helper; the shipped gate itself is untouched.
2. `X` is defined in **exactly one** non-test Swift file project-wide.
3. That defining file is not `T` itself.
4. The (S, T) edge has at least one driving symbol that also passes `isTypeShapedIdentifier` — see below.

The definition side excludes `extension <ForeignType> { ... }` declarations from counting as a definition, unless the type also has a real (non-extension) declaration somewhere in the project. This is one false-positive shape measured on Alamofire: `extractSwiftClasses` treats `extension HTTPURLResponse { ... }` as *defining* `HTTPURLResponse`, so every test that happens to reference that Foundation type would otherwise falsely hub onto the extending file. Because a Foundation/stdlib type is never actually declared inside the project, "every declaration of X in this corpus is an extension" already IS the foreign-type test — no hardcoded list of framework type names required.

### Gate 4: a post-ship hardening after adversarial re-verification found real false positives

The first shipped version of this signal (gates 1-3 only) was calibrated and measured as ~100% precision across all three repos. An adversarial re-check of the raw evidence — opening the actual call sites, not just re-confirming declaration uniqueness — found that gates 1-3 are insufficient: "unique among this project's own indexed files" does not mean "this specific call resolves to that declaration." Swift lets a bare method name collide with something the indexer never sees at all:

- **A stdlib protocol witness.** Alamofire's `Tests/TestHelpers.swift` calls `decoder.singleValueContainer()` inside an `extension HTTPHeaders: Decodable` — the Swift stdlib `Decoder` protocol's own requirement, satisfied by every conforming type in existence, not Alamofire's differently-typed `URLEncodedFormEncoder.singleValueContainer()`.
- **A stdlib type's own extension overload.** swift-composable-architecture's `Effect.swift` adds a `name:`-taking `TaskGroup.addTask` overload as a backwards-compatible shim; every test call site actually uses the plain, no-`name:` stdlib `TaskGroup.addTask(priority:operation:)`.
- **An external package's free function.** The same repo's `withDependencies { ... }` call sites all resolve to the separate `swift-dependencies` package's own top-level function, not `TestStore.withDependencies` — the package is a `Package.swift` dependency, never part of the indexed project.

Every confirmed false positive (`singleValueContainer`, `asURL`, `addTask`, `flatMap`, `withDependencies`) shared one trait: the edge's only driving symbol(s) were lowercase method names, with no PascalCase type reference alongside them. `isTypeShapedIdentifier` (leading-uppercase — allowing Swift's `_`-prefixed SPI convention, e.g. `_CancelID` — and multi-segment) requires at least one such driver per edge; a purely method-driven edge is demoted. This is a structural, method-name-agnostic shape check, not a hardcoded list of risky method names.

**The trade-off, measured exhaustively (every edge in all three repos, independently re-verified) after the fix:**

| Repo | Pre-hardening edges | Pre-hardening honest precision | Post-hardening edges | Post-hardening precision |
|---|---|---|---|---|
| Alamofire/Alamofire | 46 | 44/46 = 95.7% (2 confirmed FPs) | 26 | 26/26 = 100% |
| vapor/vapor | 57 | 57/57 = 100% (0 FPs) | 25 | 25/25 = 100% |
| pointfreeco/swift-composable-architecture | 49 | 41/49 = 83.7% (8 confirmed FPs) | 29 | 29/29 = 100% |

Gate 4 is necessary — without it, swift-composable-architecture fails the ship bar outright — but it is costly: roughly half of all previously-good edges are lost project-wide (62 of 142 confirmed-good pre-hardening edges), including **every** edge to Alamofire's own `Request.swift`, the file that originally motivated this investigation (`Request` is single-segment and can never itself be a type-shaped driver, and none of its distinctively-named methods have a type-shaped symbol alongside them in the tests that call them). vapor loses 32 confirmed-good edges for zero precision benefit (it had none to fix). This is a real, substantial recall cost from a blunt but precision-safe rule — flagged here rather than glossed over.

This is a strictly ADDITIVE, lower-confidence THIRD tier, never merged into the confident import-based association above (or Go's tier 2) — mirroring that tier's discipline exactly:

```text
Test coverage inferred from symbol usage (not import-verified): Tests/HTTPHeadersTests.swift.
```

for any Swift file whose `tests` (tier 1) came back empty but the symbol-usage signal found a hit; falls through to the existing `Test coverage not determinable from imports (whole-module import).` label when it doesn't. Scoped to `lien annotate`'s printed text only (`computeSwiftSymbolUsageFallback` in `annotate-cmd.ts`) — deliberately **not** threaded into `get_files_context`'s `testAssociations`, `@liendev/review`'s test-coverage gap detection, or `verify-tests`'s ledger/scope-matching, the same conservative call as Go's tier 2.

## Java static-member imports: a derived second candidate

`import static pkg.Class.member;` (a specific, non-wildcard static-member import) extracts a path one segment deeper than the file that defines it — `com.example.Utils.method`, when the file is `com/example/Utils.java` — so it could never match via `matchesFile` on its own. `JavaImportExtractor.extractImportPaths` (`packages/parser/src/ast/languages/java.ts`) now returns the class's derived FQN (the path with its trailing segment dropped) as a second candidate alongside the unchanged original. This is safe rather than a guess: Java requires every top-level type to live in a file named after it, and nested types/members always live inside their enclosing top-level type's file, so dropping the trailing segment always yields that type's correct FQN — whether the segment names a static member or a nested class (`import static a.B.Inner;`, correct by the same rule). A static import reaching two-plus levels into nested classes under-matches silently, the same as before this fix, rather than mismatching. Wildcard static imports and ordinary (non-static) imports are unaffected. Verified on a real clone of google/gson: `JsonReaderTest.java`'s static imports of `JsonToken.STRING`/`NUMBER`/etc. now associate it with `JsonToken.java`, with zero other test-association changes across the repo's 264 Java files.

## PHP fully-qualified class-name references: a partial fix

PHP resolves a leading-`\` name absolutely, regardless of what's `use`-imported in scope — so a test can genuinely reference a class through `new \Foo\Bar\Baz(...)`, `\Foo\Bar\Baz::class`, or `\Foo\Bar\Baz::method()` with no corresponding `use` statement anywhere in the file, invisible to the declaration-based extraction above ([#878](https://github.com/getlien/lien/issues/878)). `PHPImportExtractor.extractReferencedFQCNs` (`packages/parser/src/ast/languages/php.ts`) recursively scans a whole file for exactly those three expression shapes, requiring the class-name part to be a `qualified_name` node whose own text starts with `\` — genuinely unambiguous, unlike a "qualified but not fully-qualified" name (`Foo\Bar`, no leading `\`), which resolves relative to the current namespace or a `use` alias and is excluded as ambiguous. A fully-qualified single-segment name (`\DateTime`, `\Exception`) is also excluded, since it can only ever be a PHP built-in, never a Composer-autoloaded project file. The results are resolved through the exact same PSR-4 pipeline as a normal `use` import and merged in, deduplicated.

Verified on a live guzzle/guzzle clone: `tests/ClientTest.php` references `\GuzzleHttp\Exception\ClientException::class` with no `use` import for it (it already imports `GuzzleHttp\Client`, not the exception), and now correctly appears in `src/Exception/ClientException.php`'s test-coverage list alongside the file's other, already-`use`-resolved test associations.

Unlike the Swift/C# gaps above, this is not a blanket per-language limitation flagged with an honest "not determinable" message — it's a real, if narrow, resolution that composes with existing `use`-based matching for any file with at least one genuinely fully-qualified reference. What it does *not* resolve is the more common factory-indirection shape in the same codebase (see Known gaps below): a test that calls a factory method (`Middleware::retry()`) whose *internal implementation* — in a different file — is what actually names the concrete class (`RetryMiddleware`). No FQCN or `use` reference to that class exists anywhere in the test file itself for a single-file scan to find.

## Known gaps

These are structural: no import-level signal exists for the case, so the honest answer is a gap, not a bug to fix in the matcher. Each is tracked as an open issue; check its current state before treating this list as final.

- **Kotlin top-level function/property imports** ([#864](https://github.com/getlien/lien/issues/864)): `import a.b.myFunction`, for a top-level function or property defined in an arbitrarily-named file within the package, extracts a path that never matches its defining file. Java's analogous static-member shape is fixed (above) because the `static` keyword is itself proof the trailing segment is a class member or nested type; Kotlin's grammar has no equivalent marker — a top-level declaration and a class/object-member access (`import a.b.MyObject.method`) parse to the identical flat `identifier` of `simple_identifier` segments — so guessing which applies risks the false-positive fan-out #868 warned against. Ordinary Kotlin class imports are unaffected. Confirmed unchanged on a real clone of JetBrains/Exposed: zero test-association changes across 755 Kotlin files.
- **PHP factory-indirection usage** ([#878](https://github.com/getlien/lien/issues/878), partial): a direct fully-qualified class-name reference (`\Foo\Bar\Baz::class`, `new \Foo\Bar\Baz(...)`) is resolved (see the dedicated section above). What's left is a test that only ever names a *factory* (`Middleware::retry()`), where the factory's own implementation — in a different file — is what actually instantiates the concrete class. That needs reasoning across files, not just within one; still an honest no-signal gap.

## Where associations surface

- `get_files_context`'s `testAssociations` field (MCP tool) — includes Go tier 1 (basename pairing), not tier 2 (package-level fallback) or Swift's symbol-usage signal
- `lien annotate` and the post-edit test-association reminder hook (`lien annotate --tests-only`, and its ledger-recording sibling `lien verify-tests note-edit`) — the only surface that also shows Go's tier 2 fallback and Swift's symbol-usage signal, both distinctly labeled; `verify-tests`'s ledger/scope-matching itself still only sees tier 1
- `@liendev/review`'s blast-radius rendering (test coverage context for a changed file) — tier 1 only, same reasoning as `get_files_context`

## Language support

| Language | Test-file detection | Import matching | Manifest-aware resolution |
|----------|---------------------|------------------|---------------------------|
| TypeScript / JavaScript | generic patterns | yes | workspace packages (monorepo) |
| Python | generic patterns | yes (dotted modules) | none needed |
| PHP | generic patterns | yes (incl. fully-qualified class-name references) | composer.json PSR-4 |
| Go | generic patterns | yes (imports) + same-directory basename pairing, no import needed (package-level fallback in `lien annotate` only) | go.mod module path |
| Ruby | generic patterns | yes | none needed |
| C# | `Tests`/`Test` suffix convention | yes (dotted `using`); not determinable for enclosing-namespace references | none (see honest limitation above) |
| Java | generic patterns | yes (incl. static-member imports, derived class-path candidate) | none |
| Kotlin | generic patterns | yes | none (see known gaps for top-level function/property imports) |
| Rust | generic patterns | yes | none needed |
| Swift | `Tests`/`Test` convention | not determinable (whole-module imports); measure-gated symbol-usage fallback in `lien annotate` only (see above) | none |

## History

This document originally described a two-pass design (a convention-based pass plus a separate import-analysis pass, limited to three "Tier 1" languages) that was proposed in [ADR-004](decisions/0004-test-association-detection.md). That two-pass system was never shipped; the single import-based pass above is what actually runs, and it covers all 11 registered languages rather than three. ADR-004 is kept as the historical record of that original design discussion.
