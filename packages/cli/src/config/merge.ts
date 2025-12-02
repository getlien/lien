import { LienConfig } from './schema.js';

/**
 * Deep merges user config with defaults, preserving user customizations.
 * User values always take precedence over defaults.
 * 
 * @param defaults - The default configuration
 * @param user - The user's partial configuration
 * @returns Complete merged configuration
 */
export function deepMergeConfig(defaults: LienConfig, user: Partial<LienConfig>): LienConfig {
  return {
    version: user.version ?? defaults.version,
    core: {
      ...defaults.core,
      ...user.core,
    },
    chunking: {
      ...defaults.chunking,
      ...user.chunking,
    },
    mcp: {
      ...defaults.mcp,
      ...user.mcp,
    },
    gitDetection: {
      ...defaults.gitDetection,
      ...user.gitDetection,
    },
    fileWatching: {
      ...defaults.fileWatching,
      ...user.fileWatching,
    },
    complexity: user.complexity ? {
      enabled: user.complexity.enabled ?? defaults.complexity?.enabled ?? true,
      thresholds: {
        ...defaults.complexity?.thresholds,
        ...(user.complexity.thresholds || {}),
      },
      severity: {
        ...defaults.complexity?.severity,
        ...(user.complexity.severity || {}),
      },
    } : defaults.complexity,
    frameworks: user.frameworks ?? defaults.frameworks,
  };
}

/**
 * Detects new fields that exist in the 'after' config but not in the 'before' config.
 * Returns a list of human-readable field paths.
 * 
 * @param before - The existing config (potentially missing fields)
 * @param after - The complete config with all fields
 * @returns Array of new field paths (e.g., ["mcp.autoIndexOnFirstRun", "gitDetection"])
 */
export function detectNewFields(before: Record<string, any>, after: Record<string, any>): string[] {
  const newFields: string[] = [];

  // Check top-level sections
  for (const key of Object.keys(after)) {
    if (!(key in before)) {
      newFields.push(key);
      continue;
    }

    // Check nested fields for object sections
    if (typeof after[key] === 'object' && after[key] !== null && !Array.isArray(after[key])) {
      const beforeSection = (before[key] as Record<string, any>) || {};
      const afterSection = after[key] as Record<string, any>;

      for (const nestedKey of Object.keys(afterSection)) {
        if (!(nestedKey in beforeSection)) {
          newFields.push(`${key}.${nestedKey}`);
        }
      }
    }
  }

  return newFields;
}

