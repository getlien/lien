# Agent Instructions

Read [`CLAUDE.md`](./CLAUDE.md) first — it's this repo's full workflow contract, for
any agent, not just Claude Code. The non-negotiables it defines, restated
tool-agnostically for whichever coding agent you are:

1. **Discovery is your own Read/Grep/Glob.** Lien no longer ships an MCP
   server, a persisted index, or lexical search, so there is no tool to call
   before editing a file. Earlier versions of this file mandated
   `get_files_context` and `get_dependents`; both tools and the store behind
   them are deleted.
2. **Before renaming, removing, or changing the signature of an exported
   symbol**, find its callers with Grep — and check whether the symbol is
   exported from `packages/parser`'s barrel (`packages/parser/src/index.ts`).
   That package is published, so a barrel symbol is semver-locked and removing
   it is a breaking change.
3. **Run `lien health`** on the area you're about to change if you want Lien's
   own read on what is risky to touch. It parses the working tree on demand;
   there is nothing to index first.
4. **Before every commit**, run the full gate chain in CLAUDE.md's
   "Before EVERY Commit" section, including `lien delta` — treat any new
   complexity-threshold crossing as must-fix, not advisory.

The whole surface is four commands: `lien complexity`, `lien health`,
`lien review`, `lien delta`. See
[CLI Commands](https://lien.dev/guide/cli-commands) for what each answers.
