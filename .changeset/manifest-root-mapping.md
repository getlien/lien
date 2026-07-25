---
'@liendev/parser': minor
---

Fix a 100% test-association failure on standard PHP (Composer PSR-4) and Go
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
deliberately happens *before* `path-matching.ts`'s `normalizePath` would
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
