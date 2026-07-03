---
'@liendev/parser': patch
'@liendev/lien': patch
---

Exclude `.claude/worktrees/**` from indexing by default. Claude Code agent
worktrees are full nested repo clones used as scratch space — indexing them
duplicates the entire project once per worktree (seen in production: ~30
worktrees produced a 21 GB index and pegged 8 CPU cores). This directory is
now added to `ALWAYS_IGNORE_PATTERNS`, the shared exclude list used by the
scanner, watcher, and gitignore filter, so it's never indexed regardless of
user configuration — the same treatment `node_modules/**` and `.lien/**`
already get.
