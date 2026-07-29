---
"@liendev/parser": patch
"@liendev/lien": patch
---

#929: a direct-importing test file could be omitted from `lien annotate`'s
"Test coverage" line and from `get_files_context`'s `testAssociations`,
crowded out by unrelated files that matched only through a false hub.

Root cause: `matchesFile`'s Strategy 5 (`matchesPythonModule`) applies
Python's "a bare package import covers every file nested under it" semantic
unconditionally, regardless of the importer's actual language. A resolved
bare specifier from any other language can coincidentally look exactly like
a Python identifier -- confirmed on a real TypeScript repo (hono), where a
test's own package-root barrel import (`import { Hono } from '../..'`,
resolved to the bare specifier `src`) matched every single file under `src/`,
and on a real Go repo (gin), where an ordinary whole-package import
(`"github.com/gin-gonic/gin/binding"`, resolved to the bare `binding` after
module-prefix stripping) matched every file in that package directory. Both
shapes fabricated "this test covers everything" for files with no real
relationship to the target, sometimes displacing the file's own genuine
direct importer once the result list was truncated for display.

Fix: `matchesFile` gains an `allowPythonModuleMatching` parameter (default
`true`, preserving this function's own behavior for direct callers);
`importMatchesTarget` -- the shared choke point behind `get_dependents`,
`get_files_context`, and `lien annotate`'s test-association matching --
now derives it from the importer's actual language via the new
`hasPythonModuleSemantics`, mirroring the existing `hasSingleFileImportSemantics`
(#887) guard. Genuine Python bare-package matching is unaffected (verified:
zero result changes across a 25-file Python corpus sample).

Additionally, `collectImportMatchedTests`/`collectImportMatchedTestFiles` now
rank an exact, literal direct import ahead of any fuzzier match, so a real
direct importer can no longer sort behind other real matches and be
truncated out of the displayed list purely due to chunk-scan order. That
exact-match check applies the same #884 whole-module guard as the fuzzy
path, so a Swift bare `import Module` can't jump the queue into the exact
bucket just because the target file's basename happens to equal the module
name.
