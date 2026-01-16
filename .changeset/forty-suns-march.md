---
"@liendev/core": minor
"@liendev/lien": minor
---

feat(indexer): add PHP and Python export tracking for symbol-level dependencies

Extends symbol-level `get_dependents` support to PHP and Python codebases by implementing export tracking for these languages. The `extractExports()` function now identifies:

**PHP:**

- Classes, traits, interfaces (namespaced and global)
- Top-level functions
- All exportable declarations within namespace blocks

**Python:**

- Classes (including `@dataclass` and other decorated classes)
- Functions and async functions
- Decorated definitions (e.g., `@property`, `@staticmethod`)

This enables accurate dependency analysis, impact assessment, and symbol usage tracking for PHP and Python projects. Previously, symbol-level `get_dependents` only worked for JavaScript/TypeScript.

**Architecture:** Export extraction logic has been refactored into dedicated language-specific modules (`extractors/`), mirroring the existing `traversers/` pattern for improved modularity and maintainability.
