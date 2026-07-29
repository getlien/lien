---
"@liendev/parser": patch
"@liendev/lien": patch
---

Two symbol-extraction gaps (#949), both reproduced against the published
0.72.0 artifact on foreign repos and confirmed to still repro on the
published binary before this fix:

**Ruby `module` declarations were invisible as symbols.** `list_functions`
could not find `module Sidekiq` (sidekiq's own root namespace, at
`lib/sidekiq.rb:42`) or `module Job` (its central job mixin) at all — a
regex query for either returned zero hits. Root cause: `RubyTraverser`
treats `module` as a transparent namespace so `module → class → method`
still yields method chunks (deliberately, to avoid breaking the container
depth budget `isTargetNode` enforces), but that meant the module's own AST
node was never pushed to the chunker's node list, so it never became a
chunk/symbol at all — the dead `case 'module'` branch in
`RubySymbolExtractor.extractSymbol` was structurally unreachable. Fixed by
adding a `transparentContainerTypes` field to `LanguageTraverser` (optional,
undefined for every other language — a no-op): the chunker now emits a
chunk for a node in this list while still traversing its children at the
same depth, keeping the transparency for nested content. Module contents
(nested classes/methods) were never the problem — they were already fully
indexed; only the module's own entry was missing.

`module`'s `symbolType` is `interface`, not `class` — a Ruby module can
never be instantiated, so `class` would misdescribe it. `interface` is an
imperfect but honest fit (closest of the four existing `SymbolInfo` types
to a mixin contributing shared behavior, similar to a Rust trait), chosen
over adding a fifth `module` type to avoid rippling into the `symbolType`
filter, MCP schemas, and every consumer of the closed four-value enum — the
same tradeoff `csharp.ts` made mapping properties to `method` rather than
adding a `property` type.

**Nested type declarations never reported a `parentClass`.** A type
declared directly inside another type (Java/C#'s `public static class
Builder` nested in `Retrofit`, `RequestFactory`, etc. — confirmed on
square/retrofit; C#'s `ContextStackBookmark` nested in `LogContext`,
`SelfLogFailureListener` nested in `SelfLog` — confirmed on
serilog/serilog) always reported `parentClass: null`, making
same-named nested types (six `Builder` results) indistinguishable except
by file path. Root cause: the chunker already resolves the enclosing
type's name for every top-level node via `findParentContainerName` (not
just methods), but each language's `extractClassInfo`/`extractInterfaceInfo`/
etc. either didn't accept the parameter at all or silently dropped it.
Fixed for C#, Java, Python, Swift, and Kotlin (all of which support real
nested type declarations) by threading `parentClass` through every
type-declaration handler, the same way it already worked for methods. The
existing `enclosingSymbol` MCP metadata field is derived from `parentClass`
+ `symbolName`, so it's fixed for free with no separate change.

Not fixed (no repro path, confirmed by traverser inspection): JavaScript/
TypeScript (no `class_declaration`-in-`class_declaration` construct — a TS
namespace nesting classes is a related, separate, still-open gap), PHP (no
nested class-declaration construct), Go (flat structure by design, no
containers at all), Rust (`impl`/`trait` blocks cannot nest in valid Rust;
a `mod` nested in another `mod` doesn't interact with `parentClass` since
`mod` isn't a class-like container — though Rust's `mod` shares Ruby's
Bug 1 shape, invisible as its own symbol, which is out of scope here and
left as a follow-up).
