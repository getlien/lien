import type { LienConfig } from './schema.js';

/**
 * Deep merges user config with defaults, preserving user customizations.
 * `complexity.thresholds` is the only field LienConfig has left, so this
 * simply merges that one nested object; user-defined thresholds win,
 * unspecified ones fall back to the default.
 *
 * @param defaults - The default configuration
 * @param user - The user's partial configuration
 * @returns Complete merged configuration
 */
export function deepMergeConfig(defaults: LienConfig, user: Partial<LienConfig>): LienConfig {
  // Non-null assertion: `defaults` is a contract, not user input — callers
  // (in practice, always `defaultConfig`) must supply complete thresholds.
  // Without it, TS widens testPaths/mentalLoad to `| undefined` below, since
  // it can no longer see that *some* spread source always provides them.
  const defaultThresholds = defaults.complexity!.thresholds;
  return {
    complexity: {
      thresholds: {
        ...defaultThresholds,
        ...user.complexity?.thresholds,
      },
    },
  };
}
