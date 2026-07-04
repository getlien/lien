---
'@liendev/core': patch
'@liendev/lien': patch
---

fix(core): make worktree overlay rebuilds reader-atomic and livelock-free

Two composing concurrency bugs in worktree overlay indexing (shipped in #667)
could make `list_functions` / `querySymbols` intermittently return 0 results for
a file that exists, while the overlay's `indexVersion` churned with zero file
edits when more than one `lien serve` had the worktree as cwd.

- **Reader atomicity.** `buildOverlay` no longer clears then repopulates the
  overlay across many autocommitted statements. It now does all scan/hash/chunk
  work up front, then applies the whole swap (delete + insert of chunks and
  mask, plus metadata) in ONE `BEGIN IMMEDIATE` transaction via
  `OverlayBackend.applyRebuild`, so other connections observe the rebuild
  all-or-nothing under WAL snapshot isolation — never a base file masked with no
  replacement rows. Disk reclamation moves to a best-effort post-commit
  `VACUUM` + WAL checkpoint (same file identity, preserving #667's multi-process
  safety fix). Union reads (`unionRecords`, `search`, `scanPaginated`) now read
  overlay rows + mask inside one deferred snapshot so a commit landing between
  the two statements can't be seen half-applied.

- **Rebuild livelock.** A rebuild that reproduces a byte-identical overlay
  (same diverged-file/hash set + mask) no longer bumps the version stamp — a
  cheap content signature, checked inside the swap transaction, makes redundant
  rebuilds silent. So piled-up serves stop mutually re-triggering reconnects and
  rebuilds; genuine content changes still bump. A `SQLITE_BUSY` busy-skip lets a
  peer's in-flight rebuild serve everyone rather than contending.
