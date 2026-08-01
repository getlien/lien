---
"@liendev/parser": patch
---

Fix a regression from #1008: Cargo integration-test/bench/example/binary
files fabricated a `mod` self-edge (#1016).

#1008 taught `mod x;` to resolve to a directory-anchored sibling path, but
`isRustModuleRootFile` only recognized `mod.rs`/`lib.rs`/`main.rs` as
"module-root" files that own their own directory. Every other Cargo
crate-root convention — `tests/*.rs` (each an independent integration-test
binary), `benches/*.rs`, `examples/*.rs`, and `src/bin/*.rs` — fell through
to the "leaf file owns a subdirectory named after itself" branch instead.
So `tests/test_context.rs`'s `mod drop;` resolved to the phantom path
`tests/test_context/drop`, which then fuzzy-matched back onto
`tests/test_context.rs` itself at a path boundary, fabricating a
self-edge — inflating that file's own dependent count and blast-radius
risk with a dependency on itself.

`isRustModuleRootFile` now also recognizes a `.rs` file directly under a
top-level `tests/`, `benches/`, or `examples/` directory, and a `.rs` file
directly under `src/bin/`, as owning its own directory the same way
`lib.rs`/`main.rs` do. A file nested one level deeper (`tests/foo/bar.rs`)
is unaffected — it's a module within that directory's own crate root, not
a fresh crate root itself.

Independently, `extractModImportPath` now rejects a resolved specifier
that is *exactly* the declaring file's own (extensionless) path — a self-edge,
which is never a real dependency regardless of which convention produced
it. This is deliberately exact-equality, not fuzzy path-boundary matching:
the ordinary leaf-file convention (`src/foo.rs`'s `mod bar;` -> `src/foo/bar`)
always produces a specifier that is a superstring of the leaf file's own
path at a boundary, which is correct, not a self-edge — a fuzzy guard would
misfire on every leaf-file submodule. The guard is scoped to `mod`
resolution only: a bare `use crate::x` path resolving back onto its own
file is a distinct, pre-existing issue (fuzzy bare-word matching, not `mod`
resolution) left untouched here.

Verified on a fresh `dtolnay/anyhow` clone: the 5 fabricated self-edges
(`tests/test_context.rs`, `tests/test_convert.rs`, `tests/test_downcast.rs`,
`tests/test_macros.rs`, `tests/test_repr.rs`) are gone, and the real edge
now appears (`tests/drop/mod.rs` gains `tests/test_context.rs` as a
dependent, via its now-correctly-resolved `mod drop;`). The 3 pre-existing
`use crate::`-based self-edges (`src/chain.rs`, `src/context.rs`,
`src/error.rs`) are unaffected, as expected — they come from a different
code path. `lib.rs`'s 11 top-level `mod` declarations still all produce
edges, and `lien-review-testbed/rust`'s `reporter.rs`/`formatter.rs`/
`parser.rs` dependents (#1008's original fix) are unchanged.
