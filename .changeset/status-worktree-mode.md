---
'@liendev/lien': minor
---

`lien status` now reports worktree-aware indexing status when run inside a linked git worktree: the resolved mode (overlay vs standalone, with the reason for a standalone fallback), the main checkout and base index location and whether it was found, the overlay index location and file count, and whether the `LIEN_WORKTREE_STANDALONE=1` escape hatch forced standalone. Output in a normal checkout is unchanged.
