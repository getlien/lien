---
"@liendev/parser": patch
"@liendev/lien": patch
---

Fix `get_dependents({ filepath, symbol })` reporting `dependentCount: 0` /
`riskLevel: "low"` for methods, constructors, and package-qualified
functions that have real callers (e.g. Go's `bytesconv.StringToBytes`, PHP's
`Cursor::__construct`). CLAUDE.md marks this exact call **REQUIRED** before
any signature change, so the false zero was a confident "safe to edit"
verdict on code with many callers.

Two independent causes, both fixed:

- No language's import statement names a class member or (for Go) a
  package's individual function independently of the class/package itself
  (`use Ns\Cursor;` records `Cursor`, never `__construct`; `import
  "app/bytesconv"` records `bytesconv`, never `StringToBytes`). Once a
  chunk is confirmed to import from the target path at all, `get_dependents`
  now also accepts a real call site named `symbol` in that same chunk as
  evidence. When neither a named import nor a call site can confirm usage
  and `symbol` isn't a top-level export (the structural shape of a
  method/constructor query), the response degrades to the file-level answer
  instead of asserting an unverifiable symbol-scoped zero, and sets
  `symbolAttributionDegraded: true` plus a `symbolAttributionNote` so
  callers can tell a floor from a verified count.
- Go's grouped `import (...)` blocks only ever recorded the first non-stdlib
  spec's symbols, silently dropping every import after it in the same
  declaration from `chunk.metadata.importedSymbols` (confirmed on real gin
  source: `render/json.go` groups `codec/json` and `internal/bytesconv`
  together; only `codec/json` was ever recorded). `processImportSymbols`
  callers now go through a new `processImportSymbolsList`, mirroring the
  existing `extractImportPaths`/`toImportPathsArray` pattern for the plural
  case.

Verifying the PHP case against a real symfony/console checkout also
surfaced a PSR-4 empty-root resolution bug that made `get_dependents`
return false zeros even for plain class-name and file-level queries there —
independently found and fixed by #926, since merged.
