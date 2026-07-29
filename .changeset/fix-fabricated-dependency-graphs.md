---
"@liendev/parser": patch
"@liendev/lien": patch
---

#928: `get_dependents` fabricated dependency graphs via language-blind
bare-module matching — a confident wrong answer, not a degraded one, since
the tool exists specifically to catch "is this safe to change?" before an
edit.

Two independent shapes, found via the foreign-repo dogfood (#917):

- **Rust `self::`/`super::` collapsed to a directory-less string.**
  `RustImportExtractor` stripped these keywords down to a bare or merely
  `../`-prefixed specifier with no knowledge of the importer's real location,
  which `matchesFile`'s generic bare-identifier leniency (designed for the
  legitimate `crate::auth` -> `src/auth.rs` convention) then had to guess at
  match time — and could coincidentally match an unrelated same-named file
  elsewhere with a single leading directory. Reproduced on tokio-rs/tokio:
  `benches/copy.rs` (a leaf benchmark nothing can import) fuzzy-matched
  `tokio/src/fs/mod.rs`'s `self::copy` and
  `tokio/src/io/util/copy_bidirectional.rs`'s `super::copy`, fabricating 80
  dependents. Fixed by resolving `self::`/`super::` precisely against the
  importer's own file-to-module-aware location (`resolveRustRelativeModulePath`
  in `ast/languages/rust.ts`) instead of the old lossy string convention —
  this also makes real Rust cross-file dependency tracking MORE accurate
  (the 79 real callers of `tokio::fs::copy` are now correctly attributed to
  `tokio/src/fs/copy.rs`, not to the unrelated benchmark).
- **No existence check before the fuzzy search.** A nonexistent path that
  collides on a namespace/directory suffix with a real file silently
  inherited that file's entire graph — `src/Command/Command.php` (guessed,
  doesn't exist) returned the same 93 dependents as the real
  `Command/Command.php`, because `matchesFile`'s multi-segment boundary
  strategy has no cap on extra leading target directories (deliberately, to
  support e.g. PHP PSR-4 vendor prefixes) — there is no purely textual way to
  tell a real deep path from a fabricated one with the same suffix. Fixed by
  checking the target actually has chunks in the index before running the
  fuzzy search at all (`get_dependents`'s new `targetIndexed` result field);
  an unresolvable target now always comes back with zero dependents and an
  explicit `note`, never someone else's graph.

Also reconciles the reported `dependentCount`/`riskReasoning` mismatch (e.g.
`dependentCount: 80` next to `"14 callers"`): the reasoning already counted
production-only callers by design (test callers shouldn't weigh into risk
the same way), just without saying so — now labeled "N production callers"
explicitly.
