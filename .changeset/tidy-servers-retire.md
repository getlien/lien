---
'@liendev/lien': minor
'@liendev/core': minor
---

**Removes the MCP server, the persisted index, and lexical search.** This is the breaking change of the simplification arc. It is kept at `minor` because these packages are pre-1.0 and a series of removals is in progress; on a 1.0 line it would be `major`. Read it as breaking regardless.

`lien` is now a local CLI that parses the working tree on demand. The entire command surface is four commands:

| Command | Answers |
|---|---|
| `lien health` | Which functions are risky to change? (complexity × fan-in ÷ test coverage) |
| `lien delta` | Did this change push a function over a threshold it was under before? |
| `lien review` | What deterministic signals fire on this diff? |
| `lien complexity` | Where is the tech debt? |

**Gone from `@liendev/lien`:** the MCP server and its six tools (`search_code`, `find_similar`, `get_files_context`, `list_functions`, `get_dependents`, `get_complexity`), plus `lien serve`, `lien index`, `lien status`, `lien gc`, `lien path`, `lien annotate`, `lien api-delta`, `lien stats`, `lien recap`, `lien verify-tests` and `lien config`. **An editor configured against `lien serve` will fail to start it.** There is no replacement for that integration — the questions Lien still answers are answered by running a command, not by an agent calling a tool.

**Gone from `@liendev/core`:** `createVectorDB`, `OverlayBackend`, `VectorDBInterface`, `SearchResult`, `indexCodebase`, `buildOverlay`, `ManifestManager`, `ComplexityAnalyzer`, the whole `gc/` surface (`planGc`, `runGc`, `getIndicesRoot`, …), `getIndexDir`, `loadGlobalConfig`/`saveGlobalConfig`/`GlobalConfig`, and the version-file helpers. What remains is per-project config (`configService`, reading `complexity.thresholds` from `.lien.config.json`), git state and linked-worktree detection, typed errors, report formatters, and small shared utilities. Anything analytical now lives in `@liendev/parser`, which is unchanged.

**Dependencies dropped:** `@modelcontextprotocol/sdk`, `chokidar` and `zod-to-json-schema` from the CLI; `better-sqlite3`, `@types/better-sqlite3` and `p-limit` from core. `better-sqlite3` was the last native module outside the parser, so **`@liendev/core` no longer needs a compile step to install**.

**Also removed: the nudge/recap/stats/verify-tests telemetry.** This was scheduled for a later release, but deferring it would have shipped a lie. `lien verify-tests` recorded "you edited this file, here are its tests, did you run them" — and the association lookup read the index. Without it, the ledger records an empty test list, and `lien recap` reports no unresolved risk because nothing can record any. A command that reports "nothing to worry about" when it means "I cannot see anything" is the exact failure this project has a written rule against, so the family goes with the capability it depended on.

**One capability is genuinely lost and has no replacement:** nothing maps a changed file to its tests any more. That was index-backed. Find them with your editor's search.

Removing a persisted index also removes a class of bug that came with it: an index that disagrees with disk, a stale answer that looks fresh, and the whole four-state honesty apparatus built to detect that. Every answer is now computed from the files as they are when you ask.
