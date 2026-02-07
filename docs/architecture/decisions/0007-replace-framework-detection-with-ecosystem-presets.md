# ADR-007: Replace Framework Detection with Ecosystem Presets

**Status**: Accepted
**Date**: 2026-02-07
**Deciders**: Core Team
**Related**: None

## Context and Problem Statement

The framework detection system (`packages/core/src/frameworks/`, ~3,000 LOC across 16 files) was over-engineered for its actual purpose: generating include/exclude glob patterns for the file scanner.

It included 5 detectors (Node.js, Laravel, PHP, Python, Shopify) with confidence levels (`high`, `medium`, `low`), priority-based conflict resolution, recursive monorepo scanning, and a registry/plugin system — all to decide which files to scan. In practice:

- The `init` command already didn't use framework detection.
- The config default was `frameworks: []`.
- The only real consumers were `scanFilesToIndex()` and the file watcher's `getWatchPatterns()`.
- The confidence/priority system was never meaningfully exercised (most projects match a single ecosystem).

The complexity was disproportionate to the value delivered.

## Decision Drivers

* **KISS** — The framework system violated the project's core principle of simplicity
* **Maintenance burden** — 16 files and ~3,000 LOC for glorified pattern matching
* **Fragile integration tests** — 4 integration test files tested framework conflict resolution scenarios that rarely occur in practice
* **Over-abstraction** — Confidence levels, priority resolution, and plugin registries for what is fundamentally "check if `package.json` exists"

## Considered Options

### Option 1: Keep framework detection, simplify it

Reduce the framework system to fewer files while keeping the detector interface. This preserves extensibility but still carries unnecessary abstraction.

### Option 2: Replace with ecosystem presets (chosen)

Replace the entire system with a single ~100 LOC module that:
1. Checks for marker files (`package.json`, `requirements.txt`, `composer.json`, `artisan`)
2. Returns exclude patterns for matched ecosystems

No confidence levels, no priority resolution, no plugin registry.

### Option 3: Remove framework detection entirely

Use only universal include patterns with no ecosystem-specific excludes. This would work but would scan unnecessary files (e.g., `venv/`, `__pycache__/`, `.next/`) in ecosystem-specific projects.

## Decision Outcome

In the context of simplifying the file scanning pipeline, facing the problem that the framework detection system was ~30x more code than necessary, we decided for replacing it with ecosystem presets to achieve equivalent functionality in ~100 LOC, accepting the loss of the plugin/detector extensibility model.

The new module (`packages/core/src/indexer/ecosystem-presets.ts`) exports:

- `ECOSYSTEM_PRESETS` — Static array of `{ name, markerFiles, excludePatterns }`
- `detectEcosystems(rootDir)` — Checks for marker files at root and immediate subdirectories (depth 1), returns matched names
- `getEcosystemExcludePatterns(names)` — Merges exclude patterns (deduplicated)

Presets: `nodejs`, `python`, `php`, `laravel`.

## Consequences

### Positive

- **~2,800 LOC net reduction** (~3,000 removed, ~200 added)
- **16 files removed** — entire `packages/core/src/frameworks/` directory deleted
- **4 integration test files removed** — framework-priority, monorepo-framework, shopify-hybrid-theme, laravel-frontend
- **Simpler mental model** — "check marker file, add excludes" vs. "detect with confidence, resolve conflicts, generate config, scan per-framework"
- **Faster scanning** — No async detector chain; just `fs.access()` checks
- **Easier to add ecosystems** — Add an object literal to an array vs. implementing a `FrameworkDetector` interface

### Negative

- **No per-framework include patterns** — The old system could specify different include patterns per framework (e.g., `**/*.php` for Laravel). The new system uses universal include patterns for all ecosystems, covering all supported extensions including `.liquid`.
- **Shallower monorepo scanning** — The old system recursively scanned for framework markers at any depth. The new system checks root + immediate subdirectories (depth 1), which covers the common monorepo layout (e.g., `backend/composer.json`, `ml-service/requirements.txt`) but not deeply nested markers. Per-framework path isolation (scanning different sections with different include patterns) is no longer supported; all code is scanned with universal include patterns.
- **Shopify detector removed** — The Shopify-specific detector is not replicated as an ecosystem preset. `.liquid` files are still indexed via the universal include glob (`**/*.liquid`). Shopify JSON templates (`templates/**/*.json`) are not included — general JSON indexing is out of scope.

### Neutral

- `FrameworkConfig` and `FrameworkInstance` types remain in `config/schema.ts` (marked `@deprecated`) for backward compatibility with existing config files
- `frameworks` field on `LienConfig` is now optional — old configs with `frameworks: [...]` load without errors (silently ignored)
- `isModernConfig()` type guard changed from `'frameworks' in config` to `'core' in config`

## Validation

- `npm run typecheck` — zero errors
- `npm run build` — compiles successfully
- `npm test -w @liendev/core` — 728 tests pass (40 qdrant failures are pre-existing, require running server)
- Watcher tests (24) — all pass with updated ecosystem mocks
- Dogfooded on lien repo: 234 files scanned, 218 indexed, zero excluded-file leaks
- Dogfooded ecosystem detection on Node.js, Python, PHP, Laravel, and mixed projects
