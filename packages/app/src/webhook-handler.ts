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
  createCheckRun,
  updateCheckRun,
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
} from '@liendev/review';

import { cloneRepo, cloneBase, type CloneResult } from './clone.js';
import type { AppConfig } from './config.js';

interface PRWebhookPayload {
  action: string;
  number: number;
  pull_request: {
    number: number;
    title: string;
    body: string | null;
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
      body: pr.body ?? undefined,
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
      enableLogicReview: true,
      logicReviewCategories: ['breaking_change', 'unchecked_return', 'missing_tests'],
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

  const checkRunId = await createInitialCheckRun(octokit, prContext, logger);

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
    if (!analysis) {
      await finalizeCheckRunSkipped(octokit, prContext, checkRunId, logger);
      return;
    }

    baseClone = analysis.baseClone;
    await runAndPresent(
      setupEngine(),
      analysis.result,
      reviewConfig,
      prContext,
      octokit,
      checkRunId,
      logger,
    );
  } finally {
    // Cleanup independently so one failure doesn't prevent the other
    if (headClone) await headClone.cleanup().catch(() => {});
    if (baseClone) await baseClone.cleanup().catch(() => {});
  }
}

/** Create the initial in_progress check run. Returns undefined if creation fails. */
async function createInitialCheckRun(
  octokit: ReturnType<typeof createOctokit>,
  prContext: PRContext,
  logger: Logger,
): Promise<number | undefined> {
  try {
    return await createCheckRun(
      octokit,
      {
        owner: prContext.owner,
        repo: prContext.repo,
        name: 'Lien Review',
        headSha: prContext.headSha,
        status: 'in_progress',
        output: { title: 'Running...', summary: 'Analysis in progress' },
      },
      logger,
    );
  } catch (error) {
    logger.warning(
      `Failed to create check run: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

/** Finalize check run when no analyzable files were found. */
async function finalizeCheckRunSkipped(
  octokit: ReturnType<typeof createOctokit>,
  prContext: PRContext,
  checkRunId: number | undefined,
  logger: Logger,
): Promise<void> {
  if (!checkRunId) return;
  await updateCheckRun(
    octokit,
    {
      owner: prContext.owner,
      repo: prContext.repo,
      checkRunId,
      status: 'completed',
      conclusion: 'success',
      output: {
        title: 'No code files changed',
        summary: 'No files eligible for complexity analysis in this PR.',
      },
    },
    logger,
  ).catch(err => logger.warning(`Failed to finalize check run: ${err}`));
}

/** Run analysis findings through the engine and post results via present() hooks. */
async function runAndPresent(
  engine: ReturnType<typeof setupEngine>,
  result: AnalysisResult,
  reviewConfig: ReviewConfig,
  prContext: PRContext,
  octokit: ReturnType<typeof createOctokit>,
  checkRunId: number | undefined,
  logger: Logger,
): Promise<void> {
  const llm = buildLLMClient(reviewConfig, logger);
  const findings = await engine.run(
    buildReviewContext(result, reviewConfig, prContext, llm, logger),
  );
  logger.info(`Engine produced ${findings.length} total findings`);

  const adapterContext = buildAdapterContext(result, prContext, octokit, llm, reviewConfig, logger);

  try {
    await engine.present(findings, adapterContext, { checkRunId });
  } catch (error) {
    logger.error(
      `engine.present() failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    await finalizeFailedCheckRun(octokit, prContext, checkRunId, error, logger);
  }
}

/** Finalize check run with action_required when engine.present() throws. */
async function finalizeFailedCheckRun(
  octokit: ReturnType<typeof createOctokit>,
  prContext: PRContext,
  checkRunId: number | undefined,
  error: unknown,
  logger: Logger,
): Promise<void> {
  if (!checkRunId) return;
  await updateCheckRun(
    octokit,
    {
      owner: prContext.owner,
      repo: prContext.repo,
      checkRunId,
      status: 'completed',
      conclusion: 'action_required',
      output: {
        title: 'Review failed',
        summary: `An error occurred during review: ${error instanceof Error ? error.message : String(error)}`,
      },
    },
    logger,
  ).catch(err => logger.warning(`Failed to finalize check run after error: ${err}`));
}

function buildLLMClient(config: ReviewConfig, logger: Logger) {
  return config.openrouterApiKey
    ? new OpenRouterLLMClient({ apiKey: config.openrouterApiKey, model: config.model, logger })
    : undefined;
}

function setupEngine() {
  const engine = new ReviewEngine();
  engine.register(new ComplexityPlugin());
  engine.register(new LogicPlugin());
  engine.register(new ArchitecturalPlugin());
  return engine;
}

function buildReviewContext(
  result: AnalysisResult,
  config: ReviewConfig,
  pr: PRContext,
  llm: ReturnType<typeof buildLLMClient>,
  logger: Logger,
) {
  return {
    chunks: result.chunks,
    changedFiles: result.filesToAnalyze,
    complexityReport: result.currentReport,
    baselineReport: result.baselineReport,
    deltas: result.deltas,
    pluginConfigs: {
      complexity: {
        threshold: parseInt(config.threshold, 10),
        blockOnNewErrors: config.blockOnNewErrors,
      },
      architectural: { mode: config.enableArchitecturalReview },
    },
    config: {},
    llm,
    pr,
    logger,
  };
}

function buildAdapterContext(
  result: AnalysisResult,
  pr: PRContext,
  octokit: ReturnType<typeof createOctokit>,
  llm: ReturnType<typeof buildLLMClient>,
  config: ReviewConfig,
  logger: Logger,
) {
  return {
    complexityReport: result.currentReport,
    baselineReport: result.baselineReport,
    deltas: result.deltas,
    deltaSummary: result.deltas ? calculateDeltaSummary(result.deltas) : null,
    pr,
    octokit,
    logger,
    llmUsage: llm?.getUsage(),
    model: config.model,
    blockOnNewErrors: config.blockOnNewErrors,
  };
}
