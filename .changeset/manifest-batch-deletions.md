---
'@liendev/core': patch
'@liendev/lien': patch
---

Batch manifest deletions: removing K files now performs a single manifest read+write instead of one per file, matching the batched update path. Speeds up incremental indexing after branch switches and directory renames.
