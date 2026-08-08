---
'@liendev/parser': minor
'@liendev/lien': patch
---

Add a Kotlin same-package test-association mechanism (#1005 Phase 2, Item 2), shipped in both `@liendev/parser`'s `findTestAssociationsFromChunks` (the shared engine — feeds `lien annotate`, blast-radius test-coverage risk, and the agent-review plugin) and `@liendev/lien`'s `get_files_context` MCP tool (its own separate implementation, mirroring the existing C# tier there).

Like Java's own same-package test convention, a Kotlin test class commonly lives in the same package as its subject with no import connecting them at all — Kotlin's same-package visibility rule needs none. This reuses Phase 1's file-level `resolveJvmSamePackageDependents` (#1100), gated strictly to Kotlin (Java keeps its existing, separate path-based mechanism), and explicitly canonicalizes the query path against the index before resolving — a mismatched path form now resolves correctly instead of silently returning zero associations.

Measured against a real Klaxon (Kotlin) clone: `lien annotate` on `Klaxon.kt`, the library's central class, went from reporting "No test coverage" to 53 real, same-package test files.
