---
'@liendev/parser': minor
---

**Breaking:** the `legacy` parser backend (`node-tree-sitter`) has been removed -- `@liendev/parser-native` is now the only backend (ADR-013 Phase 4-B).

`LIEN_PARSER=legacy` now throws immediately, naming the release that removed it and pointing at `LIEN_PARSER=native` (the default, and now the only valid explicit value) instead of silently mapping to some other backend. If the native binding itself fails to load (no prebuilt package for your platform/arch and no local build), `parseAST` now throws a single actionable error instead of transparently falling back to legacy for the rest of the process -- there is no longer a fallback to fall back to. See `docs/architecture/native-parser.md` for how to build a local binding.

`tree-sitter` and its 11 per-language grammar packages (`tree-sitter-c-sharp`, `tree-sitter-go`, `tree-sitter-java`, `tree-sitter-javascript`, `tree-sitter-kotlin`, `tree-sitter-php`, `tree-sitter-python`, `tree-sitter-ruby`, `tree-sitter-rust`, `tree-sitter-swift`, `tree-sitter-typescript`) are no longer dependencies of `@liendev/parser` -- installing it no longer compiles any native tree-sitter addon. Everything that previously typed against node-tree-sitter's `Parser.SyntaxNode`/`Parser.Tree` now uses `@liendev/parser`'s own `SyntaxNode`/`Tree` types (structurally identical; this only affects direct consumers of `@liendev/parser`'s AST types, not `@liendev/core`/`@liendev/lien`, which never touched them).
