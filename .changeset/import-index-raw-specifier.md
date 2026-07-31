---
"@liendev/parser": minor
"@liendev/lien": patch
---

Collapse the import index's remaining unguarded match paths onto
`importMatchesTarget` (#994 Phase 3). `dependency-analyzer.ts`'s import index
used to store bare chunks (`Map<string, CodeChunk[]>`), discarding both the
raw (pre-normalization) import specifier and per-importer identity once a
bucket key was computed. That forced `findDependentChunks`'s fuzzy loop to
reconstruct the #887 (Ruby/Go single-file-vs-package) and #929 (Python
bare-module) guards itself, per chunk, via two extra `matchesFile` calls
instead of calling the single guarded primitive directly — the same three
guards expressed in two different shapes, with nothing forcing them to
agree (the root cause behind #934 and #955 shipping the same guard gap
twice).

Each index entry now carries `{ chunk, rawSpecifier }` (`ImportIndexEntry`,
newly exported), so `findDependentChunks`'s fuzzy loop and both of the
index's own builders (`buildImportIndex` for `analyzeDependencies`,
`indexImportEntry`/`addChunkToImportIndex` for `findDependents`) route
through `importMatchesTarget` uniformly. `addFuzzyMatchChunks`'s signature
changed accordingly (bucket entries + a normalizer, instead of a normalized
specifier + bare chunk list) — it and `findDependentChunks` are both public
exports of `@liendev/parser`, hence the minor bump.

`buildReExportGraph`'s one remaining raw `matchesFile` call is unchanged: it
is a same-normalizer file-identity check (skip the target file itself when
scanning re-exporter candidates), not an import-vs-file match, so there was
never a specifier for `importMatchesTarget` to guard there in the first
place — see `path-matching.ts`'s updated design comment.

Pure consolidation, not a behavior change: verified byte-identical
`lien annotate` output before and after on this repo and on tracked
multi-language fixtures (`lien-review-testbed`'s Python and Rust files).
`lien delta` (gate 6) reports 2 improved functions (`analyzeDependencies`,
`addFuzzyMatchChunks`), 0 regressions.
