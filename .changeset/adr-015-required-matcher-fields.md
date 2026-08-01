---
"@liendev/parser": patch
---

Make `LanguageDefinition`'s three matcher-path fields (`wholeModuleImports`,
`singleFileImports`, `namespaceStyleImports`) required instead of optional,
per ADR-015 (#1038). Previously a language declaring nothing silently
inherited the shared matcher's permissive defaults — 7 of 11 languages
(TypeScript, JavaScript, Python, Rust, Go, Java, Kotlin) declared none of
these three fields, so nobody had ever had to state whether that permissive
default was correct-by-design or correct-by-accident for them. This is the
mechanism behind #1028: a leniency added for Swift/Go/Ruby silently applied
to Rust too, which had never opted into anything.

All 11 language definitions now declare all three fields explicitly,
verified against a real corpus per language (requests, zod, express,
monolog, anyhow, chi, javapoet, mediatr, sinatra, klaxon, swiftyjson) — see
each definition file's own citation. Only Swift (`wholeModuleImports`),
Ruby (`singleFileImports`), and PHP (`namespaceStyleImports`) are `true`;
every other cell is an explicit, evidence-backed `false`. This corrects one
factual error surfaced during verification: C# was previously believed to
already set `wholeModuleImports` (per issue #1038's own "current state"
table) — it does not, and never has; it only sets the separate,
out-of-scope `enclosingNamespaceAccess` flag. Rust's `singleFileImports`
stays `false` per #1021/#1024's own established reasoning (`mod`-derived
specifiers bypass these flags entirely via `rust-mod-marker.ts`).

Behavior-preserving by construction: every declared value matches the
language's current effective default, confirmed via full before/after
per-file dependency-edge dumps across all 11 corpora (byte-identical, modulo
one pre-existing, code-independent non-determinism in zod's re-export
transitive resolution — filed separately as #1044, unrelated to this
change). Adding a 12th language definition without declaring all three
fields is now a compile error. A new cross-language policy table asserts
these fields stay sparse and mutually exclusive per language, so future
additions don't quietly relocate the same drift.
