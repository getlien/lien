---
'@liendev/parser': minor
'@liendev/core': patch
---

Fix a chunker bug (#1005 Phase 3, Item D) that silently dropped a file's
leading (header) uncovered range whenever it was shorter than `minChunkSize`
and the file had no `export`-recognized declaration — a package-private
Java/Kotlin file's `package` line, or a C# file's file-scoped `namespace`
line, could sit in exactly that gap. Losing the range didn't just shrink a
chunk, it made the file's package/namespace undetectable anywhere else in
the index, silently disabling same-package/namespace dependent resolution
(`jvm-same-package-signals.ts`, `csharp-type-reference-signals.ts`) for that
file as both target and candidate.

The fix (`isLeadingHeaderRange` in `ast/chunker.ts`) bypasses `minChunkSize`
specifically for a file's leading uncovered range, evaluated per-range so an
unrelated short gap elsewhere in the same file is still dropped as noise.
Measured against real Java/Kotlin/C# corpora (kotlinx-coroutines, klaxon,
javapoet, retrofit, okhttp, serilog), a content-aware variant restricted to
package/namespace-declaration-matching ranges added at most 1-2 extra chunks
per corpus beyond this simpler position-based rule — and every one of those
extras was an unrelated non-JVM/non-C# file, never a real miss — so the
simpler, regex-free rule ships.

Also strips `package` declaration lines (in addition to the existing
`import`-line stripping) from `jvm-same-package-signals.ts`'s text-match
corpus, closing a fabrication risk this fix newly exposes: a header chunk
that previously never reached the match corpus now always does, and a
package whose own last segment collides with a real type name could
otherwise read as a textual self-reference.

Bumps `INDEX_FORMAT_VERSION` 5 → 6 so existing indexes pick up the fix on
next `lien index` rather than silently keeping stale package derivation
until a manual full reindex.
