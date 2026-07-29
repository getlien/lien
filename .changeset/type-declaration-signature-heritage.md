---
"@liendev/parser": patch
"@liendev/lien": patch
---

`signature` for a class/interface/struct/record/enum (and Rust's
impl/trait) dropped generic type parameters and the base-type/interface
list entirely — found in a post-release audit of the published 0.72.0
artifact. `list_functions` on serilog reported `LogEventPropertyValueVisitor<TState,
TResult>` as bare `class LogEventPropertyValueVisitor` and `Logger :
ILogger, ILogEventSink, IDisposable` as bare `class Logger`, discarding
exactly the information a model needs to tell one symbol from another and
to judge blast radius before changing it (`signature` is what
`list_functions`/`get_dependents` show, not the source).

Confirmed the same gap and fixed it in six languages: **C#**
(`class`/`interface`/`struct`/`record`, including `record struct`, plus
`enum`'s base type, e.g. `enum Status : byte`), **Java**
(`class`/`interface`/`enum`/`record`), **Kotlin**
(`class`/`interface`/`object`), **TypeScript** (`class`/`interface`, plus
plain JavaScript's `extends` clause, which shares the same code path),
**Swift** (`class`/`struct`/`actor`/`enum`/`extension`/`protocol`), and
**Rust** (`impl`/`trait` — an `impl` block's `signature` now names the
trait it implements, e.g. `impl<T> Trait for Type<T>`, previously just
`impl Type`, silently losing the single most useful fact about an impl
block). Generic constraints (`where T : class, new()` / Rust's
`where`-clauses) are deliberately excluded, not truncated — out of scope,
since a "some constraints, some not" signature would be worse than none.

Also fixed as a direct consequence, found via dogfooding against Serilog's
actual `Logger` class: a base/heritage list that itself spans multiple
physical lines (e.g. a base wrapped in a C# `#if`/`#endif` preprocessor
block) previously leaked raw newlines into `signature`; all six languages
now collapse it to a single line via a new shared `collapseWhitespace`
helper, matching the existing `extractSignature` convention.

Checked but left unchanged (already correct, not touched): Ruby's `class …
< Base` already includes its superclass. Checked and found to share the
same gap but out of scope for this fix (no generics/heritage list in the
task's brief, left as a follow-up): PHP and Python's `class` declarations,
and Go's generic `type Foo[T any] struct`.
