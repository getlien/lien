import chalk from 'chalk';
import path from 'path';
import os from 'os';
import {
  loadGlobalConfig,
  mergeGlobalConfig,
  configService,
  type GlobalConfig,
  type LienConfig,
} from '@liendev/core';

const GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.lien', 'config.json');
const PROJECT_CONFIG_FILENAME = '.lien.config.json';

/**
 * Allowed config keys, split by scope:
 * - "global": machine-wide, stored in ~/.lien/config.json
 * - "project": per-repo, stored in <cwd>/.lien.config.json (via ConfigService)
 */
const ALLOWED_KEYS: Record<
  string,
  { scope: 'global' | 'project'; values: readonly string[]; description: string }
> = {
  backend: {
    scope: 'global',
    values: ['lancedb'],
    description: 'Vector database backend',
  },
  'embeddings.enabled': {
    scope: 'project',
    values: ['true', 'false'],
    description:
      'Compute embeddings for semantic search (false = structural-only mode; run `lien index --force` after changing this)',
  },
};

/** Get a nested value from an object using a dot-notation key */
function getNestedValue(config: object, key: string): string | undefined {
  const parts = key.split('.');
  let current: unknown = config;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current == null ? undefined : String(current);
}

/** Convert a dot-notation key + value into a partial GlobalConfig */
function buildPartialGlobalConfig(key: string, value: string): Partial<GlobalConfig> {
  switch (key) {
    case 'backend':
      return { backend: value as GlobalConfig['backend'] };
    default:
      return {};
  }
}

/** Apply a dot-notation project config key onto a full LienConfig */
function applyProjectConfigValue(config: LienConfig, key: string, value: string): LienConfig {
  switch (key) {
    case 'embeddings.enabled':
      return { ...config, embeddings: { ...config.embeddings, enabled: value === 'true' } };
    default:
      return config;
  }
}

/** Print a config-related error and exit non-zero. */
function failWithConfigError(action: string, error: unknown): never {
  console.error(chalk.red(`Failed to ${action}:`), error instanceof Error ? error.message : error);
  process.exit(1);
}

export async function configSetCommand(key: string, value: string) {
  const allowed = ALLOWED_KEYS[key];
  if (!allowed) {
    console.error(chalk.red(`Unknown config key: "${key}"`));
    console.log(chalk.dim('Valid keys:'), Object.keys(ALLOWED_KEYS).join(', '));
    process.exit(1);
  }

  if (allowed.values.length > 0 && !allowed.values.includes(value)) {
    console.error(chalk.red(`Invalid value "${value}" for ${key}`));
    console.log(chalk.dim('Valid values:'), allowed.values.join(', '));
    process.exit(1);
  }

  if (allowed.scope === 'project') {
    const rootDir = process.cwd();
    try {
      const current = await configService.load(rootDir);
      const updated = applyProjectConfigValue(current, key, value);
      await configService.save(rootDir, updated);
    } catch (error) {
      failWithConfigError(`set ${key}`, error);
    }

    console.log(chalk.green(`Set ${key} = ${value}`));
    console.log(chalk.dim(`Config: ${path.join(rootDir, PROJECT_CONFIG_FILENAME)}`));
    return;
  }

  const partial = buildPartialGlobalConfig(key, value);
  await mergeGlobalConfig(partial);

  console.log(chalk.green(`Set ${key} = ${value}`));
  console.log(chalk.dim(`Config: ${GLOBAL_CONFIG_PATH}`));
}

export async function configGetCommand(key: string) {
  const allowed = ALLOWED_KEYS[key];
  if (!allowed) {
    console.error(chalk.red(`Unknown config key: "${key}"`));
    console.log(chalk.dim('Valid keys:'), Object.keys(ALLOWED_KEYS).join(', '));
    process.exit(1);
  }

  let value: string | undefined;
  try {
    value =
      allowed.scope === 'project'
        ? getNestedValue(await configService.load(process.cwd()), key)
        : getNestedValue(await loadGlobalConfig(), key);
  } catch (error) {
    failWithConfigError(`get ${key}`, error);
  }

  if (value === undefined) {
    console.log(chalk.dim(`${key}: (not set)`));
  } else {
    console.log(`${key}: ${value}`);
  }
}

export async function configListCommand() {
  console.log(chalk.bold('Global Configuration'));
  console.log(chalk.dim(`File: ${GLOBAL_CONFIG_PATH}\n`));

  try {
    const globalConfig = await loadGlobalConfig();
    for (const [key, meta] of Object.entries(ALLOWED_KEYS)) {
      if (meta.scope !== 'global') continue;
      const value = getNestedValue(globalConfig, key);
      const display = value ?? chalk.dim('(not set)');
      console.log(`  ${chalk.cyan(key)}: ${display}  ${chalk.dim(`— ${meta.description}`)}`);
    }
  } catch (error) {
    console.log(
      chalk.red(
        `  Failed to load global config: ${error instanceof Error ? error.message : error}`,
      ),
    );
  }

  try {
    const projectConfig = await configService.load(process.cwd());

    console.log(chalk.bold('\nProject Configuration'));
    console.log(chalk.dim(`File: ${path.join(process.cwd(), PROJECT_CONFIG_FILENAME)}\n`));

    for (const [key, meta] of Object.entries(ALLOWED_KEYS)) {
      if (meta.scope !== 'project') continue;
      const value = getNestedValue(projectConfig, key);
      const display = value ?? chalk.dim('(not set)');
      console.log(`  ${chalk.cyan(key)}: ${display}  ${chalk.dim(`— ${meta.description}`)}`);
    }
  } catch (error) {
    console.log(chalk.bold('\nProject Configuration'));
    console.log(
      chalk.red(
        `  Failed to load ${PROJECT_CONFIG_FILENAME}: ${error instanceof Error ? error.message : error}`,
      ),
    );
  }
}
