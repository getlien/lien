---
"@liendev/parser": patch
---

Fix `signature` for Python/PHP/Go type declarations dropping generic type
parameters and the heritage clause (base class / interface list) — #965
recurring in the three languages that fix missed (#976).

- Python: `class Dog(Animal, Serializable):` reported `signature: "class Dog"`;
  now `"class Dog(Animal, Serializable)"`. Also covers PEP 695 generics
  (`class Box[T](Base):` → `"class Box[T](Base)"`).
- PHP: `class Dog extends Animal implements Serializable {}` reported
  `"class Dog"`; now `"class Dog extends Animal implements Serializable"`.
- Go: `type Stack[T any] struct { items []T }` reported `"type Stack struct"`;
  now `"type Stack[T any] struct"`.

Six languages (C#, Java, Kotlin, Swift, JS/TS, Rust's impl/trait blocks)
already had this via their own `typeParamsAndX`-shaped helper, each
explicitly documented as "the <language> analog of C#'s
`typeParamsAndBaseList`" — the clearest possible signal the underlying rule
should be asserted once. A new cross-language test
(`type-declaration-signature.test.ts`) now asserts, for every language with
a type-level symbol extractor, that a declaration exercising whichever of
{generics, heritage} its grammar supports round-trips into `signature` —
so a future language can't silently reintroduce this gap.

Verified against real OSS source (not just synthetic snippets): Monolog's
`FilterHandler` (PHP, 3-interface `implements` clause), Requests' `Session`
(Python, mixin base class), and samber/lo's `switchCase[T comparable, R any]`
(Go, two-parameter generic struct) all now report their full signature.

Out of scope: Rust's `struct_item`/`enum_item` aren't symbol-extracted at
all yet (only `impl_item`/`trait_item`, via the differently-shaped
`extractImplInfo`) — a bigger gap tracked separately, not fixed here.
