---
"@liendev/parser": patch
"@liendev/lien": patch
---

#869: a measure-gated spike recovering non-import test-association signal
for Swift/XCTest, where whole-module imports (`import Alamofire`) carry zero
per-file information (see the existing "not determinable" honesty label).

New deterministic, zero-LLM signal (`packages/parser/src/swift-symbol-usage-signals.ts`,
mirroring `stale-literal-signals.ts`'s template): a test chunk's own
`callSites` versus which single source file uniquely defines the referenced
symbol. Two gates keep this precise:

- A new, stricter `isMultiSegmentIdentifier` helper (>= 2 camelCase/
  underscore segments) — the shipped `isUnambiguousIdentifierShape` (docRefs'
  gate) passes every single Capitalized word trivially (`Get`, `Run`,
  `Session`, `Client`), so it's insufficient as a collision-resistance gate
  on its own. Both gates apply together; `isUnambiguousIdentifierShape`
  itself is untouched.
- `extension <ForeignType>` declarations are excluded from the definition
  side unless the type also has a real, non-extension declaration
  in-project — the one false-positive shape measured on Alamofire (a file
  merely extending a Foundation type like `HTTPURLResponse` otherwise looks
  like it "defines" that type to every test that references it).

Calibrated on Alamofire/Alamofire plus two additional real Swift repos of
different shapes; see the #869 PR for the full precision tables.

Surfaced as a DISTINCT third label tier in `lien annotate` — "inferred from
symbol usage", never merged into the confident import-based association —
mirroring #902's Go same-directory tier-2 discipline. Deliberately kept out
of `get_files_context`, `@liendev/review`'s gap detection, and
`verify-tests`'s ledger/scope-matching, same conservative call as that
precedent.
