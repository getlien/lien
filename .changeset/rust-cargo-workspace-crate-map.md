---
'@liendev/parser': patch
---

Fixes #903 (the third leg of #867, alongside PHP's PSR-4 map and Go's module
path): `convertRustModulePath` only recognized `crate::`/`self::`/`super::`
as internal-path prefixes, so any Cargo workspace member crate's `tests/`
integration tests — which Cargo always compiles as a SEPARATE crate, and
which therefore reference the crate under test by its published name (`use
tokio_util::codec::Framed;`) rather than `crate::` — were indistinguishable
from a genuinely external crates.io dependency and silently dropped. On
tokio-rs/tokio, this left 225/231 (97.4%) of the workspace's integration
test files with empty `imports`, blind to `get_files_context`'s
`testAssociations`, `verify-tests`/`recap`, and `annotate`'s test-coverage
line.

Adds `rust-crate-map.ts`, a manifest reader mirroring `php-psr4.ts`/
`go-module.ts`'s existing pattern: it parses a Cargo workspace root's
`Cargo.toml` `[workspace] members` (glob-expanded) plus each matched
member's own `[package] name` (and the root's own `[package]`, for a
single-crate project or a workspace root that's also a member crate) into a
`Map<crateName, crateSrcDir>`, normalizing hyphens to underscores to match
the identifier form Rust `use` paths actually use (`tokio-util` the package
vs. `tokio_util` the path). Unlike PHP/Go, this map is threaded straight
into `RustImportExtractor` (a new optional `rustCrateMap` parameter on
`extractImportPaths`/`processImportSymbols`, widening the
`LanguageImportExtractor` interface) rather than applied as post-extraction
string resolution in `ast/symbols.ts` — Rust's extractor has to decide
"internal vs. external crate" before it ever emits a specifier, which
happens before `resolveImportSpecifier`'s pipeline ever sees it. Only
workspace-member crates resolve; a genuinely external crate (`serde`,
`futures`, ...) is dropped exactly as before this fix, so single-crate
projects and true external dependencies see zero behavior change.

v1 scope (deliberately KISS/YAGNI, matching #867's PHP/Go precedent): only
`[workspace] members` and each matched member's `[package] name` are read.
Module-path resolution mirrors the existing `crate::` transform exactly
(`<crate>::<rest>` -> `<crateDir>/src/<rest>`), the same "first leg" the
issue's own suggested-fix section calls out as acceptable — full
`<mod>.rs`/`<mod>/mod.rs` file resolution is unchanged from the pre-existing
`crate::`-relative behavior. `[dependencies] path = "..."` entries and
workspace `exclude` are out of scope.
