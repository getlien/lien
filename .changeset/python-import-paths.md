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
a related latent bug in that shared logic where relative from-imports
(`from . import x`, `from .foo import x`) silently dropped their imported
symbols entirely, because the module-path lookup didn't account for the
`relative_import` wrapper node.
