/**
 * ReviewEngine — the plugin orchestrator.
 *
 * Deliberately simple:
 * 1. Register plugins
 * 2. Build context
 * 3. Iterate: shouldActivate() → analyze() → collect findings
 * 4. Return all findings
 * 5. present(): plugins render output via PresentContext helpers
 *
 * Everything else (formatting, filtering, posting) is the adapter's job.
 */

import type {
  ReviewPlugin,
  ReviewContext,
  ReviewFinding,
  AdapterContext,
  PresentContext,
  CheckAnnotation,
} from './plugin-types.js';
import type { Octokit } from '@octokit/rest';
import type { Logger } from './logger.js';
import { createCheckRun, updateCheckRun, type CheckRunOutput } from './github-api.js';
import { postPRReview } from './github-api.js';

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

    // Run all plugins in parallel for speed (they're independent)
    const results = await Promise.allSettled(
      pluginsToRun.map(async plugin => {
        const start = Date.now();

        // Resolve plugin config: merge defaults with user overrides
        const pluginConfig = resolvePluginConfig(plugin, context);
        const pluginContext: ReviewContext = { ...context, config: pluginConfig };

        // Check if plugin requires LLM but none is available
        if (plugin.requiresLLM && !context.llm) {
          if (this.verbose) {
            logger.debug(`[engine] Skipping "${plugin.id}" — requires LLM but none configured`);
          }
          return [];
        }

        // Activation check
        const active = await plugin.shouldActivate(pluginContext);
        if (!active) {
          if (this.verbose) {
            logger.debug(`[engine] Skipping "${plugin.id}" — shouldActivate returned false`);
          }
          return [];
        }

        if (this.verbose) {
          logger.debug(`[engine] Running "${plugin.id}"...`);
        }

        // Run analysis
        const pluginFindings = await plugin.analyze(pluginContext);

        const elapsed = Date.now() - start;
        logger.info(`Plugin "${plugin.id}": ${pluginFindings.length} findings (${elapsed}ms)`);

        return pluginFindings;
      }),
    );

    // Collect findings, log failures
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        findings.push(...result.value);
      } else {
        const plugin = pluginsToRun[i];
        logger.warning(
          `Plugin "${plugin.id}" failed (non-blocking): ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
        );
      }
    }

    return findings;
  }

  /**
   * Run plugin present() hooks and manage the check run lifecycle.
   *
   * 1. Create check run (in_progress) if GitHub context available
   * 2. Call each plugin's present() with PresentContext helpers
   * 3. Finalize check run (conclusion + summary + batched annotations)
   */
  async present(
    findings: ReviewFinding[],
    adapterContext: AdapterContext,
    pluginFilter?: string,
  ): Promise<void> {
    const logger = adapterContext.logger;
    const octokit = adapterContext.octokit as Octokit | undefined;
    const pr = adapterContext.pr;

    const pendingAnnotations: CheckAnnotation[] = [];
    const debugLog: string[] = [];

    // Create check run if GitHub context available
    let checkRunId: number | undefined;
    if (octokit && pr) {
      try {
        checkRunId = await createCheckRun(
          octokit,
          {
            owner: pr.owner,
            repo: pr.repo,
            name: 'Lien Review',
            headSha: pr.headSha,
            status: 'in_progress',
            output: { title: 'Running...', summary: 'Analysis in progress' },
          },
          logger,
        );
      } catch (error) {
        logger.warning(
          `Failed to create check run: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Build PresentContext with helpers
    const debugLogger = createDebugCapturingLogger(logger, debugLog);
    const presentContext: PresentContext = {
      complexityReport: adapterContext.complexityReport,
      baselineReport: adapterContext.baselineReport,
      deltas: adapterContext.deltas,
      deltaSummary: adapterContext.deltaSummary,
      pr: adapterContext.pr,
      logger: debugLogger,
      llmUsage: adapterContext.llmUsage,
      model: adapterContext.model,
      addAnnotations: annotations => pendingAnnotations.push(...annotations),
      postReviewComment:
        octokit && pr
          ? (body, comments) => postPRReview(octokit, pr, comments ?? [], body, logger, 'COMMENT')
          : undefined,
    };

    // Call each plugin's present()
    const plugins = pluginFilter ? this.plugins.filter(p => p.id === pluginFilter) : this.plugins;

    for (const plugin of plugins) {
      if (!plugin.present) continue;
      try {
        await plugin.present(findings, presentContext);
      } catch (error) {
        logger.warning(
          `Plugin "${plugin.id}" present() failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Finalize check run
    if (octokit && pr && checkRunId != null) {
      try {
        const conclusion = determineConclusion(findings);
        const title = buildCheckTitle(findings);
        const summary = buildCheckSummary(findings);
        const text = debugLog.length > 0 ? debugLog.join('\n') : undefined;

        await finalizeCheckRun(
          octokit,
          pr,
          checkRunId,
          pendingAnnotations,
          {
            title,
            summary,
            text,
            conclusion,
          },
          logger,
        );
      } catch (error) {
        logger.warning(
          `Failed to finalize check run: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Check Run Helpers
// ---------------------------------------------------------------------------

/** Max annotations per GitHub Checks API call */
const ANNOTATIONS_BATCH_SIZE = 50;

/**
 * Determine check run conclusion based on findings.
 */
function determineConclusion(findings: ReviewFinding[]): 'success' | 'failure' | 'neutral' {
  if (findings.length === 0) return 'success';
  if (findings.some(f => f.severity === 'error')) return 'failure';
  return 'neutral';
}

/**
 * Build a short check run title.
 */
function buildCheckTitle(findings: ReviewFinding[]): string {
  if (findings.length === 0) return 'No issues found';
  const errors = findings.filter(f => f.severity === 'error').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  if (parts.length === 0)
    parts.push(`${findings.length} finding${findings.length === 1 ? '' : 's'}`);
  return parts.join(', ');
}

/**
 * Build check run summary markdown.
 */
function buildCheckSummary(findings: ReviewFinding[]): string {
  if (findings.length === 0) return 'All checks passed.';

  const byPlugin = new Map<string, number>();
  for (const f of findings) {
    byPlugin.set(f.pluginId, (byPlugin.get(f.pluginId) ?? 0) + 1);
  }

  const lines = [`Found ${findings.length} issue${findings.length === 1 ? '' : 's'}:\n`];
  for (const [pluginId, count] of byPlugin) {
    lines.push(`- **${pluginId}**: ${count}`);
  }
  return lines.join('\n');
}

/**
 * Finalize a check run: batch annotations (max 50 per call), set conclusion.
 */
async function finalizeCheckRun(
  octokit: Octokit,
  pr: { owner: string; repo: string },
  checkRunId: number,
  annotations: CheckAnnotation[],
  opts: {
    title: string;
    summary: string;
    text?: string;
    conclusion: 'success' | 'failure' | 'neutral';
  },
  logger: Logger,
): Promise<void> {
  // Truncate annotation titles to 255 chars (GitHub limit)
  const sanitized = annotations.map(a => ({
    ...a,
    title: a.title ? a.title.slice(0, 255) : undefined,
  }));

  // Batch annotations in groups of 50
  const batches: CheckAnnotation[][] = [];
  for (let i = 0; i < sanitized.length; i += ANNOTATIONS_BATCH_SIZE) {
    batches.push(sanitized.slice(i, i + ANNOTATIONS_BATCH_SIZE));
  }

  // Send all but the last batch as intermediate updates
  for (let i = 0; i < batches.length - 1; i++) {
    await updateCheckRun(
      octokit,
      {
        owner: pr.owner,
        repo: pr.repo,
        checkRunId,
        output: {
          title: opts.title,
          summary: opts.summary,
          annotations: batches[i],
        },
      },
      logger,
    );
  }

  // Final update: set conclusion + last batch of annotations
  const lastBatch = batches.length > 0 ? batches[batches.length - 1] : [];
  const output: CheckRunOutput = {
    title: opts.title,
    summary: opts.summary,
    ...(opts.text ? { text: opts.text } : {}),
    ...(lastBatch.length > 0 ? { annotations: lastBatch } : {}),
  };

  await updateCheckRun(
    octokit,
    {
      owner: pr.owner,
      repo: pr.repo,
      checkRunId,
      status: 'completed',
      conclusion: opts.conclusion,
      output,
    },
    logger,
  );

  logger.info(
    `Check run finalized: ${opts.conclusion} (${annotations.length} annotations in ${batches.length || 1} batch${batches.length === 1 ? '' : 'es'})`,
  );
}

/**
 * Wrap a logger to also capture messages in a debug log array.
 * Used to accumulate debug output for the check run text field.
 */
function createDebugCapturingLogger(logger: Logger, debugLog: string[]): Logger {
  return {
    info(message: string) {
      logger.info(message);
      debugLog.push(`[info] ${message}`);
    },
    warning(message: string) {
      logger.warning(message);
      debugLog.push(`[warning] ${message}`);
    },
    error(message: string) {
      logger.error(message);
      debugLog.push(`[error] ${message}`);
    },
    debug(message: string) {
      logger.debug(message);
      debugLog.push(`[debug] ${message}`);
    },
  };
}

/**
 * Resolve plugin config: merge plugin defaults with user overrides for this specific plugin.
 * Reads from context.pluginConfigs[plugin.id] to avoid cross-plugin key collisions.
 * Validates against the plugin's Zod schema if one is defined.
 */
function resolvePluginConfig(
  plugin: ReviewPlugin,
  context: ReviewContext,
): Record<string, unknown> {
  const userConfig = context.pluginConfigs[plugin.id] ?? {};
  const merged = {
    ...(plugin.defaultConfig ?? {}),
    ...userConfig,
  };

  if (plugin.configSchema) {
    const result = plugin.configSchema.safeParse(merged);
    if (!result.success) {
      context.logger.warning(
        `Invalid config for plugin "${plugin.id}": ${result.error.message}. Using defaults.`,
      );
      return plugin.defaultConfig ?? {};
    }
    return result.data as Record<string, unknown>;
  }

  return merged;
}

/**
 * Create a ReviewEngine instance. Plugins must be registered by the caller.
 */
export function createDefaultEngine(opts?: EngineOptions): ReviewEngine {
  return new ReviewEngine(opts);
}
