---
"@liendev/parser": patch
---

Fix Rust `mod X;` declarations producing no import edge (#1000).

`RustImportExtractor.importNodeTypes` only listed `use_declaration` —
`mod_item` was absent, so the idiomatic Rust pattern of `mod x;` at the
crate root plus qualified calls (`x::func()`) with no `use` at all produced
zero import edges. `get_dependents` on the child module returned a
confident, wrong `[]` (or an undercount when the file also happened to gain
one edge via an unrelated `use crate::x` elsewhere).

A `mod x;` declaration is resolved to a directory-anchored, extensionless
module path (e.g. `src/reporter` for `src/main.rs`'s `mod reporter;`,
honoring the leaf-file 2018+-edition directory-split convention, inline-mod
nesting, and a `#[path = "..."]` override) rather than emitted as an
unanchored bare specifier for downstream fuzzy bare-module matching to
guess at. The extractor itself doesn't choose between the `x.rs` and
`x/mod.rs` on-disk conventions — it leaves the specifier extensionless, and
downstream matching (which already normalizes every candidate file path by
stripping extensions) resolves it to whichever one is actually on disk. The
unanchored-bare-specifier shape is exactly what #928/#884's
`isUnresolvableWholeModuleImport` guard exists to reject, so resolving to a
directory-anchored path up front avoids reintroducing that fabrication bug.
An inline `mod x { ... }` (has a body, e.g. `#[cfg(test)] mod tests { ... }`)
is a namespace, not an import, and correctly produces no edge for itself;
`collectImportNodes` now recurses into such a body so any `use`/nested `mod`
declared inside it is still discovered.

Verified on the tracked `lien-review-testbed/rust` fixture (reporter.rs
0 -> 1 dependent, formatter.rs and parser.rs each gain the previously-missing
`main.rs` edge, the other 5 files unchanged) and on the real `dtolnay/anyhow`
crate (all 10 of `lib.rs`'s `mod` declarations now produce edges; the two
real inline modules in that crate, `context.rs`'s `mod ext` and `fmt.rs`'s
`mod tests`, correctly produce none).
