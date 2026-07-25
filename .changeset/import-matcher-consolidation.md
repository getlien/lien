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
