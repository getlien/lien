---
'@liendev/parser': minor
'@liendev/lien': minor
---

`lien complexity` now parses the working tree instead of reading the persisted index, so it works in any repo without `lien index` having been run first — including a fresh linked worktree, which previously reported "Index not found". It can no longer report a stale answer, because there is no stored state to go stale.

It stays gate-shaped: a run that finds nothing to analyze is a hard error, not a confident "0 violations". A failed parse produces the same false-clean result an empty index used to, so the check moved rather than disappeared.

Run from a subdirectory, `lien complexity` and `lien health` now resolve the repository root instead of analysing that subtree alone. A subtree analysis looks like a perfectly normal report while silently understating every dependent count, and for a gate that meant `--fail-on` verdicts on an arbitrary slice of the codebase.

Two fixes in `@liendev/parser` that this exposed, both affecting `performChunkOnlyIndex` and therefore `lien health` as well:

- **Chunk order is now deterministic.** Chunks were accumulated into one shared array from concurrent tasks, making their order depend on which file read finished first. Downstream that reached the `dependents` arrays in `--format json` and the result order in `--format sarif`, so an unchanged tree produced a different byte stream on every run — breaking the documented practice of diffing a committed JSON baseline, and churning code-scanning alert identity.
- **Files above 5 MB are skipped**, matching the cap `lien index` has always applied, and the count is reported so a gate never silently drops a file from its corpus. An 8 MB source file cost roughly a gigabyte of memory to chunk, then exceeded the native parser's string limit, fell back to line-based chunking, and landed in the report carrying meaningless complexity metrics.
