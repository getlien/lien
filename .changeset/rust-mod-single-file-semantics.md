---
"@liendev/parser": patch
---

Fix `mod dir;` fabricating dependency edges to every file under `dir/`,
including files no `mod` statement declares, and fix a related fabricated
self-edge shape #1016/#1020 didn't catch (#1021).

Root cause: Rust doesn't set `LanguageDefinition.singleFileImports`, so a
`mod`-derived specifier fell through to `matchesFile`'s Go-package-directory
matching (`requireExactTailForMultiSegment: false`) — the same permissive
rule that correctly lets Go's `import "internal/fs"` match every file inside
that package. A Rust `mod x;` is not a package reference like that: it
resolves to exactly one of `x.rs` or `x/mod.rs`, never a grandchild, an
unrelated sibling, or the declaring file itself.

That one mismatch produced two symptom families:
1. **Fabricated descendant edges** — `mod thing;` in `src/main.rs` matched
   every file under `src/thing/` (`src/thing/sibling.rs`,
   `src/thing/undeclared.rs`, ...), not just the real `src/thing/mod.rs`.
2. **Fabricated self-edges**, in a shape #1020's exact-equality self-edge
   guard doesn't catch: a leaf file that owns a submodule subdirectory
   (`src/engine.rs`'s `mod helpers;` -> `src/engine/helpers`) fuzzy-matched
   back onto `src/engine.rs` itself, since `src/engine` is a boundary-prefix
   of `src/engine/helpers`. #1020's guard is exact-string equality at
   extraction time and this specifier is never exactly equal to the
   importer's own path, so it passed through untouched; the self-edge was
   created downstream, in matching.

Fix: `mod`-derived specifiers (`extractModImportPath` in `rust.ts`) are now
tagged with a reversible marker (`rust-mod-marker.ts`) and, when present,
`importMatchesTarget` routes them through a dedicated `matchesRustModSpecifier`
check — exact match, or the target being exactly the specifier plus `/mod`
(the sole `x.rs`/`x/mod.rs` alternative Rust's file-to-module convention
allows) — bypassing `matchesFile`'s generic boundary strategies entirely.
`use crate::...`/`self::`/`super::` specifiers are unaffected: they're
never marked, and keep resolving through the existing, unchanged logic
(needed because a `use` path is crate-root-relative, missing its real
`src/`-style prefix, and some `use` shapes carry a trailing symbol-name
segment in the raw specifier — both rely on the same leniency this fix
narrows for `mod` alone).

Also fixed a second, related bug the first fixture's own repro surfaced:
`mod x;`'s `processImportSymbols` used to report the wildcard marker
`symbols: ['*']` — the same shape a genuine `use crate::models::*;`
reports — so `findReExportedSymbolsForFile` treated a plain `pub mod
sibling;` namespace declaration as if it flattened `sibling`'s exports into
the declaring file, crediting every one of that file's own, unrelated `pub`
exports as "re-exported from sibling" and fabricating transitive
dependents through `mergeReExportTransitiveDependents`. A `mod` declaration
doesn't flatten anything (`sibling::declared_fn` is never reachable as
`mod::declared_fn`), so it now reports an empty symbols list instead.

Verified: both fixtures added as regression tests (confirmed failing on
main first). `lien-review-testbed/rust` and a fresh `dtolnay/anyhow` clone
are both unaffected — anyhow's `mod` declarations are all single-file
(no directory-module fan-out shape exists there), so its full
before/after dependent table is byte-for-byte identical, including the
pre-existing, unrelated `use`-based self-edges on `chain.rs`/`context.rs`/
`error.rs` (#1016's documented non-catch, left untouched). On a fresh
`serde-rs/serde` clone — which does have real multi-file directory modules
(`serde_derive/src/internals/`) — `serde_derive/src/lib.rs` was fabricated
as a dependent of 7 of the module's 9 submodule files before this fix, and
is correctly removed after, while the real edge to `internals/mod.rs` is
unchanged.
