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
that directory's own entry point. The fix is language-aware, not a blanket
change to `matchesFile`: Ruby's bare multi-segment `require` names exactly
one file, but Go's `import "pkg/sub"` (normalized to the bare `pkg/sub` by
#877's module-prefix stripping) names a *package* — every file in that
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
