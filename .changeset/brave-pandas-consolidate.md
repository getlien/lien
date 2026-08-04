---
'@liendev/parser': patch
'@liendev/lien': patch
'@liendev/review': patch
---

fix(parser,cli,review): name the fallback behind an inferred dependent (#1018)

`get_dependents`' `dependent-attribution-partial` caveat described C#'s
type-reference fallback in every case, because `confidence: 'inferred'` was
single-valued and the mechanism identity was discarded at the parser boundary.
When #1039 added Go's root-package export lookup — same marker, same caveat
reason — every recovered Go file was told *"its language, C#, lets real callers
use its exports with no per-file import naming it at all"* and that its
dependents came from *"matching a uniquely-declared type name against other
files' source text"*. Both false; measured on a real `go-chi/chi` clone, 24 of
24 recovered edges across `context.go`/`mux.go`/`chain.go`.

`@liendev/parser` now owns `INFERRED_DEPENDENT_MECHANISMS`, a `Record`-guarded
table of the non-import recovery fallbacks and their canonical prose, and
`DependentInfo.inferredVia` names the mechanism per dependent. Every
consumer-facing surface — the caveat note, the caveat-reason text, the server
instructions, the tool description and the docs page — derives from the table
instead of restating it, so a third fallback is a compile error until its prose
exists and then correct everywhere at once.

`DependentInfo.confidence` is unchanged and still marks exactly what it did;
`inferredVia` is additive. `review`'s `isPreciseProvenance` returns exactly what
it returned for all seven tiers, now via a `Record<EdgeProvenance, boolean>` so
an eighth tier can't default silently.

Also fixes two doc-truth defects on the MCP tools page found while mapping the
surfaces: `dependent-attribution-partial` was documented as C#-only, and
`testAssociations[]` was documented as `{ testFile, confidence, method }` with a
"Confidence Levels" section — a shape and vocabulary that exist nowhere in the
code (the real field is `string[]`), attributed to a tool that never emitted the
field.

ADR-016 records why the three vocabularies #1018 named were not merged into one,
and the routing rule for where a new honesty signal belongs.
