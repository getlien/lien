---
'@liendev/parser': minor
---

Add a Java/Kotlin same-package resolution tier to `buildDependencyGraph`'s
call-graph (`getCallers`/`getCallersTransitive`), closing the #1005 Phase 2
gap between Phase 1's file-level `findDependents` recovery (#1100) and the
symbol/call-site-level call graph used by blast-radius and the MCP
`get_dependents` tool's `importedBy` evidence.

Java and Kotlin's same-package visibility rule lets one top-level type
reference another in the same package with no import statement at all — the
call graph previously had no way to see that reference for a declared
class/interface symbol, only for the exact same-directory heuristic PHP/
Python/Rust already used (`addSameNamespaceEdges`, unchanged and still firing
for JVM method/function seeds it structurally can't reach). The new tier is
per-type-scoped (`resolveJvmSamePackageDependentsForType`, exported from
`@liendev/parser`) so a multi-type Kotlin file doesn't misattribute a
sibling declaration's callers, unioned onto the existing result (never
replacing it), and tagged `namespace-inferred` — never `import-only` — so it
is correctly excluded from the MCP tool's "verifiably imports" evidence.

Measured against a real OkHttp clone: `getCallers` for `Cache` (Kotlin, same
package `okhttp3`) went from 16 to 33 edges, with 17 real same-package
callers (`OkHttpClient`, `Request`, `Response`, `EventListener`, several
test files, etc.) recovered that were previously invisible to the call
graph entirely.
