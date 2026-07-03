---
'@liendev/lien': patch
'@liendev/core': patch
'@liendev/parser': patch
---

Honor the `LIEN_HOME` environment variable for Lien's global store (`~/.lien/indices/*`, `~/.lien/config.json`), via a new `getLienHome()` helper in `@liendev/parser`.

`LIEN_HOME` has been documented in the configuration guide ("Index location") since it was written, but nothing in the code ever read it — every store-path resolver (`VectorDB`, `loadGlobalConfig`/`saveGlobalConfig`/`mergeGlobalConfig`, `lien path --store`, `lien status`, `lien config`) called `os.homedir()` directly. This patch makes the documented override actually work, and falls back to `os.homedir()` when `LIEN_HOME` is unset, so behavior is unchanged for anyone not setting it.

This was discovered while fixing a test-hygiene bug: test suites across `packages/core` and `packages/cli` were writing real indices into `~/.lien/indices/` on every run and never cleaning them up (thousands of leaked `test-*`/`lien-test-*`/`lien-bench-*` directories accumulate over time). Tests now set `LIEN_HOME` to a per-run temp directory via a new vitest `globalSetup` in both packages, so all index/config I/O during a test run is isolated and removed automatically in teardown — no more manual per-suite cleanup needed.
