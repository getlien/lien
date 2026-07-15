/**
 * Transport-agnostic PR review core.
 *
 * `reviewPullRequest` clones the head (and optionally base) of a pull request,
 * runs complexity + agent review via {@link ReviewEngine}, posts inline comments
 * to GitHub, and returns a structured result (findings + conclusion + summary)
 * for the caller to surface. It carries no platform/Laravel/NATS concerns —
 * provider selection comes from `ctx.llm` and output goes straight to GitHub via
 * octokit.
 *
 * It does NOT create a Checks API check run: the GitHub Action job is the single
 * status check, and the caller renders findings as workflow annotations + a step
 * summary. Inline PR comments are still posted by the engine.
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
  PresentDelivery,
} from './index.js';
import {
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
  hasProviderFailure,
  updatePRDescription,
  EMPTY_DELIVERY,
} from './index.js';
import type { CodeChunk } from '@liendev/parser';
import { performChunkOnlyIndex, analyzeComplexityFromChunks } from '@liendev/parser';
import { reviewTokenBudgetMultiplier, MAX_REVIEW_TOKEN_BUDGET } from './defaults.js';
import {
  assembleAttestation,
  emptyAttestation,
  formatAttestationBadgeLine,
  type Attestation,
  type EligibilityPath,
  type SkippedPass,
} from './attestation.js';

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
  logger: Logger;
}

export interface ReviewCoreResult {
  findings: ReviewFinding[];
  conclusion: 'success' | 'failure' | 'neutral';
  summaryMarkdown: string;
  filesAnalyzed: number;
  usage: { totalTokens: number; cost: number };
  /**
   * True when the agent-review MAIN pass never ran at all — every LLM provider
   * request failed terminally (see `hasProviderFailure` / `AgentResult.neverRan`).
   * This is an OPERATIONAL failure, not an advisory finding: a caller (e.g. the
   * GitHub Action) should treat it as failing regardless of its own advisory/gating
   * policy, since a review that never ran isn't something to be advisory *about*.
   * Always `false` when the agent review didn't run for an unrelated reason (not
   * enabled, or the pipeline failed before reaching the engine).
   */
  providerFailure: boolean;
  /** Machine-readable receipt of this run — provider health, budget, delivery, verdict (v1). */
  attestation: Attestation;
}

export async function reviewPullRequest(ctx: ReviewCoreContext): Promise<ReviewCoreResult> {
  const { octokit, pr, token, logger } = ctx;

  logger.info(`Processing PR #${pr.pullNumber} on ${ctx.baseRepoFullName}`);

  let headClone: CloneResult | null = null;
  let baseClone: CloneResult | null = null;

  try {
    headClone = await cloneBySha(ctx.headRepoFullName, pr.headSha, token, logger);

    const allChangedFiles = await getPRChangedFiles(octokit, pr);
    logger.info(`Found ${allChangedFiles.length} changed files in PR`);

    const filesToAnalyze = filterAnalyzableFiles(allChangedFiles);
    logger.info(`${filesToAnalyze.length} files eligible for complexity analysis`);
    const filesAnalyzed = filesToAnalyze.length;

    const summaryEnabled = !!ctx.config.reviewTypes.summary;
    if (summaryEnabled) await tryFetchPRPatches(octokit, pr, logger);

    if (filesToAnalyze.length === 0 && !summaryEnabled) {
      logger.info('No analyzable files changed — skipping complexity/agent review');
      return emptyResult(
        'success',
        'No files eligible for complexity analysis.',
        filesAnalyzed,
        'zero_files_early_exit',
      );
    }

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
      return emptyResult(
        'failure',
        'Review failed — could not produce a complexity report.',
        filesAnalyzed,
        'normal',
        true,
      );
    }
    baseClone = analysis.baseClone;

    const review = await analyzeAndPresent(
      ctx,
      analysis,
      filesToAnalyze,
      allChangedFiles,
      headClone.dir,
    );
    return { ...review, filesAnalyzed };
  } finally {
    if (headClone) await headClone.cleanup().catch(() => {});
    if (baseClone) await baseClone.cleanup().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Helpers

/**
 * Build a no-findings result for the no-files / analysis-failed early returns.
 * Both are unrelated to the LLM provider (no files to review; the pipeline
 * failed before the engine ever ran), so `providerFailure` is always false —
 * only `hasProviderFailure` on the engine's actual findings sets it.
 */
function emptyResult(
  conclusion: 'success' | 'failure',
  summaryMarkdown: string,
  filesAnalyzed: number,
  eligibilityPath: EligibilityPath,
  pipelineFailed = false,
): ReviewCoreResult {
  return {
    findings: [],
    conclusion,
    summaryMarkdown,
    filesAnalyzed,
    usage: { totalTokens: 0, cost: 0 },
    providerFailure: false,
    attestation: emptyAttestation(conclusion, filesAnalyzed, eligibilityPath, pipelineFailed),
  };
}

/** The agent reviewer runs when an LLM is configured and a relevant review type is on. */
function isAgentEnabled(ctx: ReviewCoreContext): boolean {
  return (
    !!ctx.llm &&
    (!!ctx.config.reviewTypes.bugs ||
      !!ctx.config.reviewTypes.architectural ||
      !!ctx.config.reviewTypes.summary)
  );
}

/** Assemble the per-plugin engine config (complexity threshold + agent LLM settings). */
function buildPluginConfigs(
  ctx: ReviewCoreContext,
  filesToAnalyze: string[],
  chunks: CodeChunk[],
): Record<string, Record<string, unknown>> {
  return {
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
          ...scaleAgentBudget(filesToAnalyze.length, chunks, ctx.llm.model),
        }
      : {},
  };
}

interface PresentedReview {
  findings: ReviewFinding[];
  conclusion: 'success' | 'failure' | 'neutral';
  summaryMarkdown: string;
  usage: { totalTokens: number; cost: number };
  providerFailure: boolean;
  attestation: Attestation;
}

/** Telemetry the engine reports out-of-band during `run()`, via callbacks. */
interface RunTelemetry {
  findings: ReviewFinding[];
  agentUsage: { promptTokens: number; completionTokens: number; totalTokens: number; cost: number };
  allocatedTokens: number;
  passesSkipped: SkippedPass[];
}

/**
 * Register plugins and run the engine, collecting findings plus the
 * out-of-band telemetry (usage/budget/skips) it reports via callback —
 * agent-review bypasses the LLMClient meter and `run()`'s return value only
 * carries findings, so this is the one place that wiring lives.
 */
async function runEngineForReview(
  ctx: ReviewCoreContext,
  analysis: AnalysisPhaseResult,
  filesToAnalyze: string[],
  allChangedFiles: string[],
  headCloneDir: string,
  engine: ReviewEngine,
  agentAttempted: boolean,
): Promise<RunTelemetry> {
  const { pr, logger } = ctx;
  const { currentReport, chunks, baselineReport, deltas } = analysis;
  if (ctx.config.reviewTypes.complexity) engine.register(new ComplexityPlugin());
  if (agentAttempted) engine.register(new AgentReviewPlugin());

  const telemetry: RunTelemetry = {
    findings: [],
    agentUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 },
    allocatedTokens: 0,
    passesSkipped: [],
  };

  telemetry.findings = await engine.run({
    chunks,
    changedFiles: filesToAnalyze,
    allChangedFiles,
    complexityReport: currentReport,
    baselineReport,
    deltas,
    pluginConfigs: buildPluginConfigs(ctx, filesToAnalyze, chunks),
    config: {},
    pr,
    logger,
    repoRootDir: headCloneDir,
    reportUsage: usage => {
      telemetry.agentUsage = usage;
    },
    reportBudget: tokens => {
      telemetry.allocatedTokens = tokens;
    },
    reportSkip: skip => telemetry.passesSkipped.push(skip),
  });
  logger.info(`Engine produced ${telemetry.findings.length} total findings`);
  return telemetry;
}

/** Assemble the attestation from the run's telemetry + the present() delivery outcome. */
function buildRunAttestation(
  analysis: AnalysisPhaseResult,
  filesToAnalyze: string[],
  telemetry: RunTelemetry,
  agentAttempted: boolean,
  providerFailure: boolean,
  presentation: { conclusion: 'success' | 'failure' | 'neutral'; delivery: PresentDelivery },
): Attestation {
  return assembleAttestation({
    conclusion: presentation.conclusion,
    filesAnalyzed: filesToAnalyze.length,
    eligibilityPath: analysis.eligibilityPath,
    findings: telemetry.findings,
    agentAttempted,
    providerFailure,
    allocatedTokens: telemetry.allocatedTokens,
    spentTokens: telemetry.agentUsage.totalTokens,
    passesSkipped: telemetry.passesSkipped,
    annotationsEmitted: presentation.delivery.annotationsEmitted,
    inlineComments: presentation.delivery.inlineComments,
    descriptionBadgeUpdated: presentation.delivery.descriptionBadgeUpdated,
    outOfDiffReviewPosted: presentation.delivery.outOfDiffReviewPosted,
  });
}

/** Run the review engine over an analyzed PR and present the findings to GitHub. */
async function analyzeAndPresent(
  ctx: ReviewCoreContext,
  analysis: AnalysisPhaseResult,
  filesToAnalyze: string[],
  allChangedFiles: string[],
  headCloneDir: string,
): Promise<PresentedReview> {
  const { octokit, pr, logger } = ctx;
  const agentAttempted = isAgentEnabled(ctx);
  const engine = new ReviewEngine();

  const telemetry = await runEngineForReview(
    ctx,
    analysis,
    filesToAnalyze,
    allChangedFiles,
    headCloneDir,
    engine,
    agentAttempted,
  );
  const { findings, agentUsage } = telemetry;

  const adapterContext: AdapterContext = {
    complexityReport: analysis.currentReport,
    baselineReport: analysis.baselineReport,
    deltas: analysis.deltas,
    deltaSummary: analysis.deltas ? calculateDeltaSummary(analysis.deltas) : null,
    pr,
    octokit,
    logger,
    llmUsage: agentUsage.totalTokens > 0 ? agentUsage : undefined,
    model: ctx.llm?.model,
    blockOnNewErrors: ctx.config.blockOnNewErrors,
  };

  const presentation = await presentFindings(engine, findings, adapterContext, logger);
  const providerFailure = hasProviderFailure(findings);
  const attestation = buildRunAttestation(
    analysis,
    filesToAnalyze,
    telemetry,
    agentAttempted,
    providerFailure,
    presentation,
  );

  await postAttestationBadgeIfDegraded(octokit, pr, attestation, logger);

  return {
    findings,
    conclusion: presentation.conclusion,
    summaryMarkdown: presentation.summary,
    usage: { totalTokens: agentUsage.totalTokens, cost: agentUsage.cost },
    providerFailure,
    attestation,
  };
}

/**
 * Post the attestation's compact status line as its own PR-description
 * section — only when the run is NOT a clean `delivered` (a healthy run
 * doesn't need the extra line; see `formatAttestationBadgeLine`). Runs after
 * `engine.present()` has already posted the main "Lien Review" section, so
 * this is a separate `<!-- attestation -->`-marked section rather than a
 * fragment folded into that one (the attestation isn't known until delivery
 * — inline comments posted/dropped — has already happened).
 */
async function postAttestationBadgeIfDegraded(
  octokit: Octokit,
  pr: PRContext,
  attestation: Attestation,
  logger: Logger,
): Promise<void> {
  if (attestation.verdict === 'delivered') return;
  await updatePRDescription(
    octokit,
    pr,
    formatAttestationBadgeLine(attestation),
    logger,
    'attestation',
  ).catch(err =>
    logger.warning(`Failed to post attestation badge: ${err instanceof Error ? err.message : err}`),
  );
}

/**
 * Present findings to GitHub (inline comments + PR description) without a check
 * run, returning the conclusion + composed summary. Errors degrade to a neutral
 * conclusion rather than throwing, so a presentation failure never aborts the run.
 */
async function presentFindings(
  engine: ReviewEngine,
  findings: ReviewFinding[],
  adapterContext: AdapterContext,
  logger: Logger,
): Promise<{
  conclusion: 'success' | 'failure' | 'neutral';
  summary: string;
  delivery: PresentDelivery;
}> {
  try {
    return await engine.present(findings, adapterContext, { skipCheckRun: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`engine.present() failed: ${message}`);
    return {
      conclusion: 'neutral',
      summary: `An error occurred: ${message}`,
      delivery: EMPTY_DELIVERY,
    };
  }
}

/**
 * Scale agent turn count and token budget dynamically.
 *
 * Uses file count for turn scaling and estimated token count of the
 * changed code for budget scaling. The diff content is included in
 * the initial message, so the budget must accommodate it plus tool
 * calls and the final JSON output.
 */
export function scaleAgentBudget(
  fileCount: number,
  chunks: { content: string }[],
  model: string,
): { maxTurns: number; maxTokenBudget: number } {
  // Estimate tokens in the changed code (~4 chars/token)
  const contentChars = chunks.reduce((sum, c) => sum + c.content.length, 0);
  const estimatedContentTokens = Math.ceil(contentChars / 4);

  // Budget breakdown:
  // - System prompt: ~3K tokens (XML tags, examples, three-phase instructions)
  // - Initial message: ~1K overhead + content tokens (diff, signatures, etc.)
  // - Tool results: ~6K per call (capped by TOOL_RESULT_MAX_CHARS in the clients)
  // - Final JSON output: ~2K
  // - Conversation growth: each turn re-sends everything, so cap turns on big PRs
  const maxTurns = fileCount <= 3 ? 8 : fileCount <= 10 ? 10 : 12;
  const toolBudget = maxTurns * 6_000;
  const baseBudget = 4_000 + estimatedContentTokens + toolBudget + 2_000;

  // Scale by the model's token appetite — the breakdown above is per the
  // Gemini-era ~8K/turn assumption; Kimi spends far more (see defaults.ts).
  // Math.round keeps the result an integer: the agent-review config schema
  // requires an int, and a fractional budget makes it reject the whole config
  // (dropping the API key with it, so the agent silently doesn't run).
  const scaled = Math.round(baseBudget * reviewTokenBudgetMultiplier(model));

  // Clamp: minimum 60K (small PRs still need room), maximum MAX_REVIEW_TOKEN_BUDGET
  const maxTokenBudget = Math.min(Math.max(scaled, 60_000), MAX_REVIEW_TOKEN_BUDGET);

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

interface AnalysisPhaseResult {
  currentReport: ComplexityReport;
  chunks: CodeChunk[];
  avgComplexity: number;
  maxComplexity: number;
  baselineReport: ComplexityReport | null;
  deltas: ComplexityDelta[] | null;
  baseClone: CloneResult | null;
  /** 'normal' when the PR had analyzable files; 'full_repo_fallback' otherwise (#572/#754). */
  eligibilityPath: EligibilityPath;
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
      eligibilityPath: 'normal',
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
      eligibilityPath: 'full_repo_fallback',
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
    eligibilityPath: 'full_repo_fallback',
  };
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
