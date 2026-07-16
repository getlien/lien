---
'@liendev/parser': patch
'@liendev/core': patch
---

Fix a silent indexing gap: small files with no top-level function/class/interface/declaration (e.g. a single bare `test(...)` call) could be dropped from the index entirely — no chunk, no manifest entry, no error.

`chunkByAST`'s AST chunking recognizes functions, classes, interfaces, and declarations as top-level chunks, and falls back to an "uncovered code" chunk covering whatever wasn't recognized (imports, top-level statements, etc.). That fallback chunk was filtered out when it had fewer lines than `minChunkSize` (`chunkByAST`'s own default is 5, but production indexing always calls it via `chunkFile`, which computes 7 from `Math.floor(chunkSize / 10)` with the default `chunkSize` of 75) — a guard meant to suppress noise chunks for small leftover gaps *alongside* real function/class chunks. But when a file has zero recognized top-level nodes, the single "uncovered" chunk covers the entire file, so the same guard silently dropped the whole file instead of just shrinking a gap. A 5-line file containing only `import`s and a bare `test('...', () => {...})` call — no exported function, class, or declaration — hit this exactly: it produced zero chunks and never appeared in the index manifest, so it was invisible to `get_dependents`, test-associations, and every signal that sweeps indexed chunks.

The minimum-size guard is now skipped whenever a file has no other (top-level) chunks, so its single whole-file fallback chunk survives regardless of size — mirroring the existing bypass for barrel/re-export-only files. Empty and whitespace-only files are unaffected: they still produce zero chunks, because that path already (and separately) requires non-empty trimmed content.

This changes what enters `repoChunks` for very small files (e.g. tiny standalone test files). It's sequenced ahead of any harness/corpus recalibration sweep so certified fixture corpora are captured post-fix.
