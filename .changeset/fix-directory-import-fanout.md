---
"@liendev/parser": patch
"@liendev/lien": patch
---

#953: `get_dependents` fabricated direct (`hops:1`) dependency edges for any
relative import that resolves to a bare DIRECTORY path instead of a real
file — a confident wrong answer, with no caveat, that fed straight into
`riskLevel`.

Confirmed via the foreign-repo dogfood on honojs/hono:
`src/middleware/jwt/index.ts`'s only outward-facing statement is
`import type {} from '../..'` (a dots-only, empty type import). This resolves
(correctly) to the bare directory `src`, but nothing then resolved `src` to
its real entry point (`src/index.ts`). Left as a bare directory name, the
specifier fuzzy-matched via `matchesFile`'s Python Strategy 5
(`matchesParentPythonPackage`) against EVERY file anywhere under `src/` — for
a TypeScript importer with no Python semantics at all. `get_dependents` for
`src/utils/color.ts` reported `dependentCount: 13` (true: 4), `riskLevel:
"high"` (true: `"medium"`); `src/utils/url.ts` reported 3 of its 12
production dependents as fabricated. This is the same false-hub shape #929
already diagnosed (Python's own doc comment names this exact hono repro) but
left unguarded on the two call sites that build `get_dependents`' actual
result (`findDependentChunks`'s fuzzy loop in both
`packages/parser/src/dependency-analyzer.ts` and
`packages/cli/src/mcp/handlers/dependency-analyzer.ts`), rather than the
guarded `importMatchesTarget` primitive #929 introduced.

Two-part fix:

- **Root cause: resolve a directory-shaped relative import to its real entry
  point.** A new `resolveJsDirectoryIndex` (`packages/parser/src/js-directory-index.ts`)
  checks whether a relative-resolved specifier names a real on-disk directory
  and, if so, redirects it to that directory's `index.<ext>` file (mirrors
  `workspace-packages.ts`'s entry-file detection, scoped to a single
  directory). `../..` now resolves to `src/index`, which participates in
  ordinary EXACT matching — no fuzzy strategy involved at all. This is what
  keeps `jwt/index.ts` et al. correctly attributed as `hops:1` dependents of
  `src/index.ts` (the file `../..` actually names) instead of just deleting
  the edge outright. Generalizes beyond the dots-only case: a named directory
  import (`../utils` where `src/utils/index.ts` exists) is fixed the same
  way.
- **Residual guard: gate Python Strategy 5 per chunk.** For the case where no
  entry file exists (so the directory-index resolution is a no-op), both
  `addFuzzyMatchChunks` implementations now re-derive the #929 guard per
  chunk — mirroring the existing #887 per-chunk pattern — so a non-Python
  importer's coincidental bare-word match can never count. Real Python
  bare-package matching (`import flask` -> `flask/__init__.py` and children)
  is untouched.

Verified the BFS depth mechanics needed no changes: once the seed (depth-1)
edges are correct, `depth: 2+` results clean up for free (checked live on the
hono corpus).

Also: `get_dependents`'s response echoed the *requested* `depth` even for a
symbol-scoped query, where `depth > 1` is documented as ignored (symbol
queries always run at depth 1). Now echoes the depth that actually ran.
