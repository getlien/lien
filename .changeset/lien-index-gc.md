---
'@liendev/core': minor
'@liendev/lien': minor
---

feat(gc): garbage-collect stale and orphaned index directories

`~/.lien/indices` accumulated one directory per project root ever opened —
repos, worktrees, clones, scratch dirs — and nothing ever removed them. This
adds index garbage collection.

New `lien gc` command:

- **Orphan GC (default):** removes indices whose recorded source root no longer
  exists on disk. The core indexer now records `sourceRoot` in `manifest.json`
  at index time; legacy indices lacking it are reported as "unknown provenance"
  and removed only via `--stale`. Missing roots on an offline `/Volumes` mount
  (unplugged external drive) are skipped, not treated as orphans.
- **Legacy lance sweep (default):** removes dead `code_chunks.lance` directories
  left inside surviving index dirs after the LanceDB removal (#661).
- **`--stale [days]` (opt-in, default 60):** removes indices not accessed within
  N days, using a new `.lien-accessed` stamp touched on serve start.
- **`--dry-run`** previews every candidate with size and reason and deletes
  nothing; a summary (removed / freed / skipped) always prints. `--format json`
  is available for scripting.
- **Safety rails:** never deletes the current project's index, and skips any
  index a live process holds open (probed via a `BEGIN IMMEDIATE` busy-check on
  its `structural.db`). Deletions happen one directory at a time.

Auto-GC on serve start: after the MCP server is up, a background, non-blocking
pass runs orphan GC + the lance sweep (never stale GC), throttled machine-wide
to at most once per 24h via a stamp + atomic lock so piled-up serves don't
stampede. It logs a single line only when something was collected. Opt out with
`LIEN_AUTO_GC=off`.
