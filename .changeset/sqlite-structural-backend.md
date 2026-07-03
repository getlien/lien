---
'@liendev/core': minor
'@liendev/lien': minor
---

Add an opt-in SQLite structural backend behind the existing vector-DB factory seam. Set `backend: sqlite` in the global config (`~/.lien/config.json`) or `LIEN_BACKEND=sqlite` to store chunks in a better-sqlite3 database with an FTS5 lexical index instead of LanceDB; the SqliteBackend implements the same `VectorDBInterface`, so no handler or indexer changes are needed. The default backend is unchanged (`lancedb`), so this release is purely additive.
