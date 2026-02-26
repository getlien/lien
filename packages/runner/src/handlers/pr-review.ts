/**
 * PR review handler — processes reviews.pr NATS jobs.
 *
 * Flow: clone head → analyze → clone base → deltas → engine.run → engine.present → POST result
 */

import { createHash } from 'node:crypto';

import {
  type PRContext,
  type ReviewConfig,
  type Logger,
  type ReviewFinding,
  createOctokit,
  createCheckRun,
  updateCheckRun,
  runComplexityAnalysis,
  filterAnalyzableFiles,
  getPRChangedFiles,
  calculateDeltas,
  calculateDeltaSummary,
  ReviewEngine,
  ComplexityPlugin,
  LogicPlugin,
  ArchitecturalPlugin,
  OpenRouterLLMClient,
} from '@liendev/review';

import type {
  PRJobPayload,
  ReviewRunResult,
  ComplexitySnapshotResult,
  ReviewCommentResult,
  LogicFindingResult,
} from '../types.js';
import type { RunnerConfig } from '../config.js';
import { cloneBySha, type CloneResult } from '../clone.js';
import { postReviewRunResult } from '../api-client.js';

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

  const reviewConfig: ReviewConfig = {
    openrouterApiKey: config.openrouterApiKey,
    model: config.openrouterModel,
    threshold: payload.config.threshold,
    enableDeltaTracking: true,
    baselineComplexityPath: '',
    blockOnNewErrors: payload.config.block_on_new_errors,
    enableLogicReview: payload.config.review_types.logic,
    logicReviewCategories: ['breaking_change', 'unchecked_return', 'missing_tests'],
    enableArchitecturalReview: payload.config.architectural_mode,
    archReviewCategories: [],
  };

  const octokit = createOctokit(auth.installation_token);
  logger.info(`Processing PR #${pr.number} on ${repository.full_name}`);

  // Create initial check run
  let checkRunId: number | undefined;
  try {
    checkRunId = await createCheckRun(
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
  }

  let headClone: CloneResult | null = null;
  let baseClone: CloneResult | null = null;
  let findings: ReviewFinding[] = [];
  let filesAnalyzed = 0;
  let avgComplexity = 0;
  let maxComplexity = 0;
  let tokenUsage = 0;
  let cost = 0;

  try {
    // Clone head by SHA
    headClone = await cloneBySha(
      repository.full_name,
      pr.head_sha,
      auth.installation_token,
      logger,
    );

    // Get changed files from GitHub API
    const allChangedFiles = await getPRChangedFiles(octokit, prContext);
    logger.info(`Found ${allChangedFiles.length} changed files in PR`);

    const filesToAnalyze = filterAnalyzableFiles(allChangedFiles);
    logger.info(`${filesToAnalyze.length} files eligible for complexity analysis`);
    filesAnalyzed = filesToAnalyze.length;

    if (filesToAnalyze.length === 0) {
      logger.info('No analyzable files, skipping');
      if (checkRunId) {
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
      await postResult(
        config,
        payload,
        startedAt,
        'completed',
        filesAnalyzed,
        0,
        0,
        0,
        0,
        [],
        [],
        [],
        logger,
      );
      return;
    }

    // Analyze head
    const headResult = await runComplexityAnalysis(
      filesToAnalyze,
      reviewConfig.threshold,
      headClone.dir,
      logger,
    );
    if (!headResult) {
      logger.warning('Failed to get complexity report for head');
      await postResult(
        config,
        payload,
        startedAt,
        'failed',
        filesAnalyzed,
        0,
        0,
        0,
        0,
        [],
        [],
        [],
        logger,
      );
      return;
    }

    const { report: currentReport, chunks } = headResult;
    avgComplexity = currentReport.summary.avgComplexity;
    maxComplexity = currentReport.summary.maxComplexity;

    // Clone and analyze base for delta tracking
    let baselineReport = null;
    try {
      baseClone = await cloneBySha(
        repository.full_name,
        pr.base_sha,
        auth.installation_token,
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

    // Setup engine with enabled plugins
    const engine = new ReviewEngine();
    if (payload.config.review_types.complexity) engine.register(new ComplexityPlugin());
    if (payload.config.review_types.logic) engine.register(new LogicPlugin());
    if (payload.config.review_types.architectural) engine.register(new ArchitecturalPlugin());

    // Build LLM client
    const llm = reviewConfig.openrouterApiKey
      ? new OpenRouterLLMClient({
          apiKey: reviewConfig.openrouterApiKey,
          model: reviewConfig.model,
          logger,
        })
      : undefined;

    // Run engine
    findings = await engine.run({
      chunks,
      changedFiles: filesToAnalyze,
      complexityReport: currentReport,
      baselineReport,
      deltas,
      pluginConfigs: {
        complexity: {
          threshold: parseInt(reviewConfig.threshold, 10),
          blockOnNewErrors: reviewConfig.blockOnNewErrors,
        },
        architectural: { mode: reviewConfig.enableArchitecturalReview },
      },
      config: {},
      llm,
      pr: prContext,
      logger,
    });
    logger.info(`Engine produced ${findings.length} total findings`);

    // Present via engine (posts check run + comments)
    const adapterContext = {
      complexityReport: currentReport,
      baselineReport,
      deltas,
      deltaSummary: deltas ? calculateDeltaSummary(deltas) : null,
      pr: prContext,
      octokit,
      logger,
      llmUsage: llm?.getUsage(),
      model: reviewConfig.model,
      blockOnNewErrors: reviewConfig.blockOnNewErrors,
    };

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

    // Collect usage stats
    if (llm) {
      const usage = llm.getUsage();
      tokenUsage = usage.totalTokens;
      cost = usage.cost;
    }

    // Build result arrays
    const complexitySnapshots = buildComplexitySnapshots(currentReport);
    const reviewComments = buildReviewComments(findings);
    const logicFindings = buildLogicFindings(findings);

    await postResult(
      config,
      payload,
      startedAt,
      'completed',
      filesAnalyzed,
      avgComplexity,
      maxComplexity,
      tokenUsage,
      cost,
      complexitySnapshots,
      reviewComments,
      logicFindings,
      logger,
    );
  } catch (error) {
    logger.error(`PR review failed: ${error instanceof Error ? error.message : String(error)}`);
    try {
      await postResult(
        config,
        payload,
        startedAt,
        'failed',
        filesAnalyzed,
        avgComplexity,
        maxComplexity,
        tokenUsage,
        cost,
        [],
        [],
        [],
        logger,
      );
    } catch (postError) {
      logger.error(
        `Failed to post failure result: ${postError instanceof Error ? postError.message : String(postError)}`,
      );
    }
    throw error;
  } finally {
    if (headClone) await headClone.cleanup().catch(() => {});
    if (baseClone) await baseClone.cleanup().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Result Builders
// ---------------------------------------------------------------------------

import type { ComplexityReport } from '@liendev/review';

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
    line: f.line,
    end_line: f.endLine ?? null,
    symbol_name: f.symbolName ?? null,
    severity: f.severity,
    category: f.category,
    plugin_id: f.pluginId,
    message: f.message,
    suggestion: f.suggestion ?? null,
  }));
}

function buildLogicFindings(findings: ReviewFinding[]): LogicFindingResult[] {
  return findings
    .filter(f => f.pluginId === 'logic')
    .map(f => ({
      filepath: f.filepath,
      symbol_name: f.symbolName ?? '',
      line: f.line,
      category: f.category,
      severity: f.severity as 'error' | 'warning',
      message: f.message,
      evidence: f.evidence ?? '',
    }));
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
  filesAnalyzed: number,
  avgComplexity: number,
  maxComplexity: number,
  tokenUsage: number,
  cost: number,
  complexitySnapshots: ComplexitySnapshotResult[],
  reviewComments: ReviewCommentResult[],
  logicFindings: LogicFindingResult[],
  logger: Logger,
): Promise<void> {
  const configHash = createHash('sha256')
    .update(JSON.stringify(payload.config))
    .digest('hex')
    .slice(0, 16);

  const result: ReviewRunResult = {
    idempotency_key: buildIdempotencyKey(
      payload.repository.id,
      payload.pull_request.number,
      payload.pull_request.head_sha,
      configHash,
    ),
    repo_id: payload.repository.id,
    pr_number: payload.pull_request.number,
    head_sha: payload.pull_request.head_sha,
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
    logic_findings: logicFindings,
  };

  await postReviewRunResult(config.laravelApiUrl, payload.auth.service_token, result, logger);
}
