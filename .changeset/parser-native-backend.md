---
'@liendev/parser-native': minor
'@liendev/parser': minor
---

New package: `@liendev/parser-native`, a prebuilt napi-rs tree-sitter binding for 11 languages (see ADR-013 and docs/architecture/native-parser.md).

`@liendev/parser` gains an opt-in `LIEN_PARSER=native` backend behind a compat deserializer that reconstructs `Parser.SyntaxNode`-shaped objects from the native wire format, so every existing traverser/extractor/complexity analyzer runs unmodified. Default remains `legacy` (node-tree-sitter) -- no behavior change unless the flag is set.
