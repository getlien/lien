---
'@liendev/core': patch
---

Removed the dead `indexing.concurrency`/`core.concurrency` config keys.

These keys were validated (range 1-16) in `ConfigService` but never read by
any indexing pipeline — `getIndexingConfig()` and every `pLimit` call site in
the full-index, incremental, and overlay pipelines were hardcoded to
`DEFAULT_CONCURRENCY` regardless of what a user configured. Rather than wire
them through, they're removed: nobody had ever configured them since setting
either had zero effect. An existing `.lien.config.json` that still carries
`core.concurrency` or the legacy `indexing.concurrency` now warns once and
ignores the key instead of failing validation. Parse-stage concurrency
continues to be governed internally by `PARSE_STAGE_MAX_CONCURRENCY` in
`@liendev/parser`.
