---
'@liendev/parser': minor
'@liendev/lien': minor
---

feat: add Swift AST support

Swift (`.swift`) now uses full Tree-sitter AST parsing instead of line-based
chunking — symbols, imports, call sites, complexity, and test associations —
bringing the count of AST-supported languages to 11. struct/class/actor/enum/
extension are recognised (keeping the keyword in the signature), protocols map
to interfaces, and `Tests/` directories / `*Tests.swift` files are detected as
tests. Validated with an e2e index of SwiftyJSON.
