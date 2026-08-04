---
'@liendev/parser': patch
---

Extract call sites from module-level code, not just function and method bodies (#1087)

`ast/chunker.ts` gated call-site extraction behind `shouldCalcComplexity` — the
same flag as cognitive/Halstead metrics — so anything that wasn't a function or
method body contributed no call-site evidence at all: `export const client =
createClient(loadConfig())`, route/DI registration, config objects built from
factory calls, and (because a test file is almost entirely bare top-level
statements) every test that calls the function it tests.

Call sites are now extracted for every chunk whose line range no other chunk
overlaps, plus the module-level "uncovered" chunks that previously had no AST
node to extract from. Containers stay excluded, because a class chunk's range
contains its methods' and nothing downstream dedupes across a file's chunks.

Measured across 12 real corpora, the share of files referencing an identifier
declared in the same corpus: this repo 53.6% → 87.5%, zod 26.9% → 85.4%,
express 12.1% → 84.4%, sinatra 42.9% → 82.3%, requests 62.2% → 70.3%. Zero
duplicate attributions anywhere. Complexity metrics, chunk boundaries and
precomputed `dependentCount` are byte-identical before and after; index size
grows ~11% and index time is unchanged.
