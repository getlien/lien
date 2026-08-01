---
"@liendev/parser": patch
---

Correct three doc-comment citations in `python.ts`, `rust.ts`, and
`path-matching.ts`, found by an independent verification pass after
ADR-015 (#1038, PR #1045) merged. All three are comment-only — no
declared `LanguageDefinition` value or matcher behavior changes:

- `python.ts`: `singleFileImports`'s comment wrongly claimed the flag was
  "inapplicable" for Python. It's load-bearing via relative imports
  (`from . import X` resolves to a bare multi-segment path) — confirmed
  by toggling the flag against the real matcher and watching a real edge
  (`src/requests/api.py`'s `from . import sessions`) stop resolving.
- `rust.ts`: `singleFileImports`'s comment wrongly claimed no
  multi-segment case exists in the `anyhow` corpus. `use self::common::*;`
  in `tests/test_downcast.rs` resolves to one, independently confirmed
  load-bearing.
- `path-matching.ts`: a pre-existing prose overstatement in `matchesFile`'s
  own doc comment (predates #1045) — only one of the three cited
  `dtolnay/anyhow` self-edge files matches the shape described.
