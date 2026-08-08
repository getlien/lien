---
'@liendev/parser': minor
---

Extract Java annotation declarations (`@interface Foo {}`,
`annotation_type_declaration`) as real chunks (#1005 Phase 3, Item B).
Previously absent from the Java extractor entirely — an annotation-only file
produced NO chunk at all, so `get_files_context`, `list_functions`, and
`search_code` returned nothing for it.

Maps to `symbolType: 'interface'`, mirroring the existing
`record_declaration` → `'class'` precedent rather than adding a new
`'annotation'` member to `ChunkMetadata['symbolType']`'s closed union.
Annotation MEMBERS (`String value();`-style element declarations) are
deliberately not extracted as their own chunks or exports — only the
annotation's own declared name. A nested annotation reports `parentClass`
via the same existing traversal machinery any other nested declaration
does, and can therefore never become a same-package-resolution owner (G1'
only considers top-level declarations).

The justification is context-quality, not recall: measured across 5 real
Java corpora (javapoet, gson, retrofit, moshi, okhttp), only a handful of
genuine same-package edges newly resolve through a top-level annotation
(single digits) — the real gap this closes is that annotation-only files
were previously invisible to every symbol-aware tool.
