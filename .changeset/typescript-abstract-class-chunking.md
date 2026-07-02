---
'@liendev/parser': minor
'@liendev/lien': minor
---

Fix TypeScript abstract classes not being chunked. tree-sitter-typescript parses `abstract class Foo {}` as a distinct `abstract_class_declaration` node (and an unimplemented method as `abstract_method_signature`), separate from `class_declaration`/`method_definition`. Neither was recognized by the traverser, so an abstract class collapsed into a single anonymous `block` chunk and its methods didn't exist as searchable symbols. Abstract classes now chunk like regular classes: the class itself is a named `class` symbol, concrete methods keep their body/complexity, and abstract method signatures are extracted sanely (no body to measure, so complexity defaults to a baseline of 1).
