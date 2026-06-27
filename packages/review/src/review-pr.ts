/**
 * Transport-agnostic PR review core.
 *
 * `reviewPullRequest` clones the head (and optionally base) of a pull request,
 * runs complexity + agent review via {@link ReviewEngine}, posts a check run and
 * inline comments to GitHub, and returns a structured result. It carries no
 * platform/Laravel/NATS concerns — provider selection comes from `ctx.llm` and
 * all output goes straight to GitHub via octokit.
 *
 * Flow: clone head → analyze → clone base → deltas → engine.run → engine.present.
 */

import type {
  Octokit,
  PRContext,
  Logger,
  ReviewFinding,
  ComplexityReport,
  ComplexityDelta,
  AdapterContext,
} from './index.js';
import {
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
} from './index.js';
import type { CodeChunk } from '@liendev/parser';
import { performChunkOnlyIndex, analyzeComplexityFromChunks } from '@liendev/parser';

import { cloneBySha, type CloneResult } from './clone.js';

/**
 * LLM provider selection for the agent-review plugin. Either an OpenAI-compatible
 * provider (e.g. OpenRouter) with an explicit base URL, an Anthropic provider, or
 * `null` to skip agent review entirely (complexity-only).
 */
export type ReviewLLMConfig =
  | {
      provider: 'openai';
      apiKey: string;
      model: string;
      baseUrl: string;
      inputCostPerMTok: number;
      outputCostPerMTok: number;
    }
  | {
      provider: 'anthropic';
      apiKey: string;
      model: string;
      inputCostPerMTok: number;
      outputCostPerMTok: number;
    }
  | null;

export interface ReviewCoreContext {
  octokit: Octokit;
  pr: PRContext;
  /** event.pull_request.head.repo.full_name (fork-aware) — what we clone the head from. */
  headRepoFullName: string;
  /** GITHUB_REPOSITORY — what we clone the base from. */
  baseRepoFullName: string;
  /** GITHUB_TOKEN — used for both clone and GitHub API. */
  token: string;
  config: {
    threshold: string;
    blockOnNewErrors: boolean;
    reviewTypes: {
      complexity: boolean;
      summary?: boolean;
      architectural?: boolean;
      bugs?: boolean;
    };
  };
  llm: ReviewLLMConfig;
  /** Pre-created check run ID. If omitted, the core creates its own. */
  checkRunId?: number;
  logger: Logger;
}

export interface ReviewCoreResult {
  findings: ReviewFinding[];
  conclusion: 'success' | 'failure' | 'neutral';
  summaryMarkdown: string;
  filesAnalyzed: number;
  usage: { totalTokens: number; cost: number };
  /**
   * True when a GitHub write (check run or PR comment) was rejected with a 403.
   * On a fork `pull_request`, the built-in token is read-only, so every write
   * 403s and the findings never reach the PR. The core swallows these errors
   * internally (so a partial-permission failure never crashes the review), but
   * surfaces this flag so the caller can emit a single clear fork warning.
   */
  writeForbidden: boolean;
}

/** A GitHub write rejected because the token is read-only (HTTP 403). */
function isWriteForbidden(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as { status?: number }).status === 403;
}

export async function reviewPullRequest(ctx: ReviewCoreContext): Promise<ReviewCoreResult> {
  const { octokit, pr, token, logger } = ctx;

  logger.info(`Processing PR #${pr.pullNumber} on ${ctx.baseRepoFullName}`);

  const { checkRunId, writeForbidden } = await resolveCheckRun(ctx);

  let headClone: CloneResult | null = null;
  let baseClone: CloneResult | null = null;
  let findings: ReviewFinding[] = [];
  let filesAnalyzed = 0;
  let tokenUsage = 0;
  let cost = 0;

  try {
    // Clone head by SHA
    headClone = await cloneBySha(ctx.headRepoFullName, pr.headSha, token, logger);

    // Get changed files from GitHub API
    const allChangedFiles = await getPRChangedFiles(octokit, pr);
    logger.info(`Found ${allChangedFiles.length} changed files in PR`);

    const filesToAnalyze = filterAnalyzableFiles(allChangedFiles);
    logger.info(`${filesToAnalyze.length} files eligible for complexity analysis`);
    filesAnalyzed = filesToAnalyze.length;

    const summaryEnabled = !!ctx.config.reviewTypes.summary;
    if (summaryEnabled) await tryFetchPRPatches(octokit, pr, logger);

    if (filesToAnalyze.length === 0 && !summaryEnabled) {
      logger.info('No analyzable files — running full-repo complexity scan');
      await computeRepoComplexity(headClone.dir, ctx.config.threshold, logger);
      const summaryMarkdown = await finalizeCheckRunNoFiles(checkRunId, octokit, pr, logger);
      return {
        findings: [],
        conclusion: 'success',
        summaryMarkdown,
        filesAnalyzed,
        usage: { totalTokens: 0, cost: 0 },
        writeForbidden,
      };
    }

    // Run complexity analysis (head+base when files analyzable, full-repo scan otherwise)
    const analysis = await runAnalysisPhase(
      filesToAnalyze,
      ctx.config.threshold,
      headClone.dir,
      ctx.baseRepoFullName,
      pr.baseSha,
      token,
      logger,
    );
    if (!analysis) {
      const summaryMarkdown = 'Review failed — could not produce a complexity report.';
      await finalizeCheckRunFailed(checkRunId, octokit, pr, summaryMarkdown, logger);
      return {
        findings: [],
        conclusion: 'failure',
        summaryMarkdown,
        filesAnalyzed,
        usage: { totalTokens: 0, cost: 0 },
        writeForbidden,
      };
    }
    const { currentReport, chunks, baselineReport, deltas } = analysis;
    baseClone = analysis.baseClone;

    // Setup engine with enabled plugins. The agent plugin produces bug,
    // architectural, and summary findings from a single run, so it's gated on
    // both an LLM being configured and at least one of those review types being
    // enabled (the three can be turned on/off as a group, not independently).
    const agentEnabled =
      !!ctx.llm &&
      (!!ctx.config.reviewTypes.bugs ||
        !!ctx.config.reviewTypes.architectural ||
        !!ctx.config.reviewTypes.summary);
    const engine = new ReviewEngine();
    if (ctx.config.reviewTypes.complexity) engine.register(new ComplexityPlugin());
    if (agentEnabled) engine.register(new AgentReviewPlugin());

    // Track agent usage separately (reported via callback since it bypasses LLMClient)
    let agentUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 };

    // Selected model — used for both the agent-review plugin config and the
    // adapterContext below so cost/metadata reporting stays consistent.
    const selectedModel = ctx.llm?.model;

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
          threshold: parseInt(ctx.config.threshold, 10),
          blockOnNewErrors: ctx.config.blockOnNewErrors,
        },
        'agent-review': ctx.llm
          ? {
              apiKey: ctx.llm.apiKey,
              provider: ctx.llm.provider,
              model: ctx.llm.model,
              baseUrl: ctx.llm.provider === 'openai' ? ctx.llm.baseUrl : undefined,
              inputCostPerMTok: ctx.llm.inputCostPerMTok,
              outputCostPerMTok: ctx.llm.outputCostPerMTok,
              ...scaleAgentBudget(filesToAnalyze.length, chunks),
            }
          : {},
      },
      config: {},
      pr,
      logger,
      repoRootDir: headClone.dir,
      reportUsage: usage => {
        agentUsage = usage;
      },
    });
    logger.info(`Engine produced ${findings.length} total findings`);

    // Present via engine (posts check run + comments)
    const adapterContext: AdapterContext = {
      complexityReport: currentReport,
      baselineReport,
      deltas,
      deltaSummary: deltas ? calculateDeltaSummary(deltas) : null,
      pr,
      octokit,
      logger,
      llmUsage: agentUsage.totalTokens > 0 ? agentUsage : undefined,
      model: selectedModel,
      blockOnNewErrors: ctx.config.blockOnNewErrors,
    };

    const presentation = await tryPresentFindings(
      engine,
      findings,
      adapterContext,
      checkRunId,
      octokit,
      pr,
      logger,
    );

    tokenUsage = agentUsage.totalTokens;
    cost = agentUsage.cost;

    return {
      findings,
      conclusion: presentation.conclusion,
      summaryMarkdown: presentation.summary,
      filesAnalyzed,
      usage: { totalTokens: tokenUsage, cost },
      writeForbidden,
    };
  } finally {
    if (headClone) await headClone.cleanup().catch(() => {});
    if (baseClone) await baseClone.cleanup().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Helpers

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

async function tryFetchPRPatches(
  octokit: Octokit,
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

async function finalizeCheckRunNoFiles(
  checkRunId: number | undefined,
  octokit: Octokit,
  prContext: PRContext,
  logger: Logger,
): Promise<string> {
  const summary = 'No files eligible for complexity analysis.';
  if (!checkRunId) return summary;
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
        summary,
      },
    },
    logger,
  ).catch(err => logger.warning(`Failed to finalize check run: ${err}`));
  return summary;
}

async function finalizeCheckRunFailed(
  checkRunId: number | undefined,
  octokit: Octokit,
  prContext: PRContext,
  summary: string,
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
      conclusion: 'failure',
      output: {
        title: 'Review failed',
        summary,
      },
    },
    logger,
  ).catch(err => logger.warning(`Failed to finalize check run: ${err}`));
}

interface AnalysisPhaseResult {
  currentReport: ComplexityReport;
  chunks: CodeChunk[];
  avgComplexity: number;
  maxComplexity: number;
  baselineReport: ComplexityReport | null;
  deltas: ComplexityDelta[] | null;
  baseClone: CloneResult | null;
}

async function runAnalysisPhase(
  filesToAnalyze: string[],
  threshold: string,
  headCloneDir: string,
  baseRepoFullName: string,
  baseSha: string,
  token: string,
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

    await tryEnrichTestAssociations(currentReport, filesToAnalyze, headCloneDir, logger);

    let baseClone: CloneResult | null = null;
    let baselineReport: ComplexityReport | null = null;
    try {
      baseClone = await cloneBySha(baseRepoFullName, baseSha, token, logger);
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

async function tryPresentFindings(
  engine: ReviewEngine,
  findings: ReviewFinding[],
  adapterContext: AdapterContext,
  checkRunId: number | undefined,
  octokit: Octokit,
  prContext: PRContext,
  logger: Logger,
): Promise<{ conclusion: 'success' | 'failure' | 'neutral'; summary: string }> {
  try {
    return await engine.present(findings, adapterContext, { checkRunId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`engine.present() failed: ${message}`);
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
            summary: `An error occurred: ${message}`,
          },
        },
        logger,
      ).catch(err => logger.warning(`Failed to finalize check run after error: ${err}`));
    }
    return { conclusion: 'neutral', summary: `An error occurred: ${message}` };
  }
}

/**
 * Full-repo complexity scan on an already-cloned directory.
 * Used when a PR touches no analyzable files so we still report real scores.
 */
async function computeRepoComplexity(
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

/**
 * Resolve the check run for this review. Reuses a pre-created check run when
 * `ctx.checkRunId` is provided (transitioning it to in_progress), otherwise
 * creates a fresh one.
 *
 * Returns `writeForbidden: true` when the create/update is rejected with a 403
 * (read-only token, e.g. a fork `pull_request`) so the caller can surface a
 * single fork warning instead of silently producing no PR output.
 */
async function resolveCheckRun(
  ctx: ReviewCoreContext,
): Promise<{ checkRunId: number | undefined; writeForbidden: boolean }> {
  const { octokit, pr, logger } = ctx;

  if (ctx.checkRunId) {
    try {
      await updateCheckRun(
        octokit,
        {
          owner: pr.owner,
          repo: pr.repo,
          checkRunId: ctx.checkRunId,
          status: 'in_progress',
          output: { title: 'Running...', summary: 'Analysis in progress' },
        },
        logger,
      );
    } catch (error) {
      logger.warning(
        `Failed to update check run to in_progress: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { checkRunId: ctx.checkRunId, writeForbidden: isWriteForbidden(error) };
    }
    return { checkRunId: ctx.checkRunId, writeForbidden: false };
  }

  try {
    const checkRunId = await createCheckRun(
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
    return { checkRunId, writeForbidden: false };
  } catch (error) {
    logger.warning(
      `Failed to create check run: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { checkRunId: undefined, writeForbidden: isWriteForbidden(error) };
  }
}
