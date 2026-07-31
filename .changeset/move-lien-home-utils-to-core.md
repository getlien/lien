---
"@liendev/parser": minor
"@liendev/core": minor
---

**Breaking:** `getLienHome`, `getIndexDir`, and `extractRepoId` have moved from
`@liendev/parser` to `@liendev/core`.

These three utilities resolve `~/.lien` (honoring `LIEN_HOME`), the per-repo
index directory (`<LIEN_HOME>/.lien/indices/<repoId>`), and the repo-id hash
respectively — none of them depend on anything about the source code being
analyzed, only on decisions Lien itself makes about where its own state
lives. `parser` is meant to be a pure function of the files in front of it
(parsing, chunking, complexity, dependency resolution); these three utilities
had nothing to do with that and had drifted into the wrong package. `core` —
storage, config, git, "where the database lives" — is where they belong.

Removed with no deprecation window (acceptable pre-1.0, per this repo's own
precedent for the `node-tree-sitter` legacy-backend removal): `parser` and
`core` are versioned in lockstep by changesets (`linked` in
`.changeset/config.json`) and consumed only inside this monorepo — no
external caller can ever see a `@liendev/core` or `@liendev/lien` published
without the matching `@liendev/parser` these three functions moved to. A
repo-wide sweep (including test files, `.github/`, `scripts/`, `plugins/`)
found zero consumers outside `packages/cli` and `packages/core` itself, and
zero consumers in `@liendev/review` or `@liendev/action` (both of which
depend only on `@liendev/parser`, not `@liendev/core`).

Import `getLienHome`, `getIndexDir`, and `extractRepoId` from `@liendev/core`
going forward.
