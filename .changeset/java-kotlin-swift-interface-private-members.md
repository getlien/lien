---
"@liendev/parser": patch
---

Fix `extractExports()` exporting explicitly non-public interface/protocol
members in Java and Kotlin, and dropping a redundant, buggy bypass with the
same shape in Swift (#974).

`java.ts`'s `extractMemberExport` used `if (isInterface || hasPublicModifier(member))`
— when `isInterface` is true the `||` short-circuits, so `hasPublicModifier`
is never evaluated and every `method_declaration`/`constructor_declaration`
in an interface body was exported, including explicitly `private` ones.
Java 9+ permits `private` interface methods (helpers backing a `default`
method), so this was reachable in real code:
`public interface Repository { void save(); private void helper() {} }`
returned `['Repository', 'save', 'helper']` — `helper` should not be there.

`csharp.ts` already had the correct guard (`hasExplicitAccessModifier`,
gating an "implicitly public" fallback to only apply when the member carries
no explicit access modifier). Ported the same shape to `java.ts` (Java's
modifiers are `public`/`private`/`protected` — no `internal`, unlike C#).

Swept every other language whose extractor handles interfaces/protocols for
the same defect shape ("one decision, N language files, fixed at fewer than
N"):

- **Kotlin**: same bug (`isInterface || isExported(member)`), reachable —
  Kotlin 1.4+ allows `private` interface members. Fixed by dropping the
  `isInterface` bypass entirely: `isExported`'s existing "public unless
  explicitly private/internal" rule already matches interface-member
  visibility exactly, so the bypass was both redundant for the correct case
  (no modifier) and wrong for the explicitly-private case — no separate
  C#-style helper was needed.
- **Swift**: same shape (`isProtocol || isExported(member)`). `private`/
  `fileprivate` aren't valid Swift on a real protocol requirement, but the
  `tree-sitter-swift` grammar still parses them, so the extractor could still
  mis-export one from malformed/non-compiling input. Fixed the same way as
  Kotlin (dropped the bypass, relying on `isExported`) for defense in depth
  and consistency, even though it's not reachable from valid, compiling
  Swift.
- **C#**: already correct (the reference implementation for this fix).
- **Go, Rust, PHP, TypeScript/JavaScript, Python, Ruby**: verified
  architecturally unaffected — none of them export interface/trait/protocol
  members individually via an `isInterface`-style bypass at all. Go and Rust
  gate purely on identifier capitalization / a `pub`/visibility-modifier
  check at the container level and never dig into interface/trait bodies to
  export member names separately; PHP and TypeScript/JavaScript only export
  whole top-level declarations (PHP also can't have non-public interface
  methods at all); Python has no interface-like construct in the export
  extractor; Ruby's `private`/`protected` are runtime calls, not per-
  declaration modifiers the extractor inspects.

Added the C#-style regression test ("should not export explicitly non-public
interface members") to `java.test.ts` and `kotlin.test.ts`, and the protocol
equivalent to `swift.test.ts` — confirmed each fails on the pre-fix code and
passes after.
