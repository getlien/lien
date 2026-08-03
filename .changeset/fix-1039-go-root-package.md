---
"@liendev/parser": patch
---

Fix Go dependency-edge resolution for a module's own ROOT package. Any file
outside the root package that genuinely uses it (idiomatic Go — there's no
relative-import syntax) can only reference it via a bare self-import of the
module's own full path (`import "github.com/go-chi/chi/v5"`). `resolveGoModuleImport`
deliberately leaves that exact-match case unresolved (correct for #867's
narrower test-association scope), so nothing in the general dependents
pipeline ever named a specific root-package file — every root file reported
zero dependents despite being heavily imported by every subpackage. Measured
on go-chi/chi: `context.go` (exports `RouteContext`) showed 0 dependents
despite real `middleware/*.go` callers.

Adds `go-root-package-signals.ts`, a project-wide export-lookup recovery:
which root file actually exports the symbol a bare-self-importing file's own
call sites reference, gated by export uniqueness and a distinctiveness check
(rejects single-segment, common names like `Use`/`Get`/`Post`). Deliberately
NOT a change to `resolveGoModuleImport`/`matchesFile` themselves — crediting
the whole root-package directory the way a subpackage import already does
would fabricate a false hub (the #1008/#1056 shape), since the module root is
frequently the repository root itself alongside dozens of unrelated files.

Verified against go-chi/chi (86 files): dependency edges 11 → 64 (94.2% → 88.4%
orphan rate), `context.go` 0 → 11 real dependents. Confirmed no false hub:
`context.go` and `chi.go` recover disjoint dependent lists. No regression to
Go same-package test-association (#867) or any of the other 10 corpora in the
E2E suite.
