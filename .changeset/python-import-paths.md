---
"@liendev/parser": patch
---

Fix Python test-association discovery being silently broken for every import
form: `PythonImportExtractor.extractImportPath()` was returning the raw,
unparsed statement text (e.g. `"from starlette.responses import FileResponse, ..."`)
instead of a clean dotted module path, so `chunk.metadata.imports` never
contained anything `matchesPythonModule()` could match. It now returns the
clean module path (e.g. `"starlette.responses"`, `"os"`, `".foo"` for
relative imports) by delegating to the same symbol-processing logic already
used to build `importedSymbols` — the two can no longer disagree. Also fixes
two related latent bugs in that shared logic: relative from-imports
(`from . import x`, `from .foo import x`) silently dropped their imported
symbols entirely, because the module-path lookup didn't account for the
`relative_import` wrapper node; and wildcard from-imports (`from x.y import
*`) were dropped in their entirety (module path included), because the
symbol collector didn't recognize `wildcard_import` nodes and treated the
resulting empty symbol list as "no import here" — it now records a `'*'`
placeholder symbol, mirroring `RustImportExtractor`'s existing convention for
`use crate::models::*;`.
