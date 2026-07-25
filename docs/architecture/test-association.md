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

## Known gaps

These are structural: no import-level signal exists for the case, so the honest answer is a gap, not a bug to fix in the matcher. Each is tracked as an open issue; check its current state before treating this list as final.

- **Java static member imports and Kotlin top-level function/property imports** ([#864](https://github.com/getlien/lien/issues/864)): `import static pkg.Class.member;` (and the Kotlin equivalent for a top-level function or property) extracts a path one segment deeper than the file that defines it, so it does not match via `matchesFile`. Ordinary class-level imports in both languages are unaffected.
- **PHP factory/FQCN usage** ([#878](https://github.com/getlien/lien/issues/878)): a test that reaches production code through a factory method or a fully-qualified class name at the call site, rather than a `use` import, leaves no import signal to match on.

## Where associations surface

- `get_files_context`'s `testAssociations` field (MCP tool)
- `lien annotate` and the post-edit test-association reminder hook (`lien annotate --tests-only`, and its ledger-recording sibling `lien verify-tests note-edit`)
- `@liendev/review`'s blast-radius rendering (test coverage context for a changed file)

## Language support

| Language | Test-file detection | Import matching | Manifest-aware resolution |
|----------|---------------------|------------------|---------------------------|
| TypeScript / JavaScript | generic patterns | yes | workspace packages (monorepo) |
| Python | generic patterns | yes (dotted modules) | none needed |
| PHP | generic patterns | yes | composer.json PSR-4 |
| Go | generic patterns | yes | go.mod module path |
| Ruby | generic patterns | yes | none needed |
| C# | `Tests`/`Test` suffix convention | yes (dotted `using`); not determinable for enclosing-namespace references | none (see honest limitation above) |
| Java | generic patterns | yes | none (see known gaps for static member imports) |
| Kotlin | generic patterns | yes | none (see known gaps for top-level imports) |
| Rust | generic patterns | yes | none needed |
| Swift | `Tests`/`Test` convention | not determinable (whole-module imports) | none |

## History

This document originally described a two-pass design (a convention-based pass plus a separate import-analysis pass, limited to three "Tier 1" languages) that was proposed in [ADR-004](decisions/0004-test-association-detection.md). That two-pass system was never shipped; the single import-based pass above is what actually runs, and it covers all 11 registered languages rather than three. ADR-004 is kept as the historical record of that original design discussion.
