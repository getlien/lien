import chalk from 'chalk';
import path from 'path';
import { getLienHome } from '@liendev/parser';
import { loadGlobalConfig, mergeGlobalConfig, type GlobalConfig } from '@liendev/core';

const GLOBAL_CONFIG_PATH = path.join(getLienHome(), '.lien', 'config.json');

/**
 * Allowed config keys. All remaining keys are global (machine-wide, stored in
 * ~/.lien/config.json). The per-project `embeddings.enabled` key was retired
 * along with embeddings.
 */
const ALLOWED_KEYS: Record<string, { values: readonly string[]; description: string }> = {
  backend: {
    values: ['sqlite'],
    description: 'Storage backend (sqlite = structural store with FTS5 lexical search)',
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
    value = getNestedValue(await loadGlobalConfig(), key);
  } catch (error) {
    console.error(
      chalk.red(`Failed to get ${key}:`),
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
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
}
