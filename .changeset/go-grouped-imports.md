---
'@liendev/parser': minor
---

Fix Go grouped `import (...)` blocks silently dropping every target but the
first from `chunk.metadata.imports` (#863). A single `import (...)` block
commonly groups 2+ non-stdlib packages (e.g. `import ( "fmt";
"github.com/foo/utils"; "github.com/foo/models" )`), and each is a distinct
target — but `GoImportExtractor.extractImportPath()`'s one-string-per-node
contract could only ever report one, so `findTestAssociationsFromChunks`
(which reads only `chunk.metadata.imports`) was structurally blind to any
test file that imported a later package in the group. Confirmed on a real
shallow clone of gin-gonic/gin: `gin.go`'s own grouped import (6 non-stdlib
targets across `internal/bytesconv`, `internal/fs`, `render`, and three
external packages) previously recorded only the first
(`["internal/bytesconv"]`); it now records all six.

Widens the shared `LanguageImportExtractor` interface with a new
`extractImportPaths(node): string[]` method (returning every target in
source order) alongside the existing singular `extractImportPath` (kept
as-is — still used directly by ~60 existing per-language regression tests,
and by `extractImportPaths`'s own default implementation). Every language
extractor now implements it: nine languages (JS/TS, PHP, Python, Kotlin,
C#, Ruby, Swift, Java, Rust) get the default shape — `extractImportPath`'s
single result wrapped in an array via the new `toImportPathsArray` helper,
zero behavior change — and only `GoImportExtractor` overrides it with real
multi-target extraction; `extractImportPath` itself becomes a thin
`extractImportPaths(node)[0] ?? null` delegate so the two can never
disagree. `ast/symbols.ts`'s internal `extractImportPaths` (the function
that builds `chunk.metadata.imports`) now iterates every path an import
node yields instead of taking at most one.

Deliberately scoped to Go only, per the #859 audit's existing "first wins"
mitigation for PHP's grouped `use Ns\{A, B};` and Rust's bare-root
`use crate::{a::X, b::Y};` groups (both already fixed to keep at least the
first target instead of losing the whole declaration) — those two are
pinned by regression tests added in that audit and are intentionally NOT
widened to capture every target here; only Go's genuinely common,
previously-total-loss case is fixed in this PR.

Does not touch `processImportSymbols` (the `importedSymbols` map, used for
symbol-usage tracking, not test-association) — Go's existing first-wins
behavior there is unchanged; `findTestAssociationsFromChunks` reads only
`imports`, so that was the entire blast radius for #863.
