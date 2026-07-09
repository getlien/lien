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

/** Default per-project configuration. */
export const defaultConfig: LienConfig = {
  complexity: {
    thresholds: {
      testPaths: 15, // 🔀 Max test paths per function
      mentalLoad: 15, // 🧠 Max mental load score
      timeToUnderstandMinutes: 60, // ⏱️ Functions taking >1 hour to understand
      estimatedBugs: 1.5, // 🐛 Functions estimated to have >1.5 bugs
    },
  },
};
