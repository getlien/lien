import fs from 'fs/promises';
import path from 'path';
import type { LienConfig } from './schema.js';
import { defaultConfig } from './schema.js';
import { deepMergeConfig } from './merge.js';
import { ConfigError, wrapError } from '../errors/index.js';

/**
 * Validation result with errors and warnings
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * One entry per group of top-level `.lien.config.json` keys retired
 * together. Each was validated in the past but never actually read by any
 * pipeline (or, for `indexing`/`version`, was the legacy pre-v0.3.0 shape,
 * which was silently discarded by the merge even before this — settings in
 * it just vanished with no warning). Stripped before merge/validation,
 * warning once per group per process instead of throwing — mirrors
 * global-config.ts's stripRetiredBackends, generalized so a future
 * retirement is a new array entry rather than a copy-pasted strip function.
 */
interface RetiredKeyGroup {
  keys: readonly string[];
  message: string;
  warned: boolean;
}

const RETIRED_TOP_LEVEL_GROUPS: RetiredKeyGroup[] = [
  {
    keys: ['core'],
    message:
      'Warning: the top-level "core" .lien.config.json section has been removed — it never held ' +
      'any configurable settings (chunkSize/chunkOverlap and concurrency were both retired as ' +
      'dead config in earlier releases). Ignoring it; you can delete "core" from your ' +
      '.lien.config.json.',
    warned: false,
  },
  {
    keys: ['chunking'],
    message:
      'Warning: the top-level "chunking" .lien.config.json section has been removed — ' +
      'chunking.useAST/chunking.astFallback were validated but never read; chunking is always ' +
      'AST-based for supported languages with an internal line-based fallback. Ignoring it; you ' +
      'can delete "chunking" from your .lien.config.json.',
    warned: false,
  },
  {
    keys: ['mcp'],
    message:
      'Warning: the top-level "mcp" .lien.config.json section has been removed — mcp.port, ' +
      'mcp.transport, and mcp.autoIndexOnFirstRun were validated but never read; the MCP server ' +
      'does not load .lien.config.json at all. Ignoring it; you can delete "mcp" from your ' +
      '.lien.config.json.',
    warned: false,
  },
  {
    keys: ['gitDetection'],
    message:
      'Warning: the top-level "gitDetection" .lien.config.json section has been removed — it was ' +
      'validated but never read; git-change polling is governed internally. Ignoring it; you can ' +
      'delete "gitDetection" from your .lien.config.json.',
    warned: false,
  },
  {
    keys: ['fileWatching'],
    message:
      'Warning: the top-level "fileWatching" .lien.config.json section has been removed — it was ' +
      'validated but never read; file watching during `lien serve` is controlled only by the ' +
      '--watch/--no-watch CLI flag. Ignoring it; you can delete "fileWatching" from your ' +
      '.lien.config.json.',
    warned: false,
  },
  {
    keys: ['storage'],
    message:
      'Warning: the top-level "storage" .lien.config.json section has been removed — it was ' +
      'validated but never read. The storage backend is chosen by the separate global config ' +
      '(~/.lien/config.json, via `lien config set backend`), not per-project .lien.config.json. ' +
      'Ignoring it; you can delete "storage" from your .lien.config.json.',
    warned: false,
  },
  {
    keys: ['frameworks'],
    message:
      'Warning: the top-level "frameworks" .lien.config.json section has been removed — it was ' +
      'already deprecated in favor of ecosystem presets (see ADR-007) and unread. Ignoring it; ' +
      'you can delete "frameworks" from your .lien.config.json.',
    warned: false,
  },
  {
    keys: ['indexing', 'version'],
    message:
      'Warning: the legacy .lien.config.json format is no longer read; only ' +
      '"complexity.thresholds" is supported. Ignoring "indexing"/"version"; you can delete them ' +
      'from your .lien.config.json.',
    warned: false,
  },
];

/** Top-level `.lien.config.json` key that is actually read. */
const SUPPORTED_TOP_LEVEL_KEY = 'complexity';

/** Nested `complexity.*` keys retired together (thresholds is the only survivor). */
const RETIRED_COMPLEXITY_KEY_GROUP: RetiredKeyGroup = {
  keys: ['enabled'],
  message:
    'Warning: "complexity.enabled" has been removed — it was validated but never read; ' +
    'complexity.thresholds is always active. Ignoring it; you can delete "complexity.enabled" ' +
    'from your .lien.config.json.',
  warned: false,
};

/** Warned-once state for top-level keys with no dedicated group (typos, future removals). */
const warnedUnknownTopLevelKeys = new Set<string>();

function warnRetiredOnce(group: RetiredKeyGroup): void {
  if (group.warned) return;
  group.warned = true;
  console.warn(group.message);
}

function warnUnknownTopLevelKeyOnce(key: string): void {
  if (warnedUnknownTopLevelKeys.has(key)) return;
  warnedUnknownTopLevelKeys.add(key);
  console.warn(
    `Warning: unrecognized top-level .lien.config.json key "${key}" — only ` +
      `"${SUPPORTED_TOP_LEVEL_KEY}.thresholds" is supported. Ignoring it; you can delete "${key}" ` +
      'from your .lien.config.json.',
  );
}

/**
 * Strip every top-level key except `complexity` from a raw parsed config,
 * warning once for each. Named retired sections get a tailored message
 * explaining what they used to do; anything else (typos, a future removal
 * that hasn't earned its own message yet) gets a generic one. Tolerant by
 * design — an unrecognized key must never fail validation, only be ignored.
 */
function stripUnsupportedTopLevelKeys(raw: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === SUPPORTED_TOP_LEVEL_KEY) {
      result[key] = value;
      continue;
    }
    const group = RETIRED_TOP_LEVEL_GROUPS.find(g => g.keys.includes(key));
    if (group) {
      warnRetiredOnce(group);
    } else {
      warnUnknownTopLevelKeyOnce(key);
    }
  }
  return result;
}

/**
 * Strip retired keys from the `complexity` section (currently just
 * `enabled`), warning once if present.
 */
function stripRetiredComplexityKeys(raw: Record<string, unknown>): Record<string, unknown> {
  const complexity = raw.complexity;
  if (!complexity || typeof complexity !== 'object') return raw;

  const complexityObj = complexity as Record<string, unknown>;
  if (!RETIRED_COMPLEXITY_KEY_GROUP.keys.some(key => key in complexityObj)) return raw;

  warnRetiredOnce(RETIRED_COMPLEXITY_KEY_GROUP);
  const restComplexity = Object.fromEntries(
    Object.entries(complexityObj).filter(
      ([key]) => !RETIRED_COMPLEXITY_KEY_GROUP.keys.includes(key),
    ),
  );
  return { ...raw, complexity: restComplexity };
}

/**
 * Strip all retired/unsupported config keys from a raw parsed config before
 * it is merged/validated, so an existing config that still carries any of
 * them never throws.
 */
function stripRetiredKeys(raw: Record<string, unknown>): Record<string, unknown> {
  return stripRetiredComplexityKeys(stripUnsupportedTopLevelKeys(raw));
}

/**
 * ConfigService encapsulates per-project configuration loading and
 * validation. The only field it reads is `complexity.thresholds`; every
 * other legacy section is tolerated (warned-and-stripped) rather than
 * rejected — see RETIRED_TOP_LEVEL_GROUPS.
 */
export class ConfigService {
  private static readonly CONFIG_FILENAME = '.lien.config.json';

  /**
   * Load configuration from the specified directory.
   *
   * @param rootDir - Root directory containing the config file
   * @returns Loaded and validated configuration
   * @throws {ConfigError} If config is invalid or cannot be loaded
   */
  async load(rootDir: string = process.cwd()): Promise<LienConfig> {
    const configPath = this.getConfigPath(rootDir);

    try {
      const configContent = await fs.readFile(configPath, 'utf-8');
      const userConfig = stripRetiredKeys(JSON.parse(configContent));

      const mergedConfig = deepMergeConfig(defaultConfig, userConfig as Partial<LienConfig>);

      const validation = this.validate(mergedConfig);
      if (!validation.valid) {
        throw new ConfigError(`Invalid configuration:\n${validation.errors.join('\n')}`, {
          errors: validation.errors,
          warnings: validation.warnings,
        });
      }

      if (validation.warnings.length > 0) {
        console.warn('⚠️  Configuration warnings:');
        validation.warnings.forEach(warning => console.warn(`   ${warning}`));
      }

      return mergedConfig;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Config doesn't exist, return defaults
        return defaultConfig;
      }

      if (error instanceof ConfigError) {
        throw error;
      }

      if (error instanceof SyntaxError) {
        throw new ConfigError('Failed to parse config file: Invalid JSON syntax', {
          path: configPath,
          originalError: error.message,
        });
      }

      throw wrapError(error, 'Failed to load configuration', { path: configPath });
    }
  }

  /**
   * Validate a configuration object.
   *
   * `complexity` is the only field left, and it's optional (an empty config
   * is valid — thresholds fall back to defaults), so this only rejects a
   * non-object `complexity`/`complexity.thresholds`. Stray top-level or
   * `complexity.*` keys are warnings, never errors — this mirrors load()'s
   * tolerant stripRetiredKeys() for callers (and tests) that hand validate()
   * a raw config directly, bypassing load()'s stripping pass.
   *
   * @param config - Configuration to validate
   * @returns Validation result with errors and warnings
   */
  validate(config: unknown): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config || typeof config !== 'object') {
      return {
        valid: false,
        errors: ['Configuration must be an object'],
        warnings: [],
      };
    }

    const cfg = config as Record<string, unknown>;
    this.validateComplexityConfig(cfg.complexity, errors);
    this.warnStrayKeys(cfg, warnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Get the full path to the config file
   */
  private getConfigPath(rootDir: string): string {
    return path.join(rootDir, ConfigService.CONFIG_FILENAME);
  }

  /**
   * Validate the shape of the `complexity` section, if present.
   */
  private validateComplexityConfig(complexity: unknown, errors: string[]): void {
    if (complexity === undefined) return;
    if (typeof complexity !== 'object' || complexity === null) {
      errors.push('complexity must be an object');
      return;
    }

    const thresholds = (complexity as Record<string, unknown>).thresholds;
    if (thresholds === undefined) return;
    if (typeof thresholds !== 'object' || thresholds === null) {
      errors.push('complexity.thresholds must be an object');
    }
  }

  /**
   * Warn (never error) about top-level keys other than `complexity`, and
   * about `complexity.enabled`. Never fires for the load() path — that
   * already stripped these before validate() ran — but does fire for a
   * caller (or test) that hands validate() a raw config directly.
   */
  private warnStrayKeys(cfg: Record<string, unknown>, warnings: string[]): void {
    const strayTopLevel = Object.keys(cfg).filter(key => key !== SUPPORTED_TOP_LEVEL_KEY);
    if (strayTopLevel.length > 0) {
      warnings.push(
        `Unrecognized top-level key(s): ${strayTopLevel.join(', ')}. Only ` +
          `"${SUPPORTED_TOP_LEVEL_KEY}.thresholds" is supported; these are ignored.`,
      );
    }

    const complexity = cfg.complexity;
    if (complexity && typeof complexity === 'object' && 'enabled' in complexity) {
      warnings.push(
        '"complexity.enabled" has no effect and is ignored — complexity.thresholds is always active.',
      );
    }
  }
}

// Export a singleton instance for convenience
export const configService = new ConfigService();
