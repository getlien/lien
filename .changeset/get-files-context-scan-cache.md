---
'@liendev/core': patch
'@liendev/lien': patch
---

Speed up `get_files_context`'s test-association scan: it now calls `scanAll` (a direct column-projected `table.query()`) instead of an unfiltered `scanWithFilter`, which routed through a full-table zero-vector ANN search — roughly 10x slower on large indexes. Results are also cached per `indexVersion`, mirroring `get_dependents`' scan cache, so repeated calls in one session skip the full-table scan entirely until the index is rebuilt. `get_files_context` is the tool CLAUDE.md mandates before every file edit, so this is the hottest call in the daily agent loop.
