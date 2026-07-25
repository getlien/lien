---
"@liendev/parser": patch
"@liendev/lien": patch
---

Fix #884: a source file whose basename coincidentally equals its own
module's name (Swift's `Source/Alamofire.swift` in the `Alamofire` module)
sat inside #868/#883's deliberate one-leading-segment leniency window (the
same window that legitimately allows Rust's bare `auth` -> `src/auth.rs`)
and falsely hubbed every whole-module test file (`import Alamofire`) onto
that one file — reported as ~38 test associations and ~43 dependents on a
43-line file.

Extends #869's honesty treatment rather than touching the shared matcher:
for a `wholeModuleImports` language (Swift), `SwiftImportExtractor` never
emits anything but the bare module name, so the *only* way such an import
can ever win a `matchesFile` comparison is this coincidental basename
match — never a real per-file relationship. New
`isUnresolvableWholeModuleImport(importSpecifier, importerFile)` in
`@liendev/parser` lets callers skip a bare whole-module import before it
ever reaches `matchesFile`, wired into all six callers that independently
implement import matching: `findTestAssociationsFromChunks`,
`analyzeDependencies`/`buildImportIndex`, and the exported
`chunkImportsFrom` primitive in `@liendev/parser` (test coverage and
dependents for `ComplexityAnalyzer`/`get_complexity`, and the public
per-chunk import check), and the CLI's own `get_dependents` import index,
`get_files_context`'s `findTestAssociations`, and `get_dependents`'s
symbol-level `fileImportsSymbolFromAny` (the "N files import this"
dependents count, `lien annotate`'s dependents line, the
`testAssociations` field every pre-edit `get_files_context` call returns,
and symbol-level `get_dependents` queries). `Source/Alamofire.swift` now
correctly falls back to #869's "not determinable from imports" signal (or
an empty dependents/test-associations result) everywhere instead of
reporting a false hub.

`matchesAtBoundaryPrecise`'s general one-leading-segment guard is
untouched — Rust's `auth` -> `src/auth.rs` and every other non-whole-module
language keep matching exactly as before; the fix is scoped entirely to the
caller layer for `wholeModuleImports` languages.
