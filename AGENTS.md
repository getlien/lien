# Agent Instructions

Read [`CLAUDE.md`](./CLAUDE.md) first — it's this repo's full workflow contract, for
any agent, not just Claude Code. The non-negotiables it defines, restated
tool-agnostically for whichever coding agent you are:

1. **Before editing any file**, call Lien's `get_files_context` MCP tool
   (batch with `filepaths: [...]` for multi-file edits). Check
   `testAssociations`, `imports`, `callSites`, and `complexityHeadroomWarning`
   before you touch it.
2. **Before renaming, removing, or changing the signature of an exported
   symbol**, call `get_dependents`. A `riskLevel` of `high` or `critical`
   means list the affected dependents before proceeding.
3. **Before every commit**, run the full gate chain in CLAUDE.md's
   "Before EVERY Commit" section, including `lien delta` — treat any new
   complexity-threshold crossing as must-fix, not advisory.

This file exists because Lien tells its own users to do the same in their
repos (see [Cross-Editor Agent Setup](https://lien.dev/guide/cross-editor-setup));
we ship what we use.
