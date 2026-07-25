---
"@liendev/parser": patch
"@liendev/lien": patch
---

Honesty-only fix for #869: for whole-module-import languages (Swift's
`import Alamofire` / `@testable import Alamofire` gives import-based
matching no per-file signal to work with — a structural gap, not a
matching bug), `lien annotate`'s test-coverage line no longer claims `No
test coverage.` on files that may in fact be heavily tested. It now reports
`Test coverage not determinable from imports (whole-module import).`
instead, for any language whose `LanguageDefinition.wholeModuleImports` flag
is set (only Swift today, checked via the new `hasWholeModuleImports()`
export). No heuristic recovery (no `Package.swift` parsing, no
name-proximity matching) — every other language's wording and behavior is
unchanged.
