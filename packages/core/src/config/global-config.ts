import fs from 'fs/promises';
import path from 'path';
import { getLienHome } from '@liendev/parser';

/**
 * Error thrown when config file exists but has invalid syntax or structure.
 * This is separate from "file not found" which is expected behavior.
 */
export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly configPath: string,
  ) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Global configuration for Lien.
 * Only contains what truly needs configuration: storage backend choice.
 *
 * LanceDB is the only supported backend. The field is kept so an
 * alternative backend can be reintroduced later without a config migration.
 */
export interface GlobalConfig {
  backend?: 'lancedb';
}

/**
 * Raw shape of a parsed config file before sanitization.
 * May still contain retired keys (e.g. qdrant) from older versions.
 */
interface RawGlobalConfig {
  backend?: string;
  qdrant?: unknown;
}

const QDRANT_REMOVED_WARNING =
  'Warning: Qdrant support was removed in Lien v0.49; falling back to local LanceDB. ' +
  'You can delete the "qdrant" settings from your config.';

let qdrantWarningShown = false;

/**
 * Warn (once per process) that Qdrant settings were found but are no longer supported.
 */
function warnQdrantRemoved(): void {
  if (qdrantWarningShown) return;
  qdrantWarningShown = true;
  console.warn(QDRANT_REMOVED_WARNING);
}

/**
 * Strip retired Qdrant settings from a parsed config.
 *
 * Graceful degradation: an existing config with backend: "qdrant" or
 * qdrant.* keys must not crash — warn once and proceed with LanceDB.
 */
function stripRemovedQdrantConfig(raw: RawGlobalConfig): RawGlobalConfig {
  if (raw.backend !== 'qdrant' && raw.qdrant === undefined) {
    return raw;
  }

  warnQdrantRemoved();
  const { qdrant: _qdrant, ...rest } = raw;
  if (rest.backend === 'qdrant') {
    rest.backend = 'lancedb';
  }
  return rest;
}

/**
 * Load configuration from environment variables if present.
 */
function loadConfigFromEnv(): GlobalConfig | null {
  const backendEnv = process.env.LIEN_BACKEND;

  if (!backendEnv) {
    return null;
  }

  if (backendEnv === 'qdrant') {
    warnQdrantRemoved();
    return { backend: 'lancedb' };
  }

  if (backendEnv !== 'lancedb') {
    throw new ConfigValidationError(
      `Invalid LIEN_BACKEND environment variable: "${backendEnv}"\n` + `Valid value: 'lancedb'`,
      '<environment>',
    );
  }

  return { backend: 'lancedb' };
}

/**
 * Validate a sanitized config object.
 */
function validateConfig(
  config: RawGlobalConfig,
  configPath: string,
): asserts config is GlobalConfig {
  if (config.backend && config.backend !== 'lancedb') {
    throw new ConfigValidationError(
      `Invalid backend in global config: "${config.backend}"\n` +
        `Config file: ${configPath}\n` +
        `Valid value: 'lancedb'`,
      configPath,
    );
  }
}

/**
 * Parse JSON config file with helpful error messages.
 */
function parseConfigFile(content: string, configPath: string): RawGlobalConfig {
  try {
    return JSON.parse(content) as RawGlobalConfig;
  } catch (parseError) {
    const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
    throw new ConfigValidationError(
      `Failed to parse global config file.\n` +
        `Config file: ${configPath}\n` +
        `Syntax error: ${errorMsg}\n\n` +
        `Please fix the JSON syntax errors in your config file.`,
      configPath,
    );
  }
}

/**
 * Load global configuration from environment variables or config file.
 *
 * Precedence:
 * 1. Environment variables (highest)
 * 2. Global config file (~/.lien/config.json)
 * 3. Defaults (LanceDB)
 *
 * @returns Global configuration
 */
export async function loadGlobalConfig(): Promise<GlobalConfig> {
  // 1. Load config file as base
  let fileConfig: GlobalConfig = {};
  const configPath = path.join(getLienHome(), '.lien', 'config.json');
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const sanitized = stripRemovedQdrantConfig(parseConfigFile(content, configPath));
    validateConfig(sanitized, configPath);
    fileConfig = sanitized;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  // 2. Overlay environment variables (highest precedence)
  const envConfig = loadConfigFromEnv();
  if (envConfig) {
    return { ...fileConfig, ...envConfig };
  }

  // 3. Apply defaults if no config found at all
  if (!fileConfig.backend) {
    fileConfig.backend = 'lancedb';
  }
  return fileConfig;
}

/**
 * Save global configuration to ~/.lien/config.json.
 * Creates the directory if it doesn't exist.
 */
export async function saveGlobalConfig(config: GlobalConfig): Promise<void> {
  const configDir = path.join(getLienHome(), '.lien');
  const configPath = path.join(configDir, 'config.json');

  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/**
 * Load existing global config, merge a partial update, and save.
 * Retired Qdrant settings in the existing file are dropped on save.
 */
export async function mergeGlobalConfig(partial: Partial<GlobalConfig>): Promise<GlobalConfig> {
  const configPath = path.join(getLienHome(), '.lien', 'config.json');

  let existing: RawGlobalConfig = {};
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    existing = stripRemovedQdrantConfig(parseConfigFile(content, configPath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  const merged = { ...existing, ...partial } as GlobalConfig;

  await saveGlobalConfig(merged);
  return merged;
}
