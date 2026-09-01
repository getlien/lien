---
'@liendev/lien': minor
'@liendev/parser': minor
---

**`@liendev/core` is no longer published.** What the CLI still used from it now
lives inside the CLI; the rest is deleted.

`@liendev/core` began as the indexing and analysis engine. Everything that made
it an engine — the SQLite structural store, the indexer, index GC, FTS5 lexical
search, embeddings — was removed along with the MCP server. What was left was
2,102 lines of support code, of which the CLI reached exactly three modules:

| Module | Where it went |
|---|---|
| `config/` (`.lien.config.json` thresholds) | `packages/cli/src/config/` |
| `errors/` (typed errors, `isLienError`) | `packages/cli/src/errors/` |
| `insights/formatters/` (text/JSON/SARIF) | `packages/cli/src/insights/formatters/` |

The rest was unreachable and is gone — 1,068 of those 2,102 lines, across 15 of
24 files: `git/` (`GitStateTracker`, `detectLinkedWorktree`, git helpers),
`types/`, `constants.ts`, all six `utils/` modules, and the `src/test/`
helpers. These were not arbitrary casualties —
each existed to serve the index. `GitStateTracker` recorded the commit an index
was built at so it could be invalidated; `detectLinkedWorktree`, `getLienHome`
and `extractRepoId` located the right index directory for the current worktree.
With no index, none of them has a caller. `lien delta` and `lien review` do
their own git work in `cli/delta-git.ts`, and the project root is resolved from
the `.git` marker alone — which is correct inside a linked worktree too, where
`.git` is a file rather than a directory.

**If you depend on `@liendev/core` directly:** version 0.79.0 stays on npm and
keeps working, but it will not be published again. Everything analytical —
chunking, complexity, dependency resolution, review signals — is in
`@liendev/parser`, which is unchanged and remains published. The config, error
and formatter modules were always CLI-internal support rather than a library
API, and they are now internal in fact as well as intent.

Also in this release:

- **A latent broken import, surfaced by the move.** The three formatter test
  files imported `ComplexityReport` from `../types.js` — a module deleted back
  in #278. It never failed: core's `tsconfig.json` excluded `**/*.test.ts`, and
  `import type` is erased before it can fail at runtime. The CLI's tsconfig
  includes its tests, so the move turned it into a hard error. Now imported
  from `@liendev/parser`, which owns the type.

- **The post-publish registry smoke test no longer probes a package that isn't
  installed.** `.github/scripts/registry-smoke.sh` imported both
  `@liendev/core` and `@liendev/parser` from a fresh install to catch
  resolution skew. With core gone from the CLI's dependencies that import
  would fail on every release — and this script runs *after* an immutable
  publish, so it would have reported a broken release that was fine. It now
  probes parser, the only published sibling the CLI resolves.

- **Two stale workspace entries pruned from `package-lock.json`** —
  `packages/core` and `packages/embeddings`, the latter dead since embeddings
  were removed. `npm install --package-lock-only` marks a deleted workspace
  `extraneous` but never prunes it, so these accumulate silently.

- **Index-era dead code that rode along inside the moved modules is gone too.**
  Deleting at module granularity meant three modules moved wholesale, dead
  symbols included: `IndexingError` and `DatabaseError` (defined, never
  constructed — the latter names a database deleted two phases ago), the
  `INDEX_NOT_FOUND`/`INDEX_CORRUPTED` error codes, and the barrel's
  `formatTextReport`/`formatJsonReport`/`formatSarifReport` re-exports, which
  existed to feed core's public API. Nothing outside `src/insights/formatters/`
  imported them; `formatReport` is the entry point.

- `@liendev/parser` gains no code changes. Its docblocks described themselves
  in terms of core (`scanFilesToIndex`, "parser must NOT import
  `@liendev/core`", a doc-matching primitive shared with two call sites that
  are both deleted). Those now describe what is actually there.
