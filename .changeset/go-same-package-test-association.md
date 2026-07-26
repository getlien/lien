---
"@liendev/parser": patch
"@liendev/lien": patch
---

Fixes #902: Go's dominant same-package unit-test convention (`foo_test.go`
in the same directory and `package foo` as `foo.go`, with NO import
statement at all — Go forbids a package importing itself) left import-based
test-association matching structurally blind to it. Measured against a real
`cli/cli` clone: 336/356 (94.4%) of `_test.go` files basename-pair with a
same-named sibling; applying that pairing to the 457 files the issue
identified as having a same-directory `_test.go` sibling closes the entire
previously-dark set.

Two tiers, no AST/package-clause parsing needed (Go's compiler already
enforces one package per directory, so same-directory is itself reliable
evidence):

- **Tier 1 — basename pairing** (`foo.go` <-> `foo_test.go`, same
  directory): folded directly into the existing test-association signal
  everywhere it's computed (`findTestAssociationsFromChunks`,
  `get_files_context`'s `testAssociations`), so it flows through to
  `lien annotate`, the MCP-mandated `get_files_context` tool,
  `@liendev/review`'s test-coverage signals, and `verify-tests`/`recap`
  automatically — no signature changes.
- **Tier 2 — package-level fallback** (every `_test.go` file in the
  directory, only when tier 1 finds nothing for that specific file): real,
  same-package signal but coarser, so it gets a distinct, honestly-worded
  label scoped only to `lien annotate`'s printed text (mirroring the
  #869/#875 Swift/C# honesty-label precedent) — deliberately not folded
  into `get_files_context`, `@liendev/review`'s gap detection, or
  `verify-tests`'s ledger/scope-matching.

New `LanguageDefinition.sameDirectoryTestConvention` flag (Go only) +
`hasSameDirectoryTestConvention()` registry predicate, and a new
`go-same-directory-tests.ts` module (`buildGoTestDirIndex`,
`pairGoBasenameTest`, `findGoPackageLevelTests`) exported from
`@liendev/parser`.
