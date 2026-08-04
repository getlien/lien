---
'@liendev/parser': patch
'@liendev/core': patch
'@liendev/lien': patch
---

fix(core,parser): resolve `search_code`'s `dependentCount` with the real import matcher (#1071)

`search_code`'s structural ranking boost was the identity function on most
languages. `dependentCount` came from a private ~40-line resolver that
understood only `./foo` and `../bar` specifiers, so every C#, Go, Rust and
Swift file scored `0` — and `applyStructuralBoost(ratio, 0)` is exactly
`ratio`. Its normalizer also treated a specifier's final dotted segment as a
file extension, turning `org.junit.Test` into `org.junit`.

`dependentCount` is now resolved by `importMatchesTarget` — the same guarded
decision `get_dependents` makes, carrying the whole-module (#884),
single-file-vs-package (#887), Python bare-module (#929), PHP namespace
(#1028) and Rust exact-single-file (#1021/#1056) guards, plus the C#
type-reference and Go root-package recovery tiers. Measured against pinned
real corpora, files with a non-zero count: serilog (C#) 0% → 60%, OrchardCore
(C#) 0.3% → 67%, gin (Go) 0% → 11%, anyhow (Rust) 0% → 35%, flask (Python)
24% → 36%.

Counts are precomputed into a new `dependent_counts` table at the end of a
full index instead of being derived per query, so the query path got faster,
not slower: count acquisition drops from 103 ms to 1.4 ms on a 53k-chunk
corpus. The table is additive and created on open, so a standalone index
built by an older version keeps the previous behaviour (every count `0`) until
its next full index — no forced reindex. In a linked worktree the counts are
computed over the composed `(base − masked) ∪ overlay` corpus, never the
overlay alone, so a worktree gains real counts as soon as its overlay is
rebuilt even while the shared base index is still on the old format.

Also makes the C# type-reference dependents tier resolve from a one-pass
inverted reference index rather than re-scanning every file's content per
target, which is what makes it affordable in a whole-corpus pass and speeds up
`get_dependents` on large C# repositories by an order of magnitude.

Swift still resolves to `0` for every file: its whole-module `import
Foundation` form names no specific file, so there is nothing to resolve
(#884). That is now a documented, tested zero rather than a silent one.

Removes `computeDependentCounts` and `normalizeFileForCounts` from
`@liendev/core`'s `vectordb/sqlite/dependent-counts` module — the broken
resolver and the extension-strip that corrupted dotted specifiers. Neither was
re-exported from the package's entry point (`@liendev/core`'s export map
exposes only `.` and `./test`), so no external consumer could reach either and
this is not a breaking change; it is recorded here because deleting a symbol
should never be silent. `readDependentCounts`, `writeDependentCounts`,
`getDependentCounts` and `refreshDependentCounts` replace them.
