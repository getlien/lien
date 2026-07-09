---
'@liendev/core': minor
---

Collapsed per-project `.lien.config.json` (`LienConfig`) down to the one field any pipeline
actually reads: `complexity.thresholds` (consumed by `lien delta`).

Removed from the type, from validation, and from what `ConfigService` writes or expects:
`core`, `chunking` (`useAST`/`astFallback`), `mcp` (`port`/`transport`/`autoIndexOnFirstRun`),
`gitDetection` (`enabled`/`pollIntervalMs`), `fileWatching` (`enabled`/`debounceMs`), `storage`,
the deprecated `frameworks` array, `complexity.enabled`, and the entire legacy (pre-v0.3.0,
`indexing`-based) config shape. None of these were ever wired to real behavior — chunking is
always AST-based, the MCP server never loaded `.lien.config.json`, git polling and file watching
are governed internally (or by the CLI's `--watch`/`--no-watch` flag), and the storage backend is
a separate global-config concern. The legacy shape in particular had a latent bug: its settings
were silently discarded by the merge with no warning at all.

An existing `.lien.config.json` that still carries any of these keeps loading — `ConfigService`
now warns once per retired section (naming exactly what to delete) and strips it, the same
graceful-degradation pattern already used for retired storage backends, instead of throwing.

Also removed as part of the same cleanup, all dead:
- `ConfigService.save()` — nothing in the codebase ever called it; users hand-edit
  `.lien.config.json`, nothing writes it programmatically.
- `ConfigService.exists()` — its only caller was its own test; `lien init` checks for the file
  directly with `fs.access()` rather than going through `ConfigService`.
- `ConfigService.validatePartial()` and the `isModernConfig`/`isLegacyConfig`/`LegacyLienConfig`/
  `FrameworkConfig`/`FrameworkInstance` types — all zero-caller once the shape they existed to
  discriminate/describe was gone.
- `detectNewFields()` from `packages/core/src/config/merge.ts` — zero production callers.
- `IndexingOptions.config` (`packages/core/src/indexer/index.ts`) — accepted a pre-loaded
  `LienConfig` to "skip loading from disk," but nothing ever read `options.config`; no call site
  in the codebase (production or test) ever passed it either. The archetype of the
  accepted-but-never-read pattern this whole change is about.
- The dead `DEFAULT_DEBOUNCE_MS` constant, which only ever fed the now-removed
  `fileWatching.debounceMs` default (the actual file watcher has its own hardcoded batching
  window and never read it).
