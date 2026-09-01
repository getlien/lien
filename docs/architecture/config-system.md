# Configuration System

> [!IMPORTANT]
> **Phase 5 (2026-09-01) deleted `GlobalConfig`, `~/.lien/config.json`, and the
> `lien config` CLI entirely**, along with the storage backend they configured
> (there is no storage backend any more — see the phase 5 banner in
> [docs/architecture/README.md](README.md)). Per-project configuration below
> (`ConfigService` / `.lien.config.json`) is unaffected and is now Lien's
> only configuration layer.

Lien's only configuration layer is **per-project** (`LienConfig`, via `ConfigService`): it lives in `.lien.config.json` in the project root. The only field any pipeline reads is `complexity.thresholds`, consumed by `lien delta` (`packages/cli/src/cli/delta-cmd.ts`).

The framework-based project-type detection described in earlier versions of this system has been replaced by ecosystem presets (see [ADR-007](decisions/0007-replace-framework-detection-with-ecosystem-presets.md)).

## Per-project configuration (ConfigService)

`.lien.config.json` in the project root supports exactly one field:

```typescript
interface LienConfig {
  complexity?: {
    thresholds: {
      testPaths: number; // Max test paths per function (cyclomatic), default 15
      mentalLoad: number; // Max mental load score (cognitive), default 15
      timeToUnderstandMinutes?: number; // default 60
      estimatedBugs?: number; // default 1.5
    };
  };
}
```

`ConfigService.load(rootDir)` merges whatever `complexity.thresholds` a project supplies over these defaults and returns the result; everything else in the file is ignored. `lien delta` is the only consumer: it reads `config.complexity?.thresholds` to decide what counts as a new complexity regression.

### Why so small

Earlier versions of `LienConfig` also had `core`, `chunking`, `mcp`, `gitDetection`, `fileWatching`, `storage`, and a deprecated `frameworks` array, plus an entirely separate legacy (`indexing`-based) shape. All of it was validated on load but never actually wired to runtime behavior:

- Chunking is always AST-based with an internal line-based fallback (`chunking.useAST`/`astFallback` were dead).
- The MCP server never loads `.lien.config.json` at all (`mcp.*` was dead; auto-indexing is gated by `hasData()` + `LIEN_FORCE_INDEX`, not `mcp.autoIndexOnFirstRun`).
- Git-change polling and file watching are governed internally / by the `--watch`/`--no-watch` CLI flag, not config (`gitDetection.*`, `fileWatching.*` were dead).
- `storage.backend` was dead per-project config even while `GlobalConfig.backend` (the actual, global storage-backend setting) was live; both the per-project key and `GlobalConfig` itself are gone now (phase 5 deleted the storage backend entirely).
- `frameworks` was already superseded by ecosystem presets (ADR-007) and unread.
- The legacy `indexing`-based shape was silently discarded by the merge even before it was formally retired; settings in it just vanished with no warning.

These were all removed from the type and from what gets validated. `ConfigService` still *loads* an existing config file that carries any of them, though: on `load()`, any top-level key other than `complexity` (and `complexity.enabled`, which was the one dead key inside the section that survived) is stripped with a one-time `console.warn` naming what to delete, rather than throwing.

### ConfigService API

```typescript
class ConfigService {
  async load(rootDir: string): Promise<LienConfig>; // merges with defaults, warns on retired keys
  validate(config: unknown): ValidationResult; // errors only on a malformed complexity/thresholds shape
}
```

There is no `save()`: nothing in the codebase writes `.lien.config.json` programmatically (the since-deleted `lien init` never generated one beyond the historical `frameworks` scaffold, and no other command does either); users hand-edit the file. There is no `exists()` either — its only caller was its own test, and `lien init`, which checked for the file directly with `fs.access()` rather than going through `ConfigService`, no longer exists. There is no `migrate()`/`needsMigration()`: the legacy pre-v0.3.0 shape is handled by the same warn-and-strip path as every other retired key, not a dedicated migration step.

### Validation

`validate()` rejects a non-object config, a non-object `complexity`, or a non-object `complexity.thresholds`. Everything else (an unrecognized top-level key, or `complexity.enabled`) is a warning, never an error: this file's philosophy is to warn and ignore stale config, not break on it.

### Example

```json
{
  "complexity": {
    "thresholds": {
      "testPaths": 20,
      "mentalLoad": 20
    }
  }
}
```

## History

For context on how this shape got smaller: the `core.chunkSize`/`core.chunkOverlap`/`core.concurrency` keys were removed as dead config in mid-2026 (each validated but never read by the indexing pipeline), followed by the rest of the sections listed above in the same pass. The retired-key warn-and-strip mechanism (`RETIRED_TOP_LEVEL_GROUPS` in `packages/core/src/config/service.ts`) is what's left standing from that cleanup, generalized so a future retirement is a new array entry rather than a bespoke migration path.
