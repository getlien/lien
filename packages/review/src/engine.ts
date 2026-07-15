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

import { promises as fs } from 'node:fs';

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
import {
  createCheckRun,
  updateCheckRun,
  type CheckRunOutput,
  postPRReview,
  getPRDiffLines,
  PLUGIN_MARKER_PREFIX,
  getExistingPluginCommentKeys,
  updatePRDescription,
  minimizeOutdatedComments,
} from './github-api.js';
import type { LineComment, PRContext } from './types.js';
import { performChunkOnlyIndex } from '@liendev/parser';

export interface EngineOptions {
  /** Enable verbose debug logging of activation decisions and timing */
  verbose?: boolean;
}

/**
 * What `present()` actually delivered, as ground truth rather than "attempted"
 * counts — feeds the delivery attestation. Populated from the SAME
 * `PostReviewResult` the GitHub API call returns, not from the size of the
 * batch a plugin asked to post.
 */
export interface PresentDelivery {
  annotationsEmitted: number;
  inlineComments: { attempted: number; posted: number; dropped: number; deduped: number };
  /** null when no plugin contributed a description section this run (nothing to update). */
  descriptionBadgeUpdated: boolean | null;
  /** null when no plugin attempted an out-of-diff review comment this run. */
  outOfDiffReviewPosted: boolean | null;
}

/** Zero-value delivery, for paths where `present()` never ran (e.g. it threw). */
export const EMPTY_DELIVERY: PresentDelivery = {
  annotationsEmitted: 0,
  inlineComments: { attempted: 0, posted: 0, dropped: 0, deduped: 0 },
  descriptionBadgeUpdated: null,
  outOfDiffReviewPosted: null,
};

/** Mutable accumulator threaded through a single `present()` call. */
interface DeliveryTracker {
  inlineComments: { attempted: number; posted: number; dropped: number; deduped: number };
  outOfDiffReviewPosted: boolean | null;
}

function createDeliveryTracker(): DeliveryTracker {
  return {
    inlineComments: { attempted: 0, posted: 0, dropped: 0, deduped: 0 },
    outOfDiffReviewPosted: null,
  };
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
   * Three-phase execution:
   * 1. Activate — resolve config, check shouldActivate() + LLM requirement
   * 2. Lazy index — if any active plugin needs repoChunks, index the full repo once
   * 3. Analyze — run all active plugins in parallel
   *
   * @param context - The review context shared by all plugins
   * @param pluginFilter - Optional: only run this specific plugin by ID
   * @returns All findings from all active plugins
   */
  async run(context: ReviewContext, pluginFilter?: string): Promise<ReviewFinding[]> {
    const logger = context.logger;

    const pluginsToRun = pluginFilter
      ? this.plugins.filter(p => p.id === pluginFilter)
      : this.plugins;

    if (pluginFilter && pluginsToRun.length === 0) {
      logger.warning(
        `Plugin "${pluginFilter}" not found. Available: ${this.getPluginIds().join(', ')}`,
      );
      return [];
    }

    // Phase 1: Activation — determine which plugins will run
    const activePlugins = await this.resolveActivePlugins(pluginsToRun, context);
    if (activePlugins.length === 0) return [];

    // Phase 2: Lazy repo indexing — only when an active plugin needs it
    await ensureRepoChunks(activePlugins, context);

    // Optional: capture the post-index context for the agent-rule offline harness.
    // Gated by env var — zero overhead in prod when unset. See
    // packages/review/test/harness/README.md (#538) for the replay flow.
    if (process.env.LIEN_REVIEW_CAPTURE_CTX) {
      await captureContext(context, process.env.LIEN_REVIEW_CAPTURE_CTX, logger);
    }

    // Phase 3: Analysis — run all active plugins in parallel, except summary runs last
    const deferredId = 'summary';
    const parallel = activePlugins.filter(({ plugin }) => plugin.id !== deferredId);
    const deferred = activePlugins.filter(({ plugin }) => plugin.id === deferredId);

    const findings = await runActivePlugins(parallel, this.verbose, logger);

    // Run deferred plugins (summary) with access to prior findings
    if (deferred.length > 0) {
      for (const entry of deferred) {
        entry.pluginContext = { ...entry.pluginContext, priorFindings: findings };
      }
      const deferredFindings = await runActivePlugins(deferred, this.verbose, logger);
      findings.push(...deferredFindings);
    }

    return findings;
  }

  /**
   * Resolve config, check LLM requirement and shouldActivate() for each plugin.
   */
  private async resolveActivePlugins(
    plugins: ReviewPlugin[],
    context: ReviewContext,
  ): Promise<ActivePlugin[]> {
    const active: ActivePlugin[] = [];

    for (const plugin of plugins) {
      const pluginConfig = resolvePluginConfig(plugin, context);
      const pluginContext: ReviewContext = { ...context, config: pluginConfig };
      const skipReason = await getSkipReason(plugin, pluginContext);

      if (skipReason) {
        if (this.verbose) context.logger.debug(`[engine] Skipping "${plugin.id}" — ${skipReason}`);
        context.reportSkip?.({ plugin: plugin.id, reason: skipReason });
        continue;
      }

      active.push({ plugin, pluginContext });
    }

    return active;
  }

  /**
   * Run plugin present() hooks and manage the check run lifecycle.
   *
   * 1. Create check run (in_progress) if not already provided
   * 2. Call each plugin's present() with PresentContext helpers
   * 3. Finalize check run (conclusion + summary + batched annotations)
   *
   * @param opts.checkRunId - Pre-created check run ID. If provided, the engine
   *   reuses it instead of creating a new one. This lets callers create the check
   *   run early (e.g., at webhook receipt) for immediate "in_progress" feedback.
   */
  async present(
    findings: ReviewFinding[],
    adapterContext: AdapterContext,
    opts?: { pluginFilter?: string; checkRunId?: number; skipCheckRun?: boolean },
  ): Promise<{
    conclusion: 'success' | 'failure' | 'neutral';
    summary: string;
    delivery: PresentDelivery;
  }> {
    const octokit = adapterContext.octokit as Octokit | undefined;
    const pr = adapterContext.pr;
    const pendingAnnotations: CheckAnnotation[] = [];
    const debugLog: string[] = [];
    const summarySections: TaggedSection[] = [];
    const descriptionParts = new Map<string, string>();
    const deliveryTracker = createDeliveryTracker();

    const checkRunId = opts?.skipCheckRun
      ? undefined
      : await ensureCheckRun(octokit, pr, opts?.checkRunId, adapterContext.logger);
    const presentContext = buildPresentContext(
      adapterContext,
      octokit,
      pr,
      pendingAnnotations,
      summarySections,
      descriptionParts,
      debugLog,
      deliveryTracker,
    );
    await dispatchPresent(
      this.plugins,
      opts?.pluginFilter,
      findings,
      presentContext,
      summarySections,
      adapterContext.logger,
    );

    // Compose unified PR description from all plugin fragments
    const descriptionBadgeUpdated = await finalizeDescription(
      descriptionParts,
      octokit,
      pr,
      adapterContext.logger,
    );
    const delivery: PresentDelivery = {
      annotationsEmitted: 0,
      inlineComments: deliveryTracker.inlineComments,
      descriptionBadgeUpdated,
      outOfDiffReviewPosted: deliveryTracker.outOfDiffReviewPosted,
    };

    return finalizePresentResult(
      octokit,
      pr,
      checkRunId,
      findings,
      summarySections,
      pendingAnnotations,
      debugLog,
      delivery,
      adapterContext.logger,
    );
  }
}

/**
 * `present()`'s two return paths, split out so annotationsEmitted is stamped
 * correctly on each: only the check-run path (Checks API) actually sends
 * annotations to GitHub. The no-check-run path — the Action's primary flow,
 * since `presentFindings` always calls `present()` with `skipCheckRun: true`
 * — never emits any, so `delivery.annotationsEmitted` stays the 0 it's
 * initialized with.
 */
async function finalizePresentResult(
  octokit: Octokit | undefined,
  pr: PRContext | undefined,
  checkRunId: number | undefined,
  findings: ReviewFinding[],
  summarySections: TaggedSection[],
  pendingAnnotations: CheckAnnotation[],
  debugLog: string[],
  delivery: PresentDelivery,
  logger: Logger,
): Promise<{
  conclusion: 'success' | 'failure' | 'neutral';
  summary: string;
  delivery: PresentDelivery;
}> {
  if (octokit && pr && checkRunId != null) {
    const presented = await finalizePresentation(
      octokit,
      pr,
      checkRunId,
      findings,
      summarySections,
      pendingAnnotations,
      debugLog,
      logger,
    );
    return {
      ...presented,
      delivery: { ...delivery, annotationsEmitted: pendingAnnotations.length },
    };
  }

  // No check run was finalized (no octokit/pr/checkRunId), but callers still
  // want the conclusion + summary for step summaries and exit codes.
  const ordered = reorderSections(summarySections);
  return {
    conclusion: determineConclusion(findings),
    summary: ordered.length > 0 ? ordered.join('\n\n') : buildCheckSummary(findings),
    delivery,
  };
}

// ---------------------------------------------------------------------------
// run() helpers
// ---------------------------------------------------------------------------

interface ActivePlugin {
  plugin: ReviewPlugin;
  pluginContext: ReviewContext;
}

/**
 * Returns a skip reason string if the plugin should not run, or null if it should.
 */
async function getSkipReason(plugin: ReviewPlugin, context: ReviewContext): Promise<string | null> {
  if (plugin.requiresLLM && !context.llm) {
    return 'requires LLM but none configured';
  }

  try {
    const isActive = await plugin.shouldActivate(context);
    if (!isActive) return 'shouldActivate returned false';
  } catch (error) {
    context.logger.warning(
      `Plugin "${plugin.id}" shouldActivate() failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 'shouldActivate() threw an error';
  }

  return null;
}

/**
 * If any active plugin needs repoChunks, index the full repo once and share.
 */
async function ensureRepoChunks(
  activePlugins: ActivePlugin[],
  context: ReviewContext,
): Promise<void> {
  const needsRepoChunks = activePlugins.some(({ plugin }) => plugin.requiresRepoChunks);
  if (!needsRepoChunks || context.repoChunks) return;

  const logger = context.logger;

  if (!context.repoRootDir) {
    logger.warning(
      '[engine] Plugin requires repoChunks but repoRootDir is not set — skipping repo indexing',
    );
    return;
  }

  const start = Date.now();
  logger.info('[engine] Indexing full repo for dependency analysis...');
  const indexResult = await performChunkOnlyIndex(context.repoRootDir);

  if (indexResult.success && indexResult.chunks) {
    context.repoChunks = indexResult.chunks;
    logger.info(
      `[engine] Full repo indexed: ${indexResult.chunks.length} chunks (${Date.now() - start}ms)`,
    );
  } else {
    logger.warning(`[engine] Full repo indexing failed: ${indexResult.error ?? 'unknown error'}`);
  }

  // Update plugin contexts with repoChunks
  for (const entry of activePlugins) {
    entry.pluginContext = { ...entry.pluginContext, repoChunks: context.repoChunks };
  }
}

/**
 * Serialize the post-index ReviewContext to disk. Used by the agent-rule
 * offline harness (#538) to snapshot real PR inputs for replay.
 *
 * Map and Set are tagged so the harness's fixture-loader can revive them.
 * Octokit and other non-serializable references on adapterContext are not
 * present here — context only carries plain data.
 */
async function captureContext(context: ReviewContext, path: string, logger: Logger): Promise<void> {
  const replacer = (_key: string, value: unknown): unknown => {
    if (value instanceof Map) {
      return { __type: 'Map', entries: [...value.entries()] };
    }
    if (value instanceof Set) {
      return { __type: 'Set', values: [...value.values()] };
    }
    return value;
  };
  try {
    await fs.writeFile(path, JSON.stringify(context, replacer, 2));
    logger.info(`[engine] captured ctx → ${path}`);
  } catch (err) {
    logger.warning(
      `[engine] LIEN_REVIEW_CAPTURE_CTX write failed (${path}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Run all active plugins in parallel and collect findings.
 */
async function runActivePlugins(
  activePlugins: ActivePlugin[],
  verbose: boolean,
  logger: Logger,
): Promise<ReviewFinding[]> {
  const results = await Promise.allSettled(
    activePlugins.map(async ({ plugin, pluginContext }) => {
      const start = Date.now();
      if (verbose) logger.debug(`[engine] Running "${plugin.id}"...`);

      const pluginFindings = await plugin.analyze(pluginContext);
      // Count real (postable) findings separately from the summary entry some
      // plugins append (category 'summary' → the PR callout, not an inline
      // comment). Counting the summary as a finding read as "a finding went
      // missing" when a review was actually clean (0 real + 1 summary).
      const real = pluginFindings.filter(f => f.category !== 'summary').length;
      const hasSummary = pluginFindings.length > real;
      logger.info(
        `Plugin "${plugin.id}": ${real} findings${hasSummary ? ' (+summary)' : ''} (${Date.now() - start}ms)`,
      );
      return pluginFindings;
    }),
  );

  const findings: ReviewFinding[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      findings.push(...result.value);
    } else {
      const { plugin } = activePlugins[i];
      logger.warning(
        `Plugin "${plugin.id}" failed (non-blocking): ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      );
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// present() helpers
// ---------------------------------------------------------------------------

interface TaggedSection {
  pluginId: string;
  markdown: string;
}

/** Canonical ordering for plugin sections. Plugins listed here appear first, in order. */
const PLUGIN_ORDER = ['summary', 'complexity', 'architectural'];

/** Reorder tagged sections: known plugins first (in PLUGIN_ORDER), then any extras. */
function reorderSections(sections: TaggedSection[]): string[] {
  const ordered: string[] = [];
  for (const id of PLUGIN_ORDER) {
    for (const section of sections) {
      if (section.pluginId === id) ordered.push(section.markdown);
    }
  }
  for (const section of sections) {
    if (!PLUGIN_ORDER.includes(section.pluginId)) {
      ordered.push(section.markdown);
    }
  }
  return ordered;
}

/**
 * Compose all plugin description fragments into a single "Lien Review" section
 * and update the PR description once. Returns null when there was nothing to
 * describe (no octokit/pr, or no plugin contributed a section) — distinct
 * from `false`, which means an update was actually attempted and failed (see
 * `updatePRDescription`'s own success/failure return).
 */
async function finalizeDescription(
  descriptionParts: Map<string, string>,
  octokit: Octokit | undefined,
  pr: PRContext | undefined,
  logger: Logger,
): Promise<boolean | null> {
  if (!octokit || !pr || descriptionParts.size === 0) return null;

  const ordered: string[] = [];
  for (const id of PLUGIN_ORDER) {
    const part = descriptionParts.get(id);
    if (part) ordered.push(part);
  }
  for (const [id, part] of descriptionParts) {
    if (!PLUGIN_ORDER.includes(id)) ordered.push(part);
  }

  const body = ordered.join('\n\n');
  const markdown = `### Lien Review\n\n${body}`;

  return updatePRDescription(octokit, pr, markdown, logger);
}

async function ensureCheckRun(
  octokit: Octokit | undefined,
  pr: PRContext | undefined,
  existingId: number | undefined,
  logger: Logger,
): Promise<number | undefined> {
  if (existingId || !octokit || !pr) return existingId;
  return createCheckRun(
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
  ).catch(err => {
    logger.warning(`Failed to create check run: ${err instanceof Error ? err.message : err}`);
    return undefined;
  });
}

async function dispatchPresent(
  plugins: ReviewPlugin[],
  pluginFilter: string | undefined,
  findings: ReviewFinding[],
  presentContext: PresentContext,
  summarySections: TaggedSection[],
  logger: Logger,
): Promise<void> {
  const active = pluginFilter ? plugins.filter(p => p.id === pluginFilter) : plugins;
  for (const plugin of active) {
    if (!plugin.present) continue;
    const pluginFindings = findings.filter(f => f.pluginId === plugin.id);
    // Wrap appendSummary to tag entries with the plugin ID
    const ctx: PresentContext = {
      ...presentContext,
      appendSummary: (markdown: string) => summarySections.push({ pluginId: plugin.id, markdown }),
    };
    try {
      await plugin.present(pluginFindings, ctx);
    } catch (error) {
      logger.warning(
        `Plugin "${plugin.id}" present() failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function finalizePresentation(
  octokit: Octokit,
  pr: PRContext,
  checkRunId: number,
  findings: ReviewFinding[],
  summarySections: TaggedSection[],
  pendingAnnotations: CheckAnnotation[],
  debugLog: string[],
  logger: Logger,
): Promise<{ conclusion: 'success' | 'failure' | 'neutral'; summary: string }> {
  const conclusion = determineConclusion(findings);
  const title = buildCheckTitle(findings);
  const ordered = reorderSections(summarySections);
  const summary = ordered.length > 0 ? ordered.join('\n\n') : buildCheckSummary(findings);
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
  ).catch(err =>
    logger.warning(`Failed to finalize check run: ${err instanceof Error ? err.message : err}`),
  );
  return { conclusion, summary };
}

// ---------------------------------------------------------------------------
// PresentContext Builder
// ---------------------------------------------------------------------------

/** Wrap `postPluginInlineComments` to also accumulate its outcome into the delivery tracker. */
function createPostInlineComments(
  octokit: Octokit,
  pr: PRContext,
  logger: Logger,
  deliveryTracker: DeliveryTracker,
): NonNullable<PresentContext['postInlineComments']> {
  return async (findings, summaryBody) => {
    const result = await postPluginInlineComments(octokit, pr, findings, summaryBody, logger);
    deliveryTracker.inlineComments.attempted += result.attempted;
    deliveryTracker.inlineComments.posted += result.posted;
    deliveryTracker.inlineComments.dropped += result.dropped;
    deliveryTracker.inlineComments.deduped += result.deduped;
    return result;
  };
}

/** Wrap the out-of-diff review-comment post so its success/failure reaches the delivery tracker. */
function createPostReviewComment(
  octokit: Octokit,
  pr: PRContext,
  logger: Logger,
  deliveryTracker: DeliveryTracker,
): NonNullable<PresentContext['postReviewComment']> {
  return async body => {
    try {
      await postPRReview(octokit, pr, [], body, logger, 'COMMENT');
      deliveryTracker.outOfDiffReviewPosted = true;
      return { posted: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warning(`Failed to post out-of-diff review comment: ${message}`);
      deliveryTracker.outOfDiffReviewPosted = false;
      return { posted: false, error: message };
    }
  };
}

function buildPresentContext(
  adapterContext: AdapterContext,
  octokit: Octokit | undefined,
  pr: PRContext | undefined,
  pendingAnnotations: CheckAnnotation[],
  summarySections: TaggedSection[],
  descriptionParts: Map<string, string>,
  debugLog: string[],
  deliveryTracker: DeliveryTracker,
): PresentContext {
  const logger = adapterContext.logger;
  const debugLogger = createDebugCapturingLogger(logger, debugLog);
  return {
    complexityReport: adapterContext.complexityReport,
    baselineReport: adapterContext.baselineReport,
    deltas: adapterContext.deltas,
    deltaSummary: adapterContext.deltaSummary,
    pr: adapterContext.pr,
    logger: debugLogger,
    llmUsage: adapterContext.llmUsage,
    model: adapterContext.model,
    addAnnotations: annotations => pendingAnnotations.push(...annotations),
    appendSummary: (markdown: string) => summarySections.push({ pluginId: 'unknown', markdown }),
    appendDescription: (markdown: string, pluginId: string) =>
      descriptionParts.set(pluginId, markdown),
    updateDescription:
      octokit && pr
        ? async (markdown: string, sectionId?: string) => {
            await updatePRDescription(octokit, pr, markdown, logger, sectionId);
          }
        : undefined,
    postInlineComments:
      octokit && pr ? createPostInlineComments(octokit, pr, logger, deliveryTracker) : undefined,
    postReviewComment:
      octokit && pr ? createPostReviewComment(octokit, pr, logger, deliveryTracker) : undefined,
    minimizeOutdatedComments:
      octokit && pr ? marker => minimizeOutdatedComments(octokit, pr, marker, logger) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Inline Comment Posting
// ---------------------------------------------------------------------------

/**
 * Ground truth for one `postInlineComments` call, feeding both the
 * plugin-facing `{posted, skipped}` contract and the delivery attestation.
 * Invariant: `attempted === posted + dropped + deduped`.
 */
interface InlinePostOutcome {
  posted: number;
  skipped: number;
  attempted: number;
  dropped: number;
  deduped: number;
}

async function postPluginInlineComments(
  octokit: Octokit,
  pr: PRContext,
  findings: ReviewFinding[],
  summaryBody: string,
  logger: Logger,
): Promise<InlinePostOutcome> {
  const attempted = findings.length;
  if (attempted === 0) return { posted: 0, skipped: 0, attempted: 0, dropped: 0, deduped: 0 };

  const pluginId = findings[0].pluginId;
  if (findings.some(f => f.pluginId !== pluginId)) {
    logger.warning(
      `postInlineComments: mixed pluginIds in findings, skipping to avoid mis-attribution`,
    );
    return { posted: 0, skipped: attempted, attempted, dropped: attempted, deduped: 0 };
  }

  const markerPrefix = `${PLUGIN_MARKER_PREFIX}${pluginId}:`;

  const diffResult = await filterToDiffLines(octokit, pr, findings, logger);
  if (!diffResult) {
    logger.info(
      `postInlineComments(${pluginId}): posting 0 of ${attempted} finding(s) ` +
        `(diff fetch failed — see warning above)`,
    );
    return { posted: 0, skipped: attempted, attempted, dropped: attempted, deduped: 0 };
  }

  const { inDiff, outOfDiffCount } = diffResult;

  let toPost: LineComment[] = [];
  let dedupSkipped = 0;
  if (inDiff.length > 0) {
    const comments: LineComment[] = inDiff.map(f => ({
      path: f.filepath,
      line: f.line,
      body: buildPluginCommentBody(f, markerPrefix),
    }));

    ({ toPost, dedupSkipped } = await deduplicateComments(
      octokit,
      pr,
      pluginId,
      comments,
      markerPrefix,
      logger,
    ));
  }

  const skipped = outOfDiffCount + dedupSkipped;
  logger.info(
    `postInlineComments(${pluginId}): posting ${toPost.length} of ${attempted} finding(s) ` +
      `(${outOfDiffCount} outside diff, ${dedupSkipped} already commented)`,
  );
  if (toPost.length === 0) {
    return { posted: 0, skipped, attempted, dropped: outOfDiffCount, deduped: dedupSkipped };
  }

  const { posted, dropped } = await postPRReview(
    octokit,
    pr,
    toPost,
    summaryBody,
    logger,
    'COMMENT',
  );
  return {
    posted,
    skipped: skipped + dropped.length,
    attempted,
    dropped: outOfDiffCount + dropped.length,
    deduped: dedupSkipped,
  };
}

/** Fetch diff lines and filter findings to those within the diff. Returns null on API failure. */
async function filterToDiffLines(
  octokit: Octokit,
  pr: PRContext,
  findings: ReviewFinding[],
  logger: Logger,
): Promise<{ inDiff: ReviewFinding[]; outOfDiffCount: number } | null> {
  let diffLines: Map<string, Set<number>>;
  try {
    diffLines = await getPRDiffLines(octokit, pr);
  } catch (error) {
    logger.warning(`postInlineComments: failed to get diff lines: ${error}`);
    return null;
  }
  const inDiff = findings.filter(f => diffLines.get(f.filepath)?.has(f.line));
  return { inDiff, outOfDiffCount: findings.length - inDiff.length };
}

/** Filter out comments already posted in a previous run. Falls back to posting all on API failure. */
async function deduplicateComments(
  octokit: Octokit,
  pr: PRContext,
  pluginId: string,
  comments: LineComment[],
  markerPrefix: string,
  logger: Logger,
): Promise<{ toPost: LineComment[]; dedupSkipped: number }> {
  try {
    const existingKeys = await getExistingPluginCommentKeys(octokit, pr, pluginId, logger);
    let dedupSkipped = 0;
    const toPost = comments.filter(c => {
      const key = extractPluginCommentKey(c.body, markerPrefix);
      if (key && isDuplicateOfExistingComment(key, existingKeys)) {
        dedupSkipped++;
        return false;
      }
      return true;
    });
    return { toPost, dedupSkipped };
  } catch (error) {
    logger.warning(`postInlineComments: failed to fetch existing ${pluginId} comments: ${error}`);
    return { toPost: comments, dedupSkipped: 0 };
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
  const hasNewErrors = findings.some(f => {
    if (f.severity !== 'error') return false;
    // For complexity findings, only block if the PR introduced or worsened the violation
    // (positive delta). Pre-existing violations in touched files should not block merges.
    if (f.pluginId === 'complexity') {
      const meta = f.metadata as { delta?: number | null };
      return meta.delta != null && meta.delta > 0;
    }
    return true;
  });
  if (hasNewErrors) return 'failure';
  if (findings.some(f => f.severity === 'error' || f.severity === 'warning')) return 'neutral';
  return 'success';
}

/** Count errors/warnings and group by plugin in a single pass. */
function analyzeFindings(findings: ReviewFinding[]): {
  errorCount: number;
  warningCount: number;
  byPlugin: Map<string, number>;
} {
  const byPlugin = new Map<string, number>();
  let errorCount = 0;
  let warningCount = 0;
  for (const f of findings) {
    if (f.severity === 'error') errorCount++;
    else if (f.severity === 'warning') warningCount++;
    byPlugin.set(f.pluginId, (byPlugin.get(f.pluginId) ?? 0) + 1);
  }
  return { errorCount, warningCount, byPlugin };
}

/**
 * Build a short check run title.
 */
function buildCheckTitle(findings: ReviewFinding[]): string {
  if (findings.length === 0) return 'No issues found';
  const { errorCount, warningCount } = analyzeFindings(findings);
  const parts: string[] = [];
  if (errorCount > 0) parts.push(`${errorCount} error${errorCount === 1 ? '' : 's'}`);
  if (warningCount > 0) parts.push(`${warningCount} warning${warningCount === 1 ? '' : 's'}`);
  if (parts.length === 0)
    parts.push(`${findings.length} finding${findings.length === 1 ? '' : 's'}`);
  return parts.join(', ');
}

/**
 * Build check run summary markdown.
 */
function buildCheckSummary(findings: ReviewFinding[]): string {
  if (findings.length === 0) return 'All checks passed.';
  const { byPlugin } = analyzeFindings(findings);
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

// ---------------------------------------------------------------------------
// postInlineComments Helpers
// ---------------------------------------------------------------------------

/**
 * Build a generic inline comment body for a finding.
 * Embeds a dedup marker so re-runs don't re-post the same comment.
 */
function buildPluginCommentBody(f: ReviewFinding, markerPrefix: string): string {
  const key = `${f.filepath}::${f.line}::${f.category}`;
  const marker = `${markerPrefix}${key} -->`;
  const severityEmoji = f.severity === 'error' ? '🔴' : f.severity === 'warning' ? '🟡' : 'ℹ️';
  const symbolRef = f.symbolName ? ` in \`${f.symbolName}\`` : '';
  const suggestionLine = f.suggestion ? `\n\n💡 *${f.suggestion}*` : '';
  return `${marker}\n${severityEmoji} **${f.category.replace(/_/g, ' ')}**${symbolRef}\n\n${f.message}${suggestionLine}`;
}

/** Extract the dedup key from a comment body, or null if not present. */
function extractPluginCommentKey(body: string, markerPrefix: string): string | null {
  const start = body.indexOf(markerPrefix);
  if (start === -1) return null;
  const keyStart = start + markerPrefix.length;
  const end = body.indexOf(' -->', keyStart);
  if (end === -1) return null;
  return body.slice(keyStart, end);
}

/**
 * Line drift tolerance when matching a finding against an existing comment's
 * dedup key. Agent line attribution drifts between runs on unchanged code
 * (observed on PR #667: the same chunksCreated finding was posted at lines
 * 461, 483, and 486 by three consecutive runs), so exact-line keys re-post
 * near-duplicates. Same file + same category within this many lines counts
 * as the same finding.
 *
 * Deliberate tradeoff: two genuinely distinct same-category findings within
 * this window in one file are collapsed into one comment. That costs less
 * than re-posting the same finding on every run — the surviving comment
 * still points a reviewer at the right region.
 */
export const DEDUP_LINE_TOLERANCE = 30;

interface PluginCommentKey {
  filepath: string;
  line: number;
  category: string;
}

/** Parse a `filepath::line::category` dedup key. Null if malformed. */
export function parsePluginCommentKey(key: string): PluginCommentKey | null {
  const parts = key.split('::');
  if (parts.length < 3) return null;
  const category = parts[parts.length - 1];
  const line = Number(parts[parts.length - 2]);
  const filepath = parts.slice(0, -2).join('::');
  if (!filepath || !category || !Number.isInteger(line)) return null;
  return { filepath, line, category };
}

/**
 * True if a candidate dedup key matches an existing comment's key exactly,
 * or matches one on the same file + category within DEDUP_LINE_TOLERANCE
 * lines (line-drift tolerant dedup).
 */
export function isDuplicateOfExistingComment(
  candidateKey: string,
  existingKeys: ReadonlySet<string>,
  tolerance: number = DEDUP_LINE_TOLERANCE,
): boolean {
  if (existingKeys.has(candidateKey)) return true;

  const candidate = parsePluginCommentKey(candidateKey);
  if (!candidate) return false;

  for (const existingKey of existingKeys) {
    const existing = parsePluginCommentKey(existingKey);
    if (!existing) continue;
    if (
      existing.filepath === candidate.filepath &&
      existing.category === candidate.category &&
      Math.abs(existing.line - candidate.line) <= tolerance
    ) {
      return true;
    }
  }
  return false;
}
