---
'@liendev/parser': minor
---

Closes part of #878: after #877's PSR-4 manifest mapping, 58/67 guzzle
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
`RetryMiddleware` from a *different* file (`Middleware.php`), with zero
textual mention of `RetryMiddleware` anywhere in the test itself — needs
transitive reasoning across files that a single-file structural scan
cannot provide. That case is not resolved here and stays an honest "no
signal" rather than a guess; #878 stays open to track it.
