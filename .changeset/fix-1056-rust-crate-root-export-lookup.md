---
"@liendev/parser": patch
---

Fix Rust `get_dependents` fabricating an identical dependent list for every
file in a crate when consumed via `use crate_name::Symbol;` (a cross-crate
import naming only the crate + a symbol, no submodule path — the ordinary
shape for consuming what a crate's `lib.rs` re-exports). `resolveRustCrateImport`
resolved this to the crate's bare `src/` directory, which fabricated a match
against every file the crate contains via `matchesFile`'s Go-style package-
directory leniency. Measured on serde-rs/serde: `serde_derive/src/de.rs` and
`serde_derive/src/dummy.rs` — two unrelated files — both returned the
identical 144-file "dependent" list.

Adds `rust-crate-exports.ts`, a crate-root export lookup: reads the target
crate's own `lib.rs`/`main.rs` directly for (a) top-level `pub` items and
(b) `#[proc_macro_derive(Name)]` names (the exact serde/serde_derive shape),
and narrows the bare crate-root import to the ONE file that actually
declares the symbol. When the symbol can't be found there, emits nothing —
an honest gap, not a fabricated crate-wide match. The resolved specifier
reuses the existing #1021 mod-marker mechanism for exact-single-file
matching.

Verified against a real serde-rs/serde clone: `de.rs`/`dummy.rs` now
correctly show their one real dependent (`lib.rs`, via its own `mod de;`/
`mod dummy;`); `internals/ast.rs` shows a genuinely different, much smaller
list of real internal consumers (15, down from a fabricated 158); `lib.rs`
itself is unchanged (143 real consumers — the file that actually declares
`Deserialize`/`Serialize`). `dtolnay/anyhow` (single-crate, non-workspace)
went from 27 to ~32 edges — an increase, not a decrease: its own crate
directory is a single-segment `src`, which never hit the multi-segment
fabrication a workspace member's `<crate>/src` shape does, so its `tests/*.rs`
integration tests (`use anyhow::Error;`) simply resolve for the first time
instead of matching nothing. No regression to the other 10 corpora in the
E2E suite.
