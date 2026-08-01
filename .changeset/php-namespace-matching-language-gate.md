---
"@liendev/parser": patch
---

Fix `matchesFile`'s Strategy 4 (`matchesPHPNamespace`) — a case-insensitive,
directory-mirroring namespace matcher intended for PHP's PSR-4 convention —
being applied unconditionally to every language, fabricating false
dependency edges wherever an unrelated bare/qualified specifier
case-insensitively collided with a target's basename within one leading
directory segment (#1028).

Root cause: `matchesPHPNamespace`'s bare-single-component leniency (added by
#883 for an unrelated Swift/Go/Ruby fix) is case-insensitive, unlike
Strategy 2's equivalent (case-sensitive) one-leading-segment convention —
but it ran for every language, not just PHP. Confirmed live on
`dtolnay/anyhow`: `src/error.rs`'s own `use crate::{Error, StdError};`
extracts to the bare, first-wins specifier `"Error"`, which
case-insensitively self-matched `src/error.rs` — the same mechanism made
`src/chain.rs` and `src/context.rs` their own dependents too, via their own
self-referential `pub(crate) use crate::{Self};` re-exports. This was not a
self-edge-only bug: the identical leniency also fabricated edges between
completely different files whenever a bare specifier and a target's
basename coincided case-insensitively — confirmed on real `expressjs/express`
(`require('router')`, an external npm package, wrongly matched the
project's own `test/Router.js`) and `go-chi/chi` (a package-qualified
`middleware` import wrongly singled out `middleware/middleware.go` for
edges its sibling files in the same package correctly never received).

Fix: added `LanguageDefinition.namespaceStyleImports` (set only for PHP) and
threaded a new `allowNamespaceMatching` parameter through `matchesFile`,
mirroring the established per-language-gate pattern `singleFileImports`
(#887) and the Python-bare-module guard (#929) already use.
`importMatchesTarget` derives it from the importer's language via the new
`hasNamespaceMatchingSemantics`, so PHP keeps Strategy 4 exactly as before
and every other language now skips it entirely. `matchesFile` itself
defaults the new parameter to `true`, preserving its own pre-#1028 behavior
for direct/raw callers (mirroring `allowPythonModuleMatching`'s own
precedent) — the real fix lives at the `importMatchesTarget` layer, the one
place a language is actually known.

Verified: `dtolnay/anyhow`'s full before/after dependent table is
byte-for-byte identical except for the three self-edges and five related
cross-file false positives (all case-insensitivity-dependent) disappearing;
a deeper-nested control fixture (`src/deep/nested/error.rs`) and #883's own
Go/Ruby/Swift regression cases are unchanged. Swept the whole real-project
corpus (requests, zod, express, monolog, anyhow, chi, javapoet, mediatr,
sinatra, klaxon, swiftyjson): `monolog` (PHP) is byte-for-byte identical
before/after; `requests`/`zod`/`mediatr`/`sinatra`/`javapoet`/`klaxon`/
`swiftyjson` are unaffected; `express` and `chi` each lose a small number of
confirmed false-positive edges (detailed above), `anyhow` loses its three
self-edges plus five related false positives. Two new regression fixtures
(self-edge and different-files false-positive shapes) confirmed failing on
main before this fix.
