import { DEFAULT_COMPLEXITY_THRESHOLDS } from '@liendev/parser';

/**
 * Per-project Lien configuration (`.lien.config.json`).
 *
 * The only field any production pipeline actually reads is
 * `complexity.thresholds` (consumed by `lien delta`, see
 * packages/cli/src/cli/delta-cmd.ts). Earlier versions of this file also had
 * `core`, `chunking`, `mcp`, `gitDetection`, `fileWatching`, `storage`,
 * `frameworks`, and a legacy `indexing`-based shape — all validated but never
 * wired to real behavior, so they were retired. `ConfigService` still loads
 * an existing `.lien.config.json` that carries any of them: it warns once per
 * retired section and strips it rather than failing.
 */
export interface LienConfig {
  complexity?: {
    thresholds: {
      testPaths: number; // 🔀 Max test paths per function (default: 15)
      mentalLoad: number; // 🧠 Max mental load score (default: 15)
      timeToUnderstandMinutes?: number; // ⏱️ Max minutes to understand (default: 60)
      estimatedBugs?: number; // 🐛 Max estimated bugs (default: 1.5)
    };
    // Severity multipliers are hardcoded: warning = 1x threshold, error = 2x threshold
  };
}

/**
 * Default per-project configuration.
 *
 * #988: `complexity.thresholds` values are derived from `DEFAULT_COMPLEXITY_THRESHOLDS`
 * (`@liendev/parser`, defined once in `packages/parser/src/insights/chunk-complexity.ts`)
 * rather than a hand-copied literal — this is the USER-FACING default that
 * `lien delta` (via `ConfigService`) reads, so a drift from the gate's own
 * defaults would silently enforce a threshold nobody chose. `LienConfig`'s
 * type stays distinct (two keys optional, to allow a partial user override
 * merged in `deepMergeConfig`) — only the values are shared.
 */
export const defaultConfig: LienConfig = {
  complexity: {
    thresholds: { ...DEFAULT_COMPLEXITY_THRESHOLDS },
  },
};
