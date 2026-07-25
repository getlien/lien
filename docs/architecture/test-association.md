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

## PHP fully-qualified class-name references

PHP resolves a leading-`\` name absolutely, regardless of what's `use`-imported in scope — so a test can genuinely reference a class through `new \Foo\Bar\Baz(...)`, `\Foo\Bar\Baz::class`, or `\Foo\Bar\Baz::method()` with no corresponding `use` statement anywhere in the file, invisible to the declaration-based extraction above. `PHPImportExtractor.extractReferencedFQCNs` (`packages/parser/src/ast/languages/php.ts`) recursively scans a whole file for exactly those three expression shapes, requiring the class-name part to be a `qualified_name` node whose own text starts with `\` — genuinely unambiguous, unlike a "qualified but not fully-qualified" name (`Foo\Bar`, no leading `\`), which resolves relative to the current namespace or a `use` alias and is excluded as ambiguous. A fully-qualified single-segment name (`\DateTime`, `\Exception`) is also excluded, since it can only ever be a PHP built-in, never a Composer-autoloaded project file. The results are resolved through the exact same PSR-4 pipeline as a normal `use` import and merged in, deduplicated.

Verified on a live guzzle/guzzle clone: `tests/ClientTest.php` references `\GuzzleHttp\Exception\ClientException::class` with no `use` import for it (it already imports `GuzzleHttp\Client`, not the exception), and now correctly appears in `src/Exception/ClientException.php`'s test-coverage list alongside the file's other, already-`use`-resolved test associations.

This does not resolve the more common factory-indirection shape in the same codebase (see Known gaps below): a test that calls a factory method (`Middleware::retry()`) whose *internal implementation* — in a different file — is what actually names the concrete class (`RetryMiddleware`). No FQCN or `use` reference to that class exists anywhere in the test file itself for a single-file scan to find.

## Whole-module-import languages: an honest limitation

Swift test files import their subject as a whole module (`import Alamofire`, `@testable import Alamofire`) rather than a specific file or symbol path, so there is no per-file signal for the matcher to resolve. This is a structural gap, not a fixable false negative: every test file in a module carries the identical bare-module import string.

Rather than reporting the misleading `No test coverage.` on a file that may in fact be heavily tested, `lien annotate` reports:

```
Test coverage not determinable from imports (whole-module import).
```

for any file whose language sets `LanguageDefinition.wholeModuleImports` (checked via `hasWholeModuleImports()` in the language registry, verified empirically against a fixture). Only Swift sets this flag today.

A related guard, `isUnresolvableWholeModuleImport`, additionally excludes the one case a whole-module import can otherwise "win" a match: a coincidental basename, where a source file's name happens to equal its own module's name (`Source/Alamofire.swift` inside a module also named Alamofire). Without it, that file would falsely appear to be imported by every test in the module. The guard is applied at each of the four independent places that match imports against files: `findTestAssociationsFromChunks` (this document), `get_dependents`'s import index, and the two callers above that share `path-matching.ts`.

## Known gaps

These are structural: no import-level signal exists for the case, so the honest answer is a gap, not a bug to fix in the matcher. Each is tracked as an open issue; check its current state before treating this list as final.

- **Java static member imports and Kotlin top-level function/property imports** ([#864](https://github.com/getlien/lien/issues/864)): `import static pkg.Class.member;` (and the Kotlin equivalent for a top-level function or property) extracts a path one segment deeper than the file that defines it, so it does not match via `matchesFile`. Ordinary class-level imports in both languages are unaffected.
- **C# enclosing-namespace references** ([#875](https://github.com/getlien/lien/issues/875)): a file in a sub-namespace can reference an enclosing namespace's members with no `using` statement at all, leaving no import signal. Only the dotted `using X.Y;` form resolves.
- **PHP factory-indirection usage** ([#878](https://github.com/getlien/lien/issues/878), partial): a direct fully-qualified class-name reference (`\Foo\Bar\Baz::class`, `new \Foo\Bar\Baz(...)`) is resolved (see above). What's left is a test that only ever names a *factory* (`Middleware::retry()`), where the factory's own implementation — in a different file — is what actually instantiates the concrete class. That needs reasoning across files, not just within one; still an honest no-signal gap.

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
| C# | `Tests`/`Test` suffix convention | yes | none (see known gaps) |
| Java | generic patterns | yes | none (see known gaps for static member imports) |
| Kotlin | generic patterns | yes | none (see known gaps for top-level imports) |
| Rust | generic patterns | yes | none needed |
| Swift | `Tests`/`Test` convention | not determinable (whole-module imports) | none |

## History

This document originally described a two-pass design (a convention-based pass plus a separate import-analysis pass, limited to three "Tier 1" languages) that was proposed in [ADR-004](decisions/0004-test-association-detection.md). That two-pass system was never shipped; the single import-based pass above is what actually runs, and it covers all 11 registered languages rather than three. ADR-004 is kept as the historical record of that original design discussion.
