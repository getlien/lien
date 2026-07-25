---
"@liendev/parser": patch
---

Fix the #859 bug class (`extractImportPath` returning an unmatchable value
instead of a clean path) in three other languages found by auditing every
import extractor against it:

- **Java / Kotlin**: wildcard imports (`import com.example.*;` /
  `import a.b.*`) returned the raw `pkg.*`-suffixed string, which never
  satisfies `matchesPythonModule()`'s dotted-identifier check in
  path-matching.ts (an asterisk never matches `[A-Za-z_]\w*`) — so a wildcard
  import could never resolve to a test association or dependent for anything
  in that package. `extractImportPath` now strips the trailing `.*` and
  returns the clean package path, matching what `processImportSymbols`
  already computed separately.
- **PHP**: grouped `use` declarations (`use App\Models\{User, Post};`, PHP
  7+) returned `null` from both `extractImportPath` and `processImportSymbols`
  — tree-sitter-php parses this as a `namespace_name` prefix sibling plus a
  `namespace_use_group` of clauses, a shape the extractor didn't recognize at
  all, so the whole statement (every item in the group) was invisible to
  test-association discovery. Now captures the first item's full path,
  mirroring `GoImportExtractor`'s existing "first wins" precedent for its own
  multi-target grouped imports.
- **Rust**: `use crate::x;` / `use self::x;` / `use super::x;` (a single
  segment directly off a bare root, with tree-sitter-rust giving
  `crate`/`self`/`super` their own named node types) resolved a path via
  `extractImportPath` but returned `null` from `processImportSymbols`, since
  it converted the bare root's text alone (no `::` for the prefix-strip to
  match) instead of combining it with the imported name. Grouped bare-root
  imports with divergent per-item paths
  (`use crate::{auth::AuthService, config::Settings};`) returned `null`
  entirely for the same reason — now fixed with the same Go-style "first
  wins" mitigation as PHP.

Also adds regression-pinning import-extraction tests across every audited
language (TypeScript, JavaScript, PHP, Ruby, Rust, Go, Java, C#, Kotlin,
Swift) covering their main import forms, so this bug class can't silently
regress in any of them again. Two remaining structural gaps found by the
audit — Go's grouped-import "first wins" behavior only ever keeps one target
per `import (...)` block, and Java static member-imports / Kotlin top-level
function imports don't match their defining file — are filed as separate
issues (#863, #864) rather than fixed here, since both need a design call
beyond a mechanical extractor fix.
