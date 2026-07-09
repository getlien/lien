import fs from 'fs/promises';
import path from 'path';
import type { LienConfig, LegacyLienConfig } from './schema.js';
import { defaultConfig, isLegacyConfig, isModernConfig } from './schema.js';
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
 * One entry per group of config keys retired together (validated in the
 * past but never actually read by any pipeline). Each group is stripped
 * from both the modern `core` section and the legacy `indexing` section
 * before merge/validation, warning once per group per process instead of
 * throwing — mirrors global-config.ts's stripRetiredBackends, generalized
 * so a future retirement is a new array entry rather than a copy-pasted
 * strip function.
 */
interface RetiredKeyGroup {
  keys: readonly string[];
  message: string;
  warned: boolean;
}

const RETIRED_KEY_GROUPS: RetiredKeyGroup[] = [
  {
    keys: ['concurrency'],
    message:
      'Warning: the "concurrency" setting (core.concurrency / legacy indexing.concurrency) has been ' +
      'removed — it was validated but never read by the indexing pipeline. Ignoring it; you can ' +
      'delete it from your .lien.config.json. Parse-stage concurrency is now governed internally ' +
      '(PARSE_STAGE_MAX_CONCURRENCY in @liendev/parser).',
    warned: false,
  },
  {
    keys: ['chunkSize', 'chunkOverlap'],
    message:
      'Warning: the "chunkSize"/"chunkOverlap" settings (core.* / legacy indexing.*) have been ' +
      'removed — they were validated but never read by any indexing pipeline. Chunking is ' +
      'AST-based for all supported languages; these only ever shaped the line-based fallback ' +
      'chunker, which now always uses its built-in defaults. Ignoring them; you can delete them ' +
      'from your .lien.config.json.',
    warned: false,
  },
];

function warnRetiredOnce(group: RetiredKeyGroup): void {
  if (group.warned) return;
  group.warned = true;
  console.warn(group.message);
}

/**
 * Strip one retired key group from a single config section (`core` or
 * `indexing`), warning once if any of the group's keys were present.
 */
function stripGroupFromSection(
  raw: Record<string, unknown>,
  sectionName: 'core' | 'indexing',
  group: RetiredKeyGroup,
): Record<string, unknown> {
  const section = raw[sectionName];
  if (!section || typeof section !== 'object') return raw;

  const sectionObj = section as Record<string, unknown>;
  if (!group.keys.some(key => key in sectionObj)) return raw;

  warnRetiredOnce(group);
  const restSection = Object.fromEntries(
    Object.entries(sectionObj).filter(([key]) => !group.keys.includes(key)),
  );
  return { ...raw, [sectionName]: restSection };
}

/**
 * Strip all retired config key groups from a raw parsed config before it is
 * merged/validated, so an existing config that still carries one never
 * throws.
 */
function stripRetiredKeys(raw: Record<string, unknown>): Record<string, unknown> {
  return RETIRED_KEY_GROUPS.reduce(
    (result, group) =>
      stripGroupFromSection(stripGroupFromSection(result, 'core', group), 'indexing', group),
    raw,
  );
}

/**
 * ConfigService encapsulates all configuration operations including
 * loading, saving, and validation.
 * Migration removed - no longer needed.
 *
 * This service provides a single point of truth for config management
 * with comprehensive error handling and validation.
 */
export class ConfigService {
  private static readonly CONFIG_FILENAME = '.lien.config.json';

  /**
   * Load configuration from the specified directory.
   * Automatically handles migration if needed.
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

      // Merge with defaults - no migration needed
      const mergedConfig = deepMergeConfig(defaultConfig, userConfig as Partial<LienConfig>);

      // Then validate the merged config
      const validation = this.validate(mergedConfig);
      if (!validation.valid) {
        throw new ConfigError(`Invalid configuration:\n${validation.errors.join('\n')}`, {
          errors: validation.errors,
          warnings: validation.warnings,
        });
      }

      // Show warnings if any
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
   * Save configuration to the specified directory.
   * Validates the config before saving.
   *
   * @param rootDir - Root directory to save the config file
   * @param config - Configuration to save
   * @throws {ConfigError} If config is invalid or cannot be saved
   */
  async save(rootDir: string, config: LienConfig): Promise<void> {
    const configPath = this.getConfigPath(rootDir);

    // Validate before saving
    const validation = this.validate(config);
    if (!validation.valid) {
      throw new ConfigError(`Cannot save invalid configuration:\n${validation.errors.join('\n')}`, {
        errors: validation.errors,
      });
    }

    try {
      const configJson = JSON.stringify(config, null, 2) + '\n';
      await fs.writeFile(configPath, configJson, 'utf-8');
    } catch (error) {
      throw wrapError(error, 'Failed to save configuration', { path: configPath });
    }
  }

  /**
   * Check if a configuration file exists in the specified directory.
   *
   * @param rootDir - Root directory to check
   * @returns True if config file exists
   */
  async exists(rootDir: string = process.cwd()): Promise<boolean> {
    const configPath = this.getConfigPath(rootDir);
    try {
      await fs.access(configPath);
      return true;
    } catch {
      return false;
    }
  }

  // Migration methods removed - no longer needed

  /**
   * Validate a configuration object.
   * Checks all constraints and returns detailed validation results.
   *
   * @param config - Configuration to validate
   * @returns Validation result with errors and warnings
   */
  validate(config: unknown): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Type check
    if (!config || typeof config !== 'object') {
      return {
        valid: false,
        errors: ['Configuration must be an object'],
        warnings: [],
      };
    }

    const cfg = config as Partial<LienConfig>;

    // Validate based on config type
    if (isModernConfig(cfg as LienConfig | LegacyLienConfig)) {
      this.validateModernConfig(cfg as LienConfig, errors, warnings);
    } else if (isLegacyConfig(cfg as LienConfig | LegacyLienConfig)) {
      this.validateLegacyConfig(cfg as LegacyLienConfig, errors, warnings);
    } else {
      errors.push(
        'Configuration format not recognized. Must have either "core" or "indexing" field',
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate a partial configuration object.
   * Useful for validating user input before merging with defaults.
   *
   * @param config - Partial configuration to validate
   * @returns Validation result with errors and warnings
   */
  validatePartial(config: Partial<LienConfig>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate core settings if present
    if (config.core) {
      this.validateCoreConfig(config.core, warnings);
    }

    // Validate MCP settings if present
    if (config.mcp) {
      this.validateMCPConfig(config.mcp, errors, warnings);
    }

    // Validate git detection settings if present
    if (config.gitDetection) {
      this.validateGitDetectionConfig(config.gitDetection, errors, warnings);
    }

    // Validate file watching settings if present
    if (config.fileWatching) {
      this.validateFileWatchingConfig(config.fileWatching, errors, warnings);
    }

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
   * Validate modern (v0.3.0+) configuration
   */
  private validateModernConfig(config: LienConfig, errors: string[], warnings: string[]): void {
    // `core` currently holds no configurable settings (chunkSize/chunkOverlap
    // and concurrency were both removed as dead config) — its presence is
    // only the modern/legacy discriminator. It's still required to exist,
    // and validateCoreConfig below checks it's actually empty.
    if (!config.core) {
      errors.push('Missing required field: core');
      return;
    }
    this.validateCoreConfig(config.core, warnings);

    // Validate MCP settings
    if (!config.mcp) {
      errors.push('Missing required field: mcp');
      return;
    }
    this.validateMCPConfig(config.mcp, errors, warnings);

    // Validate git detection settings
    if (!config.gitDetection) {
      errors.push('Missing required field: gitDetection');
      return;
    }
    this.validateGitDetectionConfig(config.gitDetection, errors, warnings);

    // Validate file watching settings
    if (!config.fileWatching) {
      errors.push('Missing required field: fileWatching');
      return;
    }
    this.validateFileWatchingConfig(config.fileWatching, errors, warnings);
  }

  /**
   * Validate legacy (v0.2.0) configuration
   */
  private validateLegacyConfig(
    config: LegacyLienConfig,
    errors: string[],
    warnings: string[],
  ): void {
    warnings.push(
      'Using legacy configuration format. Consider running "lien init" to migrate to v0.3.0',
    );

    // Validate indexing settings
    if (!config.indexing) {
      errors.push('Missing required field: indexing');
      return;
    }

    // `indexing` currently has nothing left to numerically validate
    // (chunkSize/chunkOverlap were removed as dead config); include/exclude
    // are plain arrays with no constraints. Existence was already checked
    // above.

    // Validate MCP settings (same for both)
    if (config.mcp) {
      this.validateMCPConfig(config.mcp, errors, warnings);
    }
  }

  /**
   * Validate that `core` — which currently holds no configurable settings —
   * hasn't been given any keys. This only fires for callers that hand
   * validate()/validatePartial()/save() a raw config directly: the load()
   * path already runs stripRetiredKeys() before validating, so a config
   * file that still carries a retired key never reaches here with it.
   * Never an error, even for recognized retired keys: this file's
   * philosophy is to warn and ignore stale config, not break on it (see
   * RETIRED_KEY_GROUPS), and validate()/save() must extend that same
   * guarantee to direct callers, not just the load() path.
   */
  private validateCoreConfig(core: Record<string, unknown>, warnings: string[]): void {
    const keys = Object.keys(core);
    if (keys.length === 0) return;

    const retiredKeyNames = new Set(RETIRED_KEY_GROUPS.flatMap(group => group.keys));
    const retired = keys.filter(key => retiredKeyNames.has(key));
    const unknown = keys.filter(key => !retiredKeyNames.has(key));

    if (retired.length > 0) {
      warnings.push(
        `core has retired key(s) with no effect: ${retired.join(', ')}. These are silently ` +
          'dropped by load() — remove them from your .lien.config.json.',
      );
    }
    if (unknown.length > 0) {
      warnings.push(
        `core has unexpected key(s): ${unknown.join(', ')}. core currently holds no ` +
          'configurable settings.',
      );
    }
  }

  /**
   * Validate MCP configuration settings
   */
  private validateMCPConfig(
    mcp: Partial<LienConfig['mcp']>,
    errors: string[],
    _warnings: string[],
  ): void {
    if (mcp.port !== undefined) {
      if (typeof mcp.port !== 'number' || mcp.port < 1024 || mcp.port > 65535) {
        errors.push('mcp.port must be between 1024 and 65535');
      }
    }

    if (mcp.transport !== undefined) {
      if (mcp.transport !== 'stdio' && mcp.transport !== 'socket') {
        errors.push('mcp.transport must be either "stdio" or "socket"');
      }
    }

    if (mcp.autoIndexOnFirstRun !== undefined) {
      if (typeof mcp.autoIndexOnFirstRun !== 'boolean') {
        errors.push('mcp.autoIndexOnFirstRun must be a boolean');
      }
    }
  }

  /**
   * Validate git detection configuration settings
   */
  private validateGitDetectionConfig(
    gitDetection: Partial<LienConfig['gitDetection']>,
    errors: string[],
    _warnings: string[],
  ): void {
    if (gitDetection.enabled !== undefined) {
      if (typeof gitDetection.enabled !== 'boolean') {
        errors.push('gitDetection.enabled must be a boolean');
      }
    }

    if (gitDetection.pollIntervalMs !== undefined) {
      if (typeof gitDetection.pollIntervalMs !== 'number' || gitDetection.pollIntervalMs < 100) {
        errors.push('gitDetection.pollIntervalMs must be at least 100ms');
      } else if (gitDetection.pollIntervalMs < 1000) {
        _warnings.push(
          'gitDetection.pollIntervalMs is very short (<1s). This may impact performance',
        );
      }
    }
  }

  /**
   * Validate file watching configuration settings
   */
  private validateFileWatchingConfig(
    fileWatching: Partial<LienConfig['fileWatching']>,
    errors: string[],
    warnings: string[],
  ): void {
    if (fileWatching.enabled !== undefined) {
      if (typeof fileWatching.enabled !== 'boolean') {
        errors.push('fileWatching.enabled must be a boolean');
      }
    }

    if (fileWatching.debounceMs !== undefined) {
      if (typeof fileWatching.debounceMs !== 'number' || fileWatching.debounceMs < 0) {
        errors.push('fileWatching.debounceMs must be a non-negative number');
      } else if (fileWatching.debounceMs < 100) {
        warnings.push(
          'fileWatching.debounceMs is very short (<100ms). This may cause excessive reindexing',
        );
      }
    }
  }
}

// Export a singleton instance for convenience
export const configService = new ConfigService();
