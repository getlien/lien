---
'@liendev/lien': patch
'@liendev/core': patch
---

Fixes #894: `lien annotate` (and every other read-side command that resolves
a project root without an explicit `--root`/`--path` — `gc`, `path`,
`store-paths`, `recap`, `nudge`, `verify-tests`) now prefers the nearest
ancestor directory that has actually completed a `lien index` build over the
nearest `.git`. Previously, a directory with no `.git` of its own — a
monorepo subdirectory indexed as its own project, or a repo nested inside a
larger checkout — would resolve past its own (real, populated) index to an
unrelated outer `.git` root that was never indexed, silently reporting
against the wrong store.

`resolveProjectRoot` (`packages/cli/src/cli/project-root.ts`) is the single
shared helper behind all of the commands above; the fix lives entirely in
its resolution algorithm, so every consumer gets it for free. `lien
index`/`init`/`serve` are deliberately unchanged — they take `process.cwd()`
(or an explicit override) as the root verbatim, which is how a repo-less
subdirectory gets indexed as its own project in the first place.

Additionally, `lien annotate` now warns loudly (one line, via stdout — the
read-hook pipes its stderr to `/dev/null`) instead of silently printing a
plausible-looking but empty annotation when the resolved root's index has
never been built, using the same `hasData()` signal the MCP server's
auto-index gate already relies on.

`@liendev/core` gains one new export, `VERSION_FILE` (the `.lien-index-version`
marker filename), so the CLI can check for a completed index synchronously
without pulling in `readVersionFile`'s async read/parse path.
