---
'@liendev/parser': minor
'@liendev/lien': minor
---

Add Ruby AST support.

Ruby `.rb` files now get full structural parsing instead of the line-based
fallback, bringing Ruby to parity with the other AST-supported languages
(TypeScript, JavaScript, Python, PHP, Rust, Go, Java, C#):

- **AST chunking** — one semantic chunk per `def` / `class` / `module` instead
  of fixed line windows.
- **Symbols** with clean signatures (`def self.new(app, options = {})`),
  methods and `singleton_method`s, classes, and modules.
- **Imports** from `require` / `require_relative` / `load` / `autoload`, feeding
  dependency-graph resolution (`get_dependents`).
- **Test associations** — `*_spec.rb` / `*_test.rb` and `spec/` directories are
  recognized.
- **Complexity metrics** for Ruby control flow. (Known v1 limitation: logical
  operators `&&` / `||` are not yet counted.)

Also fixes a latent `extractSignature` bug for no-brace languages (Python and
now Ruby): signatures are bounded by the function body node rather than scanning
for a brace, so multiline/no-brace declarations no longer pull their whole body
into the signature.
