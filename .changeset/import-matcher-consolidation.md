---
'@liendev/parser': patch
---

Consolidate the five match-side reverse-dependency call paths
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
that directory's own entry point. `matchesAtBoundaryPrecise`'s "must reach
the end of the compared string" anchor previously only applied to
slash-free (single-segment) patterns like `sinatra`; it now applies to every
bare, non-relative pattern regardless of how many segments it has. The
existing single-segment guards (#868/#883), the Rust source-directory-prefix
convention, and genuine multi-segment-to-multi-segment matches are
unaffected — see the new `matchesFile` unit tests and the sinatra-clone
association-level dogfood in the PR body.
