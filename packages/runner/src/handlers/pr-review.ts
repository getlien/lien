/**
 * PR review handler — processes reviews.pr NATS jobs.
 *
 * Flow: clone head → analyze → clone base → deltas → engine.run → engine.present → POST result
 */

import { createHash } from 'node:crypto';

import {
  type PRContext,
  type Logger,
  type ReviewFinding,
  type ComplexityReport,
  type ComplexityDelta,
  type AdapterContext,
  createOctokit,
  createCheckRun,
  updateCheckRun,
  runComplexityAnalysis,
  filterAnalyzableFiles,
  enrichWithTestAssociations,
  getPRChangedFiles,
  getPRPatchData,
  calculateDeltas,
  calculateDeltaSummary,
  ReviewEngine,
  ComplexityPlugin,
  AgentReviewPlugin,
} from '@liendev/review';
import type { CodeChunk } from '@liendev/parser';
import { performChunkOnlyIndex, analyzeComplexityFromChunks } from '@liendev/parser';

import type {
  PRJobPayload,
  ReviewRunResult,
  ComplexitySnapshotResult,
  ReviewCommentResult,
} from '../types.js';
import type { RunnerConfig } from '../config.js';
import { cloneBySha, resolveCommitTimestamp, type CloneResult } from '../clone.js';
import { postReviewRunResult, postReviewRunStatus } from '../api-client.js';
import { LogBuffer } from '../log-buffer.js';

export async function handlePRReview(
  payload: PRJobPayload,
  config: RunnerConfig,
  logger: Logger,
): Promise<void> {
  const startedAt = new Date().toISOString();
  const { repository, pull_request: pr, auth } = payload;

  const prContext: PRContext = {
    owner: repository.full_name.split('/')[0],
    repo: repository.full_name.split('/')[1],
    pullNumber: pr.number,
    title: pr.title,
    body: pr.body ?? undefined,
    baseSha: pr.base_sha,
    headSha: pr.head_sha,
  };

  const reviewConfig = {
    threshold: payload.config.threshold,
    blockOnNewErrors: payload.config.block_on_new_errors,
  };

  const reviewRunId = payload.review_run_id ?? null;
  const logBuffer =
    reviewRunId != null
      ? new LogBuffer(config.laravelApiUrl, auth.service_token, reviewRunId, logger)
      : null;

  const octokit = createOctokit(auth.installation_token);
  logger.info(`Processing PR #${pr.number} on ${repository.full_name}`);

  // Skip stale jobs — if a newer push exists for this PR, don't process the old one
  const isStale = await checkIfStale(octokit, prContext, pr.head_sha, logger);
  if (isStale) {
    // Mark the check run as cancelled so GitHub shows it was superseded
    if (payload.check_run_id) {
      await updateCheckRun(
        octokit,
        {
          owner: prContext.owner,
          repo: prContext.repo,
          checkRunId: payload.check_run_id,
          status: 'completed',
          conclusion: 'cancelled',
          output: {
            title: 'Superseded',
            summary: 'Skipped — a newer commit was pushed to this PR.',
          },
        },
        logger,
      ).catch(() => {}); // best-effort
    }
    if (reviewRunId != null) {
      await postReviewRunStatus(
        config.laravelApiUrl,
        auth.service_token,
        reviewRunId,
        'completed',
        logger,
      );
    }
    logger.info(
      `Skipping stale job for PR #${pr.number} (sha ${pr.head_sha.slice(0, 7)} is no longer HEAD)`,
    );
    return;
  }

  const checkRunId = await resolveCheckRun(octokit, prContext, payload, reviewRunId, logger);

  // Transition platform review run to running
  if (reviewRunId != null) {
    await postReviewRunStatus(
      config.laravelApiUrl,
      auth.service_token,
      reviewRunId,
      'running',
      logger,
    );
  }

  let headClone: CloneResult | null = null;
  let baseClone: CloneResult | null = null;
  let findings: ReviewFinding[] = [];
  let filesAnalyzed = 0;
  let avgComplexity = 0;
  let maxComplexity = 0;
  let tokenUsage = 0;
  let cost = 0;
  let committedAt: string | null = null;

  try {
    // Clone head by SHA
    headClone = await cloneBySha(
      repository.full_name,
      pr.head_sha,
      auth.installation_token,
      logger,
    );
    logBuffer?.add('info', `Cloned head SHA ${pr.head_sha.slice(0, 7)}`);

    // Resolve commit timestamp for the graph timeline
    committedAt = await resolveCommitTimestamp(headClone.dir);

    // Get changed files from GitHub API
    const allChangedFiles = await getPRChangedFiles(octokit, prContext);
    logger.info(`Found ${allChangedFiles.length} changed files in PR`);

    const filesToAnalyze = filterAnalyzableFiles(allChangedFiles);
    logger.info(`${filesToAnalyze.length} files eligible for complexity analysis`);
    filesAnalyzed = filesToAnalyze.length;
    logBuffer?.add(
      'info',
      `Starting review for PR #${pr.number} (${allChangedFiles.length} files changed, ${filesToAnalyze.length} eligible)`,
    );

    const summaryEnabled = !!payload.config.review_types.summary;
    if (summaryEnabled) await tryFetchPRPatches(octokit, prContext, logger);

    if (filesToAnalyze.length === 0 && !summaryEnabled) {
      logger.info('No analyzable files — running full-repo complexity scan');
      const repoResult = await computeRepoComplexity(
        headClone.dir,
        payload.config.threshold,
        logger,
      );
      await finalizeCheckRunNoFiles(checkRunId, octokit, prContext, logger);
      await postResult(
        config,
        payload,
        startedAt,
        'completed',
        committedAt,
        filesAnalyzed,
        repoResult?.avgComplexity ?? 0,
        repoResult?.maxComplexity ?? 0,
        0,
        0,
        repoResult ? buildComplexitySnapshots(repoResult.report) : [],
        [],
        reviewRunId,
        logger,
        logBuffer,
      );
      return;
    }

    // Run complexity analysis (head+base when files analyzable, full-repo scan otherwise)
    const analysis = await runAnalysisPhase(
      filesToAnalyze,
      reviewConfig.threshold,
      headClone.dir,
      repository.full_name,
      pr.base_sha,
      auth.installation_token,
      logBuffer,
      logger,
    );
    if (!analysis) {
      await postResult(
        config,
        payload,
        startedAt,
        'failed',
        committedAt,
        filesAnalyzed,
        0,
        0,
        0,
        0,
        [],
        [],
        reviewRunId,
        logger,
        logBuffer,
      );
      return;
    }
    const { currentReport, chunks, baselineReport, deltas } = analysis;
    avgComplexity = analysis.avgComplexity;
    maxComplexity = analysis.maxComplexity;
    baseClone = analysis.baseClone;

    // Setup engine with enabled plugins
    const engine = new ReviewEngine();
    if (payload.config.review_types.complexity) engine.register(new ComplexityPlugin());
    if (config.openrouterApiKey || config.anthropicApiKey) engine.register(new AgentReviewPlugin());

    // Build a tee logger so plugin output is visible in platform run logs
    const engineLogger: Logger = logBuffer
      ? {
          info: (m: string) => {
            logger.info(m);
            logBuffer.add('info', m);
          },
          warning: (m: string) => {
            logger.warning(m);
            logBuffer.add('warning', m);
          },
          error: (m: string) => {
            logger.error(m);
            logBuffer.add('error', m);
          },
          debug: (m: string) => {
            logger.debug(m);
          },
        }
      : logger;

    // Track agent usage separately (reported via callback since it bypasses LLMClient)
    let agentUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 };

    // Selected model — used for both the agent-review plugin config and the
    // adapterContext below so cost/metadata reporting stays consistent across
    // the two providers we support.
    const selectedModel = selectAgentModel(!!config.openrouterApiKey);

    // Run engine
    findings = await engine.run({
      chunks,
      changedFiles: filesToAnalyze,
      allChangedFiles,
      complexityReport: currentReport,
      baselineReport,
      deltas,
      pluginConfigs: {
        complexity: {
          threshold: parseInt(reviewConfig.threshold, 10),
          blockOnNewErrors: reviewConfig.blockOnNewErrors,
        },
        'agent-review': {
          apiKey: config.openrouterApiKey || config.anthropicApiKey,
          provider: config.openrouterApiKey ? 'openai' : 'anthropic',
          model: selectedModel,
          baseUrl: config.openrouterApiKey ? 'https://openrouter.ai/api/v1' : undefined,
          inputCostPerMTok: config.openrouterApiKey ? 0.5 : 3,
          outputCostPerMTok: config.openrouterApiKey ? 3 : 15,
          ...scaleAgentBudget(filesToAnalyze.length, chunks),
        },
      },
      config: {},
      pr: prContext,
      logger: engineLogger,
      repoRootDir: headClone.dir,
      reportUsage: usage => {
        agentUsage = usage;
      },
    });
    logger.info(`Engine produced ${findings.length} total findings`);
    logBuffer?.add('info', `Engine produced ${findings.length} findings`);

    // Present via engine (posts check run + comments)
    const adapterContext = {
      complexityReport: currentReport,
      baselineReport,
      deltas,
      deltaSummary: deltas ? calculateDeltaSummary(deltas) : null,
      pr: prContext,
      octokit,
      logger,
      llmUsage: agentUsage.totalTokens > 0 ? agentUsage : undefined,
      model: selectedModel,
      blockOnNewErrors: reviewConfig.blockOnNewErrors,
    };

    await tryPresentFindings(
      engine,
      findings,
      adapterContext,
      checkRunId,
      octokit,
      prContext,
      logger,
    );

    // Collect usage stats from agent
    tokenUsage = agentUsage.totalTokens;
    cost = agentUsage.cost;

    // Build result arrays
    const complexitySnapshots = buildComplexitySnapshots(currentReport);
    const reviewComments = buildReviewComments(findings);

    logBuffer?.add(
      'info',
      `Review completed: ${filesAnalyzed} files analyzed, ${reviewComments.length} comments`,
    );

    await postResult(
      config,
      payload,
      startedAt,
      'completed',
      committedAt,
      filesAnalyzed,
      avgComplexity,
      maxComplexity,
      tokenUsage,
      cost,
      complexitySnapshots,
      reviewComments,
      reviewRunId,
      logger,
      logBuffer,
    );
  } catch (error) {
    logger.error(`PR review failed: ${error instanceof Error ? error.message : String(error)}`);
    logBuffer?.add(
      'error',
      `Review failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    try {
      await postResult(
        config,
        payload,
        startedAt,
        'failed',
        committedAt,
        filesAnalyzed,
        avgComplexity,
        maxComplexity,
        tokenUsage,
        cost,
        [],
        [],
        reviewRunId,
        logger,
        logBuffer,
      );
    } catch (postError) {
      logger.error(
        `Failed to post failure result: ${postError instanceof Error ? postError.message : String(postError)}`,
      );
    }
    throw error;
  } finally {
    if (logBuffer) await logBuffer.dispose().catch(() => {});
    if (headClone) await headClone.cleanup().catch(() => {});
    if (baseClone) await baseClone.cleanup().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Helpers

/**
 * Pick the agent-review model based on which provider key is configured.
 * Extracted so the conditional doesn't add cyclomatic weight to the (large)
 * handlePRReview body — and so the same value can be reused for the
 * adapterContext metadata.
 */
function selectAgentModel(useOpenRouter: boolean): string {
  return useOpenRouter ? 'google/gemini-3-flash-preview' : 'claude-sonnet-4-6';
}

/**
 * Scale agent turn count and token budget dynamically.
 *
 * Uses file count for turn scaling and estimated token count of the
 * changed code for budget scaling. The diff content is included in
 * the initial message, so the budget must accommodate it plus tool
 * calls and the final JSON output.
 */
function scaleAgentBudget(
  fileCount: number,
  chunks: { content: string }[],
): { maxTurns: number; maxTokenBudget: number } {
  // Estimate tokens in the changed code (~4 chars/token)
  const contentChars = chunks.reduce((sum, c) => sum + c.content.length, 0);
  const estimatedContentTokens = Math.ceil(contentChars / 4);

  // Budget breakdown:
  // - System prompt: ~3K tokens (XML tags, examples, three-phase instructions)
  // - Initial message: ~1K overhead + content tokens (diff, signatures, etc.)
  // - Tool results: ~8K per call (get_files_context returns full chunks)
  // - Final JSON output: ~2K
  // - Conversation growth: each turn re-sends everything
  const maxTurns = fileCount <= 3 ? 8 : fileCount <= 10 ? 10 : 15;
  const toolBudget = maxTurns * 8_000;
  const baseBudget = 4_000 + estimatedContentTokens + toolBudget + 2_000;

  // Clamp: minimum 60K (small PRs still need room), maximum 200K
  const maxTokenBudget = Math.min(Math.max(baseBudget, 60_000), 200_000);

  return { maxTurns, maxTokenBudget };
}
// ---------------------------------------------------------------------------

async function tryFetchPRPatches(
  octokit: ReturnType<typeof createOctokit>,
  prContext: PRContext,
  logger: Logger,
): Promise<void> {
  try {
    const patchData = await getPRPatchData(octokit, prContext);
    prContext.patches = patchData.patches;
    prContext.diffLines = patchData.diffLines;
  } catch (error) {
    logger.warning(
      `Failed to fetch PR patch data: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function tryEnrichTestAssociations(
  report: ComplexityReport,
  files: string[],
  dir: string,
  logger: Logger,
): Promise<void> {
  try {
    await enrichWithTestAssociations(report, files, dir, logger);
  } catch (error) {
    logger.warning(
      `Test association enrichment failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function finalizeCheckRunNoFiles(
  checkRunId: number | undefined,
  octokit: ReturnType<typeof createOctokit>,
  prContext: PRContext,
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
        summary: 'No files eligible for complexity analysis.',
      },
    },
    logger,
  ).catch(err => logger.warning(`Failed to finalize check run: ${err}`));
}

export interface AnalysisPhaseResult {
  currentReport: ComplexityReport;
  chunks: CodeChunk[];
  avgComplexity: number;
  maxComplexity: number;
  baselineReport: ComplexityReport | null;
  deltas: ComplexityDelta[] | null;
  baseClone: CloneResult | null;
}

export async function runAnalysisPhase(
  filesToAnalyze: string[],
  threshold: string,
  headCloneDir: string,
  repoFullName: string,
  baseSha: string,
  installationToken: string,
  logBuffer: LogBuffer | null,
  logger: Logger,
): Promise<AnalysisPhaseResult | null> {
  if (filesToAnalyze.length > 0) {
    const headResult = await runComplexityAnalysis(filesToAnalyze, threshold, headCloneDir, logger);
    if (!headResult) {
      logger.warning('Failed to get complexity report for head');
      return null;
    }

    const currentReport = headResult.report;
    const avgComplexity = currentReport.summary.avgComplexity;
    const maxComplexity = currentReport.summary.maxComplexity;
    logBuffer?.add(
      'info',
      `Head analysis complete: avg ${avgComplexity.toFixed(1)}, max ${maxComplexity}`,
    );

    await tryEnrichTestAssociations(currentReport, filesToAnalyze, headCloneDir, logger);

    let baseClone: CloneResult | null = null;
    let baselineReport: ComplexityReport | null = null;
    try {
      baseClone = await cloneBySha(repoFullName, baseSha, installationToken, logger);
      const baseResult = await runComplexityAnalysis(
        filesToAnalyze,
        threshold,
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
      currentReport,
      chunks: headResult.chunks,
      avgComplexity,
      maxComplexity,
      baselineReport,
      deltas,
      baseClone,
    };
  }

  // No complexity-analyzable files — run full-repo scan for summary-only path
  logger.info('No complexity-analyzable files — running full-repo scan + summary');
  logBuffer?.add('info', 'No complexity-analyzable files, running full-repo scan + summary');
  const repoResult = await computeRepoComplexity(headCloneDir, threshold, logger);
  if (repoResult) {
    return {
      currentReport: repoResult.report,
      chunks: [],
      avgComplexity: repoResult.avgComplexity,
      maxComplexity: repoResult.maxComplexity,
      baselineReport: null,
      deltas: null,
      baseClone: null,
    };
  }
  return {
    currentReport: {
      files: {},
      summary: {
        filesAnalyzed: 0,
        totalViolations: 0,
        bySeverity: { error: 0, warning: 0 },
        avgComplexity: 0,
        maxComplexity: 0,
      },
    },
    chunks: [],
    avgComplexity: 0,
    maxComplexity: 0,
    baselineReport: null,
    deltas: null,
    baseClone: null,
  };
}

export async function tryPresentFindings(
  engine: ReviewEngine,
  findings: ReviewFinding[],
  adapterContext: AdapterContext,
  checkRunId: number | undefined,
  octokit: ReturnType<typeof createOctokit>,
  prContext: PRContext,
  logger: Logger,
): Promise<void> {
  try {
    await engine.present(findings, adapterContext, { checkRunId });
  } catch (error) {
    logger.error(
      `engine.present() failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    if (checkRunId) {
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
            summary: `An error occurred: ${error instanceof Error ? error.message : String(error)}`,
          },
        },
        logger,
      ).catch(err => logger.warning(`Failed to finalize check run after error: ${err}`));
    }
  }
}

/**
 * Full-repo complexity scan on an already-cloned directory.
 * Used when a PR touches no analyzable files so we still report real scores.
 */
export async function computeRepoComplexity(
  cloneDir: string,
  threshold: string,
  _logger?: Logger,
): Promise<{ report: ComplexityReport; avgComplexity: number; maxComplexity: number } | null> {
  const indexResult = await performChunkOnlyIndex(cloneDir);
  if (!indexResult.success || !indexResult.chunks || indexResult.chunks.length === 0) {
    return null;
  }

  const thresholdNum = parseInt(threshold, 10);
  const report = analyzeComplexityFromChunks(
    indexResult.chunks,
    [...new Set(indexResult.chunks.map(c => c.metadata.file))],
    !isNaN(thresholdNum) ? { testPaths: thresholdNum, mentalLoad: thresholdNum } : undefined,
  );

  return {
    report,
    avgComplexity: report.summary.avgComplexity,
    maxComplexity: report.summary.maxComplexity,
  };
}

// ---------------------------------------------------------------------------
// Result Builders
// ---------------------------------------------------------------------------

function buildComplexitySnapshots(report: ComplexityReport): ComplexitySnapshotResult[] {
  const snapshots: ComplexitySnapshotResult[] = [];
  for (const [filepath, fileData] of Object.entries(report.files)) {
    for (const v of fileData.violations) {
      snapshots.push({
        filepath,
        symbol_name: v.symbolName,
        symbol_type: v.symbolType,
        start_line: v.startLine,
        metric_type: v.metricType,
        complexity: v.complexity,
        threshold: v.threshold,
        severity: v.severity,
      });
    }
  }
  return snapshots;
}

function buildReviewComments(findings: ReviewFinding[]): ReviewCommentResult[] {
  return findings.map(f => ({
    filepath: f.filepath,
    line: f.line || null,
    end_line: f.endLine ?? null,
    symbol_name: f.symbolName ?? null,
    severity: f.severity,
    category: f.category,
    plugin_id: f.pluginId,
    message: f.message,
    suggestion: f.suggestion ?? null,
    status: 'posted',
  }));
}

async function resolveCheckRun(
  octokit: ReturnType<typeof createOctokit>,
  prContext: PRContext,
  payload: PRJobPayload,
  reviewRunId: number | null,
  logger: Logger,
): Promise<number | undefined> {
  if (payload.check_run_id) {
    // Platform created the check run — take ownership and transition to in_progress
    try {
      await updateCheckRun(
        octokit,
        {
          owner: prContext.owner,
          repo: prContext.repo,
          checkRunId: payload.check_run_id,
          status: 'in_progress',
          output: { title: 'Running...', summary: 'Analysis in progress' },
        },
        logger,
      );
    } catch (error) {
      logger.warning(
        `Failed to update check run to in_progress: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return payload.check_run_id;
  }

  if (reviewRunId != null) {
    // review_run_id set but no check_run_id — fall back to creating our own
    logger.warning(
      'review_run_id provided without check_run_id — creating a managed check run locally',
    );
  }

  // Create our own check run (standalone mode or platform fallback)
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

/**
 * Check if a job is stale by comparing its head SHA against the PR's current HEAD.
 * If the PR has a newer commit, this job is outdated and should be skipped.
 */
async function checkIfStale(
  octokit: ReturnType<typeof createOctokit>,
  prContext: PRContext,
  jobHeadSha: string,
  logger: Logger,
): Promise<boolean> {
  try {
    const { data: pr } = await octokit.rest.pulls.get({
      owner: prContext.owner,
      repo: prContext.repo,
      pull_number: prContext.pullNumber,
    });
    const currentHeadSha = pr.head.sha;
    if (currentHeadSha !== jobHeadSha) {
      logger.info(
        `Job SHA ${jobHeadSha.slice(0, 7)} differs from PR HEAD ${currentHeadSha.slice(0, 7)} — stale`,
      );
      return true;
    }
    return false;
  } catch (error) {
    // If we can't check, proceed with the job (don't block on API errors)
    logger.warning(
      `Failed to check PR staleness: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

function buildIdempotencyKey(
  repoId: number,
  prNumber: number,
  headSha: string,
  configHash: string,
): string {
  return createHash('sha256')
    .update(`${repoId}:${prNumber}:${headSha}:${configHash}`)
    .digest('hex');
}

async function postResult(
  config: RunnerConfig,
  payload: PRJobPayload,
  startedAt: string,
  status: 'completed' | 'failed',
  committedAt: string | null,
  filesAnalyzed: number,
  avgComplexity: number,
  maxComplexity: number,
  tokenUsage: number,
  cost: number,
  complexitySnapshots: ComplexitySnapshotResult[],
  reviewComments: ReviewCommentResult[],
  reviewRunId: number | null,
  logger: Logger,
  logBuffer?: LogBuffer | null,
): Promise<void> {
  const configHash = createHash('sha256')
    .update(JSON.stringify(payload.config))
    .digest('hex')
    .slice(0, 16);

  const result: ReviewRunResult = {
    ...(reviewRunId != null ? { review_run_id: reviewRunId } : {}),
    idempotency_key: buildIdempotencyKey(
      payload.repository.id,
      payload.pull_request.number,
      payload.pull_request.head_sha,
      configHash,
    ),
    repo_id: payload.repository.id,
    pr_number: payload.pull_request.number,
    head_sha: payload.pull_request.head_sha,
    committed_at: committedAt,
    base_sha: payload.pull_request.base_sha,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    status,
    files_analyzed: filesAnalyzed,
    avg_complexity: avgComplexity,
    max_complexity: maxComplexity,
    token_usage: tokenUsage,
    cost,
    summary_comment_id: null,
    complexity_snapshots: complexitySnapshots,
    review_comments: reviewComments,
  };

  const posted = await postReviewRunResult(
    config.laravelApiUrl,
    payload.auth.service_token,
    result,
    logger,
  );
  if (!posted) {
    const errorMsg = `Platform callback failed — ${reviewComments.length} review comments not persisted`;
    logger.error(errorMsg);
    logBuffer?.add('error', errorMsg);
  }

  // Transition platform review run to terminal state (running → completed/failed)
  if (reviewRunId != null) {
    await postReviewRunStatus(
      config.laravelApiUrl,
      payload.auth.service_token,
      reviewRunId,
      status,
      logger,
    );
  }
}
