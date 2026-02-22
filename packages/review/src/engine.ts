/**
 * ReviewEngine — the plugin orchestrator.
 *
 * Deliberately simple:
 * 1. Register plugins
 * 2. Build context
 * 3. Iterate: shouldActivate() → analyze() → collect findings
 * 4. Return all findings
 *
 * Everything else (formatting, filtering, posting) is the adapter's job.
 */

import type { ReviewPlugin, ReviewContext, ReviewFinding } from './plugin-types.js';

export interface EngineOptions {
  /** Enable verbose debug logging of activation decisions and timing */
  verbose?: boolean;
}

export class ReviewEngine {
  private plugins: ReviewPlugin[] = [];
  private readonly verbose: boolean;

  constructor(opts?: EngineOptions) {
    this.verbose = opts?.verbose ?? false;
  }

  /**
   * Register a plugin. Duplicate IDs are rejected.
   */
  register(plugin: ReviewPlugin): void {
    if (this.plugins.some(p => p.id === plugin.id)) {
      throw new Error(`Plugin "${plugin.id}" is already registered`);
    }
    this.plugins.push(plugin);
  }

  /**
   * Get all registered plugin IDs.
   */
  getPluginIds(): string[] {
    return this.plugins.map(p => p.id);
  }

  /**
   * Run all registered plugins and collect findings.
   *
   * Each plugin runs in isolation: if one fails, the engine logs the error
   * and continues with remaining plugins.
   *
   * @param context - The review context shared by all plugins
   * @param pluginFilter - Optional: only run this specific plugin by ID
   * @returns All findings from all active plugins
   */
  async run(context: ReviewContext, pluginFilter?: string): Promise<ReviewFinding[]> {
    const findings: ReviewFinding[] = [];
    const logger = context.logger;

    const pluginsToRun = pluginFilter
      ? this.plugins.filter(p => p.id === pluginFilter)
      : this.plugins;

    if (pluginFilter && pluginsToRun.length === 0) {
      logger.warning(
        `Plugin "${pluginFilter}" not found. Available: ${this.getPluginIds().join(', ')}`,
      );
      return findings;
    }

    for (const plugin of pluginsToRun) {
      const start = Date.now();

      try {
        // Resolve plugin config: merge defaults with user overrides
        const pluginConfig = resolvePluginConfig(plugin, context);
        const pluginContext: ReviewContext = { ...context, config: pluginConfig };

        // Check if plugin requires LLM but none is available
        if (plugin.requiresLLM && !context.llm) {
          if (this.verbose) {
            logger.debug(`[engine] Skipping "${plugin.id}" — requires LLM but none configured`);
          }
          continue;
        }

        // Activation check
        const active = await plugin.shouldActivate(pluginContext);
        if (!active) {
          if (this.verbose) {
            logger.debug(`[engine] Skipping "${plugin.id}" — shouldActivate returned false`);
          }
          continue;
        }

        if (this.verbose) {
          logger.debug(`[engine] Running "${plugin.id}"...`);
        }

        // Run analysis
        const pluginFindings = await plugin.analyze(pluginContext);
        findings.push(...pluginFindings);

        const elapsed = Date.now() - start;
        logger.info(`Plugin "${plugin.id}": ${pluginFindings.length} findings (${elapsed}ms)`);
      } catch (error) {
        const elapsed = Date.now() - start;
        logger.warning(
          `Plugin "${plugin.id}" failed after ${elapsed}ms (non-blocking): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return findings;
  }
}

/**
 * Resolve plugin config: merge plugin defaults with user config overrides.
 */
function resolvePluginConfig(
  plugin: ReviewPlugin,
  context: ReviewContext,
): Record<string, unknown> {
  return {
    ...(plugin.defaultConfig ?? {}),
    ...(context.config ?? {}),
  };
}

/**
 * Create an engine with the built-in plugins registered.
 */
export function createDefaultEngine(opts?: EngineOptions): ReviewEngine {
  // Lazily import to avoid circular deps — plugins are registered in the consuming code
  return new ReviewEngine(opts);
}
