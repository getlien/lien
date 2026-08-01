---
"@liendev/core": patch
---

Fix `get_dependents`/`get_complexity`/`get_files_context` falsely claiming a correctly-indexed file is "not found in the index" inside any linked worktree (#1014).

`findUnindexedPaths` (the check behind those tools' unindexed-path caveat) read `ManifestManager(vectorDB.dbPath).getIndexedFiles()`. For `OverlayBackend`, `dbPath` is the overlay's own directory, whose manifest tracks only the files that have actually been re-indexed into the overlay (added/modified since the worktree diverged from base) — not the much larger set served from the shared, read-only base index. Every base-only file (the common case: anything the current worktree hasn't touched) was therefore reported as unindexed, while the tool simultaneously returned correct, real data for it — a self-contradicting result that actively pointed agents away from trustworthy dependency/complexity data in the standard worktree workflow.

`VectorDBInterface` gains a `getIndexedFiles(): Promise<string[]>` method so each backend can answer "what do I consider indexed?" using its own knowledge of its storage shape:

- `SqliteBackend.getIndexedFiles()` behaves exactly as before (delegates to its own manifest).
- `OverlayBackend.getIndexedFiles()` returns the overlay's own manifest (added/modified files) unioned with the base's file list minus masked base paths — mirroring the exact `base (minus masked) ∪ overlay` shape overlay reads already use elsewhere in this class, so a file deleted in the current worktree (masked, no overlay replacement) is correctly still reported as unindexed rather than trading the false positive for a false negative.

`findUnindexedPaths` now calls `vectorDB.getIndexedFiles()` instead of constructing its own `ManifestManager`, so the fix lives once, behind the backend that owns the masking logic, rather than being reimplemented at each of the three call sites. The existing fail-open policy (a missing/unreadable manifest never produces a false "unindexed" claim or crashes a handler) is unchanged.

Regression coverage added in `packages/cli/src/mcp/utils/unindexed-paths.test.ts` builds a real base + overlay pair via `createVectorDB`/`indexCodebase` (not a mock of `findUnindexedPaths` or `ManifestManager`, which is why this class of bug went unnoticed by the existing handler tests) and asserts: a base-only file is not reported unindexed (the bug), an overlay-only file is not reported unindexed, a modified (masked-in-base, present-in-overlay) file is not reported unindexed, a file deleted in the worktree is still reported unindexed, and a genuinely nonexistent path is still reported unindexed.
