---
'@liendev/parser': minor
'@liendev/lien': minor
---

Add Kotlin AST support.

Kotlin `.kt` files now get full structural parsing instead of the line-based
fallback, bringing Kotlin to parity with the other AST-supported languages
(TypeScript, JavaScript, Python, PHP, Rust, Go, Java, C#, Ruby):

- **AST chunking** — one semantic chunk per `fun` / `class` / `object` /
  `interface` instead of fixed line windows.
- **Symbols** with clean signatures (`fun <T> map(t: T): R`, `suspend fun
  fetch()`, `object Registry`, `enum class Color`), including expression-body
  functions (`fun f() = expr`).
- **Imports** from `import` declarations (incl. wildcard `import a.*` and
  aliases `import a.B as C`); `kotlin.*` / `java.*` filtered, but external
  `kotlinx.*` libraries are kept as dependency edges.
- **Exports** — public-by-default visibility (top-level and member declarations
  unless `private` / `internal`).
- **Complexity metrics** counting `when`, `if`, loops, `catch`, elvis, and the
  `&&` / `||` operators.

The `tree-sitter-kotlin` grammar exposes no field names, so symbols are located
by node type rather than via field accessors.
