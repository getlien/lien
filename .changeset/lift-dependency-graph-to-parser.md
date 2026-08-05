---
'@liendev/parser': minor
---

Export the call-site-level dependency graph (`buildDependencyGraph`, `isPreciseProvenance`, and the `DependencyGraph`/`SymbolNode`/`CallerEdge`/`EdgeProvenance`/`TransitiveCallerEdge`/`TransitiveResult`/`TransitiveOptions` types) from `@liendev/parser`.

This graph previously lived inside the private `@liendev/review` package,
even though it imported nothing review-specific — only parser's own
`walkBounded`, `importMatchesTarget`, `normalizePath`, `detectLanguage`,
`findCSharpTypeReferenceDependents`, and `callerSymbolFor`. Lifting it into
`parser/src/graph/dependency-graph.ts` (alongside the generic `walkBounded`
BFS it already builds on) makes the symbol/call-site-level resolution it
provides reachable from `@liendev/cli` too, not just `@liendev/review` —
a prerequisite for a richer `get_dependents` and `lien api-delta` blast-radius
nudge than today's file-level `findDependents` can give them. Pure
relocation: no behavior change to any existing export.
