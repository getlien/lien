---
'@liendev/core': minor
'@liendev/lien': minor
---

Add worktree-aware indexing: when Lien's root is a linked git worktree, it now shares the main checkout's index as a read-only base and stores only a small per-worktree overlay, instead of building a full independent index per worktree.

- **Detection** is state-based: a root is a linked worktree when `git rev-parse --git-dir` differs from `--git-common-dir`; the main checkout is located via `git worktree list --porcelain`.
- **Reads** union the writable overlay with the read-only base, suppressing base rows for files the worktree changed or deleted (a per-overlay mask). The base is opened `{ readonly: true }` and is never written by a worktree process.
- **The overlay** holds full chunk rows only for files whose current content differs from what the base indexed (diff via the parser content-hash vs the base manifest), plus new files. It is rebuilt automatically when the base is reindexed.
- **Fallbacks never error**: if the main checkout has no index, its index format is incompatible, or the base is otherwise unavailable, Lien uses a standalone index as before. Set `LIEN_WORKTREE_STANDALONE=1` to force standalone behavior.
- **FTS caveat**: BM25 scores from the base and overlay corpora are merged approximately (documented as a v1 limitation).

This eliminates the N× index duplication that produced a 21 GB index pile across ~30 agent worktrees of one repo.
