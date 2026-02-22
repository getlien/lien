/**
 * Config module for .lien/review.yml parsing.
 *
 * Owns the config format, validation, and loading.
 * Sensible defaults when no config file exists.
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import type { ReviewPlugin } from './plugin-types.js';

// ---------------------------------------------------------------------------
// Config Schema
// ---------------------------------------------------------------------------

const llmConfigSchema = z
  .object({
    provider: z.string().default('openrouter'),
    model: z.string().default('minimax/minimax-m2.5'),
    apiKey: z.string().optional(),
  })
  .default({});

const reviewConfigSchema = z.object({
  plugins: z.array(z.string()).default(['complexity', 'logic', 'architectural']),
  llm: llmConfigSchema,
  settings: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
});

export type ReviewYamlConfig = z.infer<typeof reviewConfigSchema>;

// ---------------------------------------------------------------------------
// Config Loading
// ---------------------------------------------------------------------------

const CONFIG_FILENAME = 'review.yml';
const CONFIG_DIR = '.lien';

/**
 * Resolve the config file path from a root directory.
 */
function resolveConfigPath(rootDir: string): string {
  return path.join(rootDir, CONFIG_DIR, CONFIG_FILENAME);
}

/**
 * Interpolate environment variables in strings.
 * Supports ${VAR_NAME} syntax.
 */
function interpolateEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, varName) => {
    return process.env[varName] ?? '';
  });
}

/**
 * Deep-interpolate environment variables in an object.
 */
function interpolateConfig(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return interpolateEnvVars(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(interpolateConfig);
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateConfig(value);
    }
    return result;
  }
  return obj;
}

/**
 * Load and parse .lien/review.yml config.
 * Returns sensible defaults when no config file exists.
 */
export function loadConfig(rootDir: string): ReviewYamlConfig {
  const configPath = resolveConfigPath(rootDir);

  if (!fs.existsSync(configPath)) {
    return reviewConfigSchema.parse({});
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = parseYaml(raw);

    if (!parsed || typeof parsed !== 'object') {
      return reviewConfigSchema.parse({});
    }

    // Interpolate env vars (e.g., ${OPENROUTER_API_KEY})
    const interpolated = interpolateConfig(parsed) as Record<string, unknown>;

    // Validate with Zod
    const result = reviewConfigSchema.safeParse(interpolated);
    if (!result.success) {
      const issues = result.error.issues
        .map(i => `  - ${i.path.join('.')}: ${i.message}`)
        .join('\n');
      throw new Error(`Invalid config in ${configPath}:\n${issues}`);
    }

    return result.data;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid config')) {
      throw error;
    }
    throw new Error(
      `Failed to parse ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Resolve the LLM API key from config or environment.
 */
export function resolveLLMApiKey(config: ReviewYamlConfig): string | undefined {
  // Config value (may have been interpolated from env var)
  if (config.llm.apiKey) return config.llm.apiKey;

  // Fall back to env var
  return process.env.OPENROUTER_API_KEY;
}

/**
 * Get plugin config from the settings section.
 * Plugin config is namespaced under `settings:` to avoid collision with reserved top-level keys.
 */
export function getPluginConfig(
  config: ReviewYamlConfig,
  pluginId: string,
): Record<string, unknown> {
  return (config.settings[pluginId] as Record<string, unknown>) ?? {};
}

// ---------------------------------------------------------------------------
// Plugin Loading
// ---------------------------------------------------------------------------

/** Built-in plugin factories */
const BUILTIN_PLUGINS: Record<string, () => Promise<ReviewPlugin>> = {
  complexity: async () => {
    const { ComplexityPlugin } = await import('./plugins/complexity.js');
    return new ComplexityPlugin();
  },
  logic: async () => {
    const { LogicPlugin } = await import('./plugins/logic.js');
    return new LogicPlugin();
  },
  architectural: async () => {
    const { ArchitecturalPlugin } = await import('./plugins/architectural.js');
    return new ArchitecturalPlugin();
  },
};

/**
 * Load a plugin by name.
 * - Built-in plugins: 'complexity', 'logic', 'architectural'
 * - npm packages: full package name (e.g., '@myorg/lien-plugin-security')
 */
export async function loadPlugin(name: string): Promise<ReviewPlugin> {
  // Built-in plugin
  if (BUILTIN_PLUGINS[name]) {
    return BUILTIN_PLUGINS[name]();
  }

  // npm package: dynamic import
  try {
    const mod = await import(name);
    const plugin = (mod.default ?? mod) as ReviewPlugin;

    // Validate plugin shape
    if (!plugin.id || typeof plugin.id !== 'string') {
      throw new Error(`Plugin "${name}" is missing a valid "id" property`);
    }
    if (typeof plugin.analyze !== 'function') {
      throw new Error(`Plugin "${name}" is missing an "analyze" method`);
    }
    if (typeof plugin.shouldActivate !== 'function') {
      throw new Error(`Plugin "${name}" is missing a "shouldActivate" method`);
    }

    return plugin;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Plugin')) {
      throw error;
    }
    throw new Error(
      `Failed to load plugin "${name}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Load all plugins from config.
 */
export async function loadPlugins(config: ReviewYamlConfig): Promise<ReviewPlugin[]> {
  const plugins: ReviewPlugin[] = [];
  const seenIds = new Set<string>();

  for (const name of config.plugins) {
    const plugin = await loadPlugin(name);

    if (seenIds.has(plugin.id)) {
      throw new Error(
        `Duplicate plugin ID "${plugin.id}" — loaded from "${name}". Each plugin must have a unique ID.`,
      );
    }

    seenIds.add(plugin.id);
    plugins.push(plugin);
  }

  return plugins;
}
