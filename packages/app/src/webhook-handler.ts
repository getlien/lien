/**
 * Webhook handler — receives PR events and orchestrates clone → analyze → post review.
 */

import {
  type PRContext,
  type ReviewConfig,
  type Logger,
  type AnalysisResult,
  consoleLogger,
  createOctokit,
  runComplexityAnalysis,
  filterAnalyzableFiles,
  getPRChangedFiles,
  calculateDeltas,
  calculateDeltaSummary,
  // New plugin architecture
  ReviewEngine,
  ComplexityPlugin,
  LogicPlugin,
  ArchitecturalPlugin,
  OpenRouterLLMClient,
  GitHubAdapter,
} from '@liendev/review';

import { cloneRepo, cloneBase, type CloneResult } from './clone.js';
import type { AppConfig } from './config.js';

interface PRWebhookPayload {
  action: string;
  number: number;
  pull_request: {
    number: number;
    title: string;
    head: { sha: string; ref: string };
    base: { sha: string; ref: string };
  };
  repository: {
    full_name: string;
    owner: { id: number; login: string };
    name: string;
  };
  installation?: { id: number };
}

/**
 * Build PRContext and ReviewConfig from webhook payload
 */
function buildContexts(
  payload: PRWebhookPayload,
  config: AppConfig,
): { prContext: PRContext; reviewConfig: ReviewConfig } {
  const { pull_request: pr, repository: repo } = payload;

  return {
    prContext: {
      owner: repo.owner.login,
      repo: repo.name,
      pullNumber: pr.number,
      title: pr.title,
      baseSha: pr.base.sha,
      headSha: pr.head.sha,
    },
    reviewConfig: {
      openrouterApiKey: config.openRouterApiKey,
      model: config.openRouterModel,
      threshold: '15',
      enableDeltaTracking: true,
      baselineComplexityPath: '',
      blockOnNewErrors: false,
      enableLogicReview: false,
      logicReviewCategories: [],
      enableArchitecturalReview: 'auto',
      archReviewCategories: [],
    },
  };
}

/**
 * Run analysis on head and base branches, return AnalysisResult
 */
async function runPRAnalysis(
  payload: PRWebhookPayload,
  octokit: ReturnType<typeof createOctokit>,
  token: string,
  reviewConfig: ReviewConfig,
  prContext: PRContext,
  headClone: CloneResult,
  logger: Logger,
): Promise<{ result: AnalysisResult; baseClone: CloneResult | null } | null> {
  const allChangedFiles = await getPRChangedFiles(octokit, prContext);
  logger.info(`Found ${allChangedFiles.length} changed files in PR`);

  const filesToAnalyze = filterAnalyzableFiles(allChangedFiles);
  logger.info(`${filesToAnalyze.length} files eligible for complexity analysis`);

  if (filesToAnalyze.length === 0) {
    logger.info('No analyzable files found, skipping review');
    return null;
  }

  const headResult = await runComplexityAnalysis(
    filesToAnalyze,
    reviewConfig.threshold,
    headClone.dir,
    logger,
  );

  if (!headResult) {
    logger.warning('Failed to get complexity report for head');
    return null;
  }

  const { report: currentReport, chunks } = headResult;

  // Clone and analyze base branch for delta tracking
  let baselineReport = null;
  let baseClone: CloneResult | null = null;
  try {
    baseClone = await cloneBase(
      payload.repository.full_name,
      payload.pull_request.base.ref,
      token,
      logger,
    );
    const baseResult = await runComplexityAnalysis(
      filesToAnalyze,
      reviewConfig.threshold,
      baseClone.dir,
      logger,
    );
    baselineReport = baseResult?.report ?? null;
  } catch (error) {
    logger.warning(
      `Failed to analyze base branch: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const deltas = baselineReport
    ? calculateDeltas(baselineReport, currentReport, filesToAnalyze)
    : null;

  return {
    result: { currentReport, baselineReport, deltas, filesToAnalyze, chunks },
    baseClone,
  };
}

/**
 * Handle a pull_request webhook event.
 * Clones the repo, runs analysis, posts review via the plugin engine, and cleans up.
 */
export async function handlePullRequest(
  payload: PRWebhookPayload,
  token: string,
  config: AppConfig,
  logger: Logger = consoleLogger,
): Promise<void> {
  if (payload.action !== 'opened' && payload.action !== 'synchronize') {
    logger.info(`Ignoring PR action: ${payload.action}`);
    return;
  }

  const { prContext, reviewConfig } = buildContexts(payload, config);
  const octokit = createOctokit(token);
  logger.info(
    `Processing PR #${prContext.pullNumber} (${payload.action}) on ${payload.repository.full_name}`,
  );

  let headClone: CloneResult | null = null;
  let baseClone: CloneResult | null = null;

  try {
    headClone = await cloneRepo(
      payload.repository.full_name,
      payload.pull_request.head.ref,
      token,
      logger,
    );

    const analysis = await runPRAnalysis(
      payload,
      octokit,
      token,
      reviewConfig,
      prContext,
      headClone,
      logger,
    );
    if (!analysis) return;

    baseClone = analysis.baseClone;
    const { result } = analysis;

    // Build LLM client if API key is available
    const llm = reviewConfig.openrouterApiKey
      ? new OpenRouterLLMClient({
          apiKey: reviewConfig.openrouterApiKey,
          model: reviewConfig.model,
          logger,
        })
      : undefined;

    // Create engine and register plugins
    const engine = new ReviewEngine();
    engine.register(new ComplexityPlugin());
    engine.register(new LogicPlugin());
    engine.register(new ArchitecturalPlugin());

    // Build review context
    const deltaSummary = result.deltas ? calculateDeltaSummary(result.deltas) : null;
    const reviewContext = {
      chunks: result.chunks,
      changedFiles: result.filesToAnalyze,
      complexityReport: result.currentReport,
      baselineReport: result.baselineReport,
      deltas: result.deltas,
      config: {
        // Complexity plugin config
        threshold: parseInt(reviewConfig.threshold, 10),
        blockOnNewErrors: reviewConfig.blockOnNewErrors,
        // Logic plugin config
        categories: reviewConfig.logicReviewCategories,
        // Architectural plugin config
        mode: reviewConfig.enableArchitecturalReview,
      },
      llm,
      pr: prContext,
      logger,
    };

    // Run all plugins
    const findings = await engine.run(reviewContext);
    logger.info(`Engine produced ${findings.length} total findings`);

    // Present via GitHub adapter
    const adapter = new GitHubAdapter();
    const adapterResult = await adapter.present(findings, {
      complexityReport: result.currentReport,
      baselineReport: result.baselineReport,
      deltas: result.deltas,
      deltaSummary,
      pr: prContext,
      octokit,
      logger,
      llmUsage: llm?.getUsage(),
      model: reviewConfig.model,
    });

    logger.info(
      `Review complete for PR #${prContext.pullNumber}: ${adapterResult.posted} posted, ${adapterResult.skipped} skipped`,
    );
  } finally {
    // Cleanup independently so one failure doesn't prevent the other
    if (headClone) await headClone.cleanup().catch(() => {});
    if (baseClone) await baseClone.cleanup().catch(() => {});
  }
}
