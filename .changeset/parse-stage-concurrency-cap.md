---
'@liendev/parser': patch
'@liendev/core': patch
---

Cap parse/chunk-stage concurrency at 4, independent of the configured indexing concurrency.

ADR-013 (prebuilt native parser) flagged a pre-GA memory risk: the native backend's transient JSON-serialized trees can be up to ~38x source size, and `indexing.concurrency`/`core.concurrency` accept up to 16 with no parse-stage file-size gate — 16 concurrent megabyte-scale parses measured ~1.55GB peak RSS, versus ~630MB at the default concurrency of 4.

`@liendev/parser` now exports `getParseStageConcurrency()`, which clamps any requested concurrency down to `PARSE_STAGE_MAX_CONCURRENCY` (4) for the CPU-bound parse/chunk stage specifically. I/O-bound stages (file stat/hash walks) are unaffected and keep using the configured value directly. Applied everywhere a limiter wraps `chunkFile`: `performChunkOnlyIndex` (parser), the full-index and incremental-index pipelines, and the worktree-overlay build (which previously shared one limiter across its I/O-bound hash-diff phase and its CPU-bound chunk phase -- now split into two). Parsing is synchronous on the JS thread, so this cap costs negligible wall-clock time; it only bounds how many source buffers and parsed trees are alive at once.
