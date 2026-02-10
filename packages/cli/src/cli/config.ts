import chalk from 'chalk';
import path from 'path';
import os from 'os';
import {
  loadGlobalConfig,
  mergeGlobalConfig,
  type GlobalConfig,
} from '@liendev/core';

const CONFIG_PATH = path.join(os.homedir(), '.lien', 'config.json');

/** Allowed config keys and their valid values */
const ALLOWED_KEYS: Record<string, { values: readonly string[]; description: string }> = {
  'backend': {
    values: ['lancedb', 'qdrant'],
    description: 'Vector database backend',
  },
  'qdrant.url': {
    values: [],
    description: 'Qdrant server URL',
  },
  'qdrant.apiKey': {
    values: [],
    description: 'Qdrant API key',
  },
};

/** Get a nested value from config using dot-notation key */
function getConfigValue(config: GlobalConfig, key: string): string | undefined {
  const parts = key.split('.');
  let current: unknown = config;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current == null ? undefined : String(current);
}

/** Convert a dot-notation key + value into a partial GlobalConfig */
function buildPartialConfig(key: string, value: string): Partial<GlobalConfig> {
  switch (key) {
    case 'backend':
      return { backend: value as GlobalConfig['backend'] };
    case 'qdrant.url':
      return { qdrant: { url: value } };
    case 'qdrant.apiKey':
      return { qdrant: { url: '', apiKey: value } };
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

  // Special handling for qdrant.apiKey — need existing url
  if (key === 'qdrant.apiKey') {
    const existing = await loadGlobalConfig();
    if (!existing.qdrant?.url) {
      console.error(chalk.red('Set qdrant.url first before setting qdrant.apiKey'));
      process.exit(1);
    }
  }

  const partial = buildPartialConfig(key, value);
  await mergeGlobalConfig(partial);

  console.log(chalk.green(`Set ${key} = ${value}`));
  console.log(chalk.dim(`Config: ${CONFIG_PATH}`));
}

export async function configGetCommand(key: string) {
  if (!ALLOWED_KEYS[key]) {
    console.error(chalk.red(`Unknown config key: "${key}"`));
    console.log(chalk.dim('Valid keys:'), Object.keys(ALLOWED_KEYS).join(', '));
    process.exit(1);
  }

  const config = await loadGlobalConfig();
  const value = getConfigValue(config, key);

  if (value === undefined) {
    console.log(chalk.dim(`${key}: (not set)`));
  } else {
    console.log(`${key}: ${value}`);
  }
}

export async function configListCommand() {
  const config = await loadGlobalConfig();

  console.log(chalk.bold('Global Configuration'));
  console.log(chalk.dim(`File: ${CONFIG_PATH}\n`));

  for (const [key, meta] of Object.entries(ALLOWED_KEYS)) {
    const value = getConfigValue(config, key);
    const display = value ?? chalk.dim('(not set)');
    console.log(`  ${chalk.cyan(key)}: ${display}  ${chalk.dim(`— ${meta.description}`)}`);
  }
}
