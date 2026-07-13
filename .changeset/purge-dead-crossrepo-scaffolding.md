---
'@liendev/parser': patch
'@liendev/core': patch
'@liendev/lien': patch
---

refactor: remove never-functional cross-repo scaffolding

Cross-repo MCP mode was never implemented in the SQLite era: `repoId` was
computed in-memory but never persisted to the structural store, both
backends hardcoded `supportsCrossRepo = false` with `scanCrossRepo()`
stubbed to `[]`, and `lien serve` is one-repo-per-process — making every
`crossRepo`/`repoIds` code path unreachable. Removes the always-false
`supportsCrossRepo` flag and `scanCrossRepo()` stub from both backends and
`VectorDBInterface`, the `crossRepo`/`repoIds` MCP tool parameters and their
`groupedByRepo` response fields, the `repoId` field on `ChunkMetadata` and
its plumbing through the chunkers, and the corresponding doc claims. No
behavior change for the single-repo path.
