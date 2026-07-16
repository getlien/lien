/**
 * Agent Review plugin — agentic code review using Anthropic tool_use.
 *
 * Replaces the bug finder, architectural, and summary plugins with a single
 * agent that investigates PRs autonomously using Lien's code analysis tools.
 * Produces bugs, architectural observations, and a risk summary in one run.
 */

import { z } from 'zod';

import type {
  ReviewPlugin,
  ReviewContext,
  ReviewFinding,
  PresentContext,
} from '../../plugin-types.js';
import { buildDependencyGraph } from '../../dependency-graph.js';
import { computeBlastRadius } from '../../blast-radius.js';
import type { Logger } from '../../logger.js';

import type { AgentConfig, AgentFinding, AgentResult } from './types.js';
import { AnthropicAgentClient } from './anthropic-client.js';
import { OpenAIAgentClient, toOpenAITools } from './openai-client.js';
import { buildSystemPrompt, buildInitialMessage } from './system-prompt.js';
import { BUILTIN_RULES, buildTriggerContext, selectRules } from './rules.js';
import { AGENT_TOOLS, dispatchTool } from './tools.js';
import { DOC_TRUTH_PASS_SPEC } from './doc-truth-pass.js';
import {
  STALE_DUPLICATE_PASS_SPEC,
  applyStaleDuplicateMainOverride,
} from './stale-duplicate-pass.js';
import {
  INCOMPLETE_HANDLING_PASS_SPEC,
  applyIncompleteHandlingMainOverride,
} from './incomplete-handling-pass.js';
import {
  runExtraPasses,
  type ReviewPassSpec,
  type PassClientRunner,
  type PassOutcome,
} from './review-pass.js';
import {
  isSummaryOnlyMode,
  buildSummaryOnlyPrompts,
  SUMMARY_ONLY_MAX_TURNS,
} from './summary-only-pass.js';
import {
  DEFAULT_REVIEW_MODEL,
  DEFAULT_OPENROUTER_BASE_URL,
  MAX_REVIEW_TOKEN_BUDGET,
} from '../../defaults.js';

/**
 * The ordered list of extra passes `analyze()`/`analyzeSummaryOnly()` run
 * after the main investigation (see `review-pass.ts`'s "N-pass plumbing").
 * Doc-truth is the proven precedent; the stale-duplicate candidate loop is
 * the pilot (per-rule-loops design doc §4) — dark by default, see
 * `stale-duplicate-pass.ts`'s own gate for why adding it here changes no
 * default behavior. The incomplete-handling candidate loop (design doc §7
 * item 5) is the second build, unifying the variant-sweep/sibling-surface/
 * unread-field signals into one dedicated pass — also dark by default, see
 * `incomplete-handling-pass.ts`. None of these three passes has a data
 * dependency on either of the others, so declaration order doesn't matter
 * for correctness (see review-pass.ts's "serial for v1" note) — doc-truth
 * stays first as the longer-proven pass.
 */
const EXTRA_PASSES: ReviewPassSpec[] = [
  DOC_TRUTH_PASS_SPEC,
  STALE_DUPLICATE_PASS_SPEC,
  INCOMPLETE_HANDLING_PASS_SPEC,
];

const configSchema = z.object({
  apiKey: z.string().min(1),
  model: z.string().default(DEFAULT_REVIEW_MODEL),
  /** 'openai' for OpenRouter/Gemini/DeepSeek, 'anthropic' for Claude */
  provider: z.enum(['openai', 'anthropic']).default('openai'),
  baseUrl: z.string().default(DEFAULT_OPENROUTER_BASE_URL),
  inputCostPerMTok: z.number().optional(),
  outputCostPerMTok: z.number().optional(),
  maxTurns: z.number().int().min(1).max(30).default(15),
  maxTokenBudget: z.number().int().default(100_000),
  /**
   * OpenRouter `provider` routing block (openai path only), sent verbatim on
   * each request. Omit to use DEFAULT_PROVIDER_ROUTING; set `null` to send no
   * routing preferences; set e.g. `{ ignore: ['slow-provider'] }` to steer.
   */
  providerRouting: z.record(z.unknown()).nullable().optional(),
  /** Per-request abort timeout in ms (openai path). Omit for the default 120s. */
  requestTimeoutMs: z.number().int().positive().optional(),
  // Legacy — maps to apiKey
  anthropicApiKey: z.string().optional(),
  blastRadius: z
    .object({
      enabled: z.boolean().default(true),
      depth: z.number().int().min(1).max(4).default(2),
      maxNodes: z.number().int().min(5).max(200).default(30),
      maxSeeds: z.number().int().min(1).max(20).default(8),
    })
    .optional(),
  /**
   * Run the dedicated claims-only doc-truth second pass on doc-touching PRs
   * (issue #732). Default true; env LIEN_REVIEW_DOC_PASS=0 also disables it.
   */
  docTruthPass: z.boolean().default(true),
  /**
   * Whether the `summary` review type is enabled (issue #572). Gates the
   * diff-only summary-only mode — see `summary-only-pass.ts`.
   */
  summaryEnabled: z.boolean().default(false),
  /**
   * Run the stale-duplicate candidate-loop PILOT (per-rule-loops design doc
   * §4). Default false — dark-launched opt-in; set true (or env
   * LIEN_STALE_DUP_PASS=on) to enable. See `stale-duplicate-pass.ts`.
   */
  staleDuplicatePass: z.boolean().default(false),
  /**
   * Run the incomplete-handling candidate loop (per-rule-loops design doc
   * §7 item 5). Default false — dark-launched opt-in; set true (or env
   * LIEN_INCOMPLETE_PASS=on) to enable. See `incomplete-handling-pass.ts`.
   */
  incompleteHandlingPass: z.boolean().default(false),
});

export interface AgentReviewPluginOptions {
  id?: string;
  name?: string;
}

export class AgentReviewPlugin implements ReviewPlugin {
  id: string;
  name: string;
  description = 'AI-powered agentic code review using Anthropic-compatible tool_use';
  requiresLLM = false;
  requiresRepoChunks = true;
  configSchema = configSchema;

  constructor(options?: AgentReviewPluginOptions) {
    this.id = options?.id ?? 'agent-review';
    this.name = options?.name ?? 'Agent Review';
  }

  shouldActivate(context: ReviewContext): boolean {
    const apiKey =
      (context.config.apiKey as string) ?? (context.config.anthropicApiKey as string) ?? '';
    if (apiKey.length === 0) return false;
    if (context.chunks.length > 0) return true;
    // No analyzable chunks — only activate for the diff-only summary-only
    // mode (issue #572): summary review type enabled AND the PR's raw diff
    // is available. Every other condition (apiKey, chunks>0) is unchanged
    // from before this mode existed.
    const config = context.config as unknown as AgentConfig;
    return isSummaryOnlyMode(context, !!config.summaryEnabled);
  }

  async analyze(context: ReviewContext): Promise<ReviewFinding[]> {
    const config = context.config as unknown as AgentConfig;
    const logger = context.logger;
    const apiKey = config.apiKey ?? config.anthropicApiKey ?? '';
    const provider = config.provider ?? (config.anthropicApiKey ? 'anthropic' : 'openai');

    // Diff-only summary-only mode (issue #572) — strictly gated, see
    // `shouldActivate` above. Kept as an early-return to a dedicated method
    // rather than branching inline so the normal (chunks-driven) path below
    // is untouched by this mode's existence.
    if (isSummaryOnlyMode(context, !!config.summaryEnabled)) {
      return this.analyzeSummaryOnly(context, config, apiKey, provider, logger);
    }

    // Build dependency graph from in-memory chunks (no embeddings needed)
    const graph = buildDependencyGraph(context.repoChunks!);

    const toolExecutor = (name: string, input: Record<string, unknown>) =>
      dispatchTool(name, input, {
        repoChunks: context.repoChunks!,
        repoRootDir: context.repoRootDir!,
        graph,
        logger,
      });

    // Select active rules based on PR content (languages, diff keywords).
    // applyStaleDuplicateMainOverride/applyIncompleteHandlingMainOverride are
    // no-ops unless LIEN_STALE_DUP_MAIN=off / LIEN_INCOMPLETE_MAIN=off (see
    // stale-duplicate-pass.ts / incomplete-handling-pass.ts) — each pass's
    // future "loop only, no shared-loop backstop" A/B arm.
    const triggerCtx = buildTriggerContext(context);
    const rules = applyIncompleteHandlingMainOverride(
      applyStaleDuplicateMainOverride(selectRules(BUILTIN_RULES, triggerCtx)),
    );
    logger.info(
      `[${this.id}] Rules: ${rules.active.map(r => r.id).join(', ')} (skipped: ${rules.skipped.join(', ') || 'none'})`,
    );

    // Pre-compute transitive blast radius so the agent sees it in the initial
    // message instead of having to decide to call get_dependents itself.
    // Gated on an active rule opting in — saves compute on PRs where no
    // pattern-specific rule needs dependency context (docs, formatting, etc.).
    const blastRadiusConfig = config.blastRadius ?? {};
    const needsBlastRadius =
      blastRadiusConfig.enabled !== false && rules.active.some(r => r.requiresBlastRadius === true);
    const blastRadius = needsBlastRadius
      ? computeBlastRadius(context.chunks, graph, context.repoChunks!, {
          depth: blastRadiusConfig.depth,
          maxNodes: blastRadiusConfig.maxNodes,
          maxSeeds: blastRadiusConfig.maxSeeds,
          workspaceRoot: context.repoRootDir,
        })
      : null;
    if (blastRadius) {
      logger.info(
        `[${this.id}] Blast radius: ${blastRadius.totalDistinctDependents} deps, risk=${blastRadius.globalRisk.level}${blastRadius.truncated ? ' (truncated)' : ''}`,
      );
    }

    // High-impact PRs need more room to investigate; a too-tight budget is the
    // common cause of the agent bailing before producing a verdict.
    const maxTokenBudget = scaleBudgetForBlastRadius(
      config.maxTokenBudget,
      blastRadius?.globalRisk.level,
    );
    if (maxTokenBudget !== config.maxTokenBudget) {
      logger.info(
        `[${this.id}] Token budget scaled ${config.maxTokenBudget} → ${maxTokenBudget} for ${blastRadius?.globalRisk.level} blast radius`,
      );
    }
    // Report the FINAL allocated ceiling (post blast-radius scaling) for the
    // delivery attestation's budget.allocatedTokens — the pre-scaling value
    // computed upstream in review-pr.ts's scaleAgentBudget() isn't the real
    // ceiling this run was held to.
    context.reportBudget?.(maxTokenBudget);

    const systemPrompt = buildSystemPrompt(rules);
    const initialMessage = buildInitialMessage(context, { blastRadius, rules });
    const result = await runAgentClient(
      provider,
      config,
      apiKey,
      logger,
      systemPrompt,
      initialMessage,
      toolExecutor,
      maxTokenBudget,
    );

    // Extra passes beyond the main investigation (doc-truth today; see
    // `EXTRA_PASSES` and `review-pass.ts`'s "N-pass plumbing"). Each pass's
    // trace/usage fold into the main run, and its findings/result-state
    // (an unfinished pass, error-severity doc findings lifting the summary's
    // risk level) fold into `result`/`agentFindings` in list order. A pass
    // failure never fails the whole review — `runExtraPasses` catches and
    // reports it, leaving the main-pass output untouched. Every extra pass
    // is skipped entirely when the main pass never ran (provider down) — a
    // second request would only fire more doomed calls, and a failure-
    // isolated pass's own incomplete state must not overwrite the never-ran
    // marker.
    const { findings: agentFindings, outcomes } = await runExtraPasses(
      EXTRA_PASSES,
      context,
      config,
      logger,
      result,
      result.findings,
      this.extraPassClientRunner(provider, config, apiKey, logger, toolExecutor),
    );

    reportAgentRun(this.id, context, logger, result);
    reportPassOutcomes(context, outcomes);

    const pluginId = this.id;
    const findings = agentFindings.map(f => mapToReviewFinding(f, pluginId));
    appendSummaryFinding(findings, pluginId, result.summary);
    appendIncompleteNotice(findings, pluginId, result);

    return findings;
  }

  /**
   * Diff-only summary-only mode (issue #572). Kept as its OWN method — not a
   * branch spliced into `analyze()`'s body — so the normal (chunks-driven)
   * path above is provably unaffected by this mode's existence: every line of
   * `analyze()` after the early-return guard runs exactly as it did before
   * this mode was added. Deliberately mirrors that tail (doc-truth pass, then
   * merge/map/append) rather than sharing it, for the same reason.
   *
   * The doc-truth SECOND pass still runs here (unlike the summary-only main
   * pass, its gate — `docTruthSkipReason` — reads `context.pr.patches`
   * directly, not chunks) — a docs-only PR is exactly the case doc-truth
   * verification is for, so it is not disabled in this mode.
   */
  private async analyzeSummaryOnly(
    context: ReviewContext,
    config: AgentConfig,
    apiKey: string,
    provider: string,
    logger: Logger,
  ): Promise<ReviewFinding[]> {
    const graph = buildDependencyGraph(context.repoChunks ?? []);
    const toolExecutor = (name: string, input: Record<string, unknown>) =>
      dispatchTool(name, input, {
        repoChunks: context.repoChunks ?? [],
        repoRootDir: context.repoRootDir!,
        graph,
        logger,
      });

    const { systemPrompt, initialMessage } = buildSummaryOnlyPrompts(context);
    // The final budget was already scaled diff-proportionally by
    // `scaleSummaryOnlyBudget` upstream (review-pr.ts's buildPluginConfigs) —
    // unlike the normal path, there's no blast-radius upscale to layer on top
    // (no chunks means no blast radius is computed).
    const maxTokenBudget = config.maxTokenBudget;
    context.reportBudget?.(maxTokenBudget);

    const result = await runAgentClient(
      provider,
      { ...config, maxTurns: SUMMARY_ONLY_MAX_TURNS },
      apiKey,
      logger,
      systemPrompt,
      initialMessage,
      toolExecutor,
      maxTokenBudget,
    );

    const { findings: agentFindings, outcomes } = await runExtraPasses(
      EXTRA_PASSES,
      context,
      config,
      logger,
      result,
      result.findings,
      this.extraPassClientRunner(provider, config, apiKey, logger, toolExecutor),
    );

    reportAgentRun(this.id, context, logger, result);
    reportPassOutcomes(context, outcomes);

    const pluginId = this.id;
    const findings = agentFindings.map(f => mapToReviewFinding(f, pluginId));
    appendSummaryFinding(findings, pluginId, result.summary);
    appendIncompleteNotice(findings, pluginId, result);

    return findings;
  }

  /**
   * Build the client-runner factory `runExtraPasses` needs: a thin closure
   * over the shared `runAgentClient`, substituting each pass's own turn cap.
   * Shared by `analyze()` and `analyzeSummaryOnly()` — kept as a method (not
   * inlined) so neither grows a duplicated closure and `analyze()` stays
   * under its complexity budget.
   */
  private extraPassClientRunner(
    provider: string,
    config: AgentConfig,
    apiKey: string,
    logger: Logger,
    toolExecutor: ToolExecutor,
  ): (spec: ReviewPassSpec) => PassClientRunner {
    return () => (sys, init, budget, maxTurns) =>
      runAgentClient(
        provider,
        { ...config, maxTurns },
        apiKey,
        logger,
        sys,
        init,
        toolExecutor,
        budget,
      );
  }

  async present(findings: ReviewFinding[], context: PresentContext): Promise<void> {
    const marker = `<!-- lien-plugin:${this.id}:`;

    const commitSha = context.pr?.headSha;

    // Separate bug findings (line > 0) from summary/architectural findings
    const bugFindings = findings.filter(
      f => f.line > 0 && f.category !== 'architectural' && f.category !== 'summary',
    );
    const archFindings = findings.filter(f => f.category === 'architectural');
    // Render EVERY summary finding, not just the first: the agent can append a
    // second summary (e.g. the doc-truth-pass incomplete notice) that would
    // otherwise silently never render (the trap behind #733).
    const summaryFindings = findings.filter(f => f.category === 'summary');

    // 1. Post bug findings. GitHub only anchors inline review comments to lines
    //    inside the PR's diff hunks, so split findings by whether their line is
    //    in the diff. Anchorable findings become inline comments. The rest — a
    //    finding whose *cause* is in the diff but whose *manifestation* is in
    //    untouched code, often the sharpest findings the engine produces — are
    //    promoted to a visible, above-the-fold review comment instead of
    //    silently degrading into the collapsed "Prompt for AI Agents" block.
    //    Minimize outdated comments only when we have new ones to replace them.
    if (bugFindings.length > 0 && context.postInlineComments) {
      if (context.minimizeOutdatedComments) {
        await context.minimizeOutdatedComments(marker);
      }

      const { anchorable, unanchorable } = partitionByDiffAnchorability(
        bugFindings,
        context.pr?.diffLines,
      );

      // Inline comments for findings anchorable to a changed line. The collapsed
      // "fix all" prompt keeps listing every bug finding, as before.
      if (anchorable.length > 0) {
        const reviewBody = buildFixPrompt(bugFindings, marker);
        await context.postInlineComments(anchorable, reviewBody);
      }

      // Promote unanchorable findings to a visible review comment.
      if (unanchorable.length > 0 && context.postReviewComment) {
        context.logger.info(
          `[${this.id}] ${unanchorable.length} finding(s) outside the diff promoted to the review body`,
        );
        await context.postReviewComment(buildOutOfDiffReviewBody(unanchorable, marker));
      }
    }

    // 2. Contribute to PR description — GitHub callout box style
    const description = buildDescription(bugFindings, summaryFindings, archFindings, commitSha);
    context.appendDescription(description, this.id);

    // 4. Append to check run summary
    context.appendSummary(formatCheckSummary(findings, this.name));
  }
}

// ---------------------------------------------------------------------------
// Agent client execution
// ---------------------------------------------------------------------------

type ToolExecutor = (name: string, input: Record<string, unknown>) => Promise<string>;

function runAgentClient(
  provider: string,
  config: AgentConfig,
  apiKey: string,
  logger: Logger,
  systemPrompt: string,
  initialMessage: string,
  toolExecutor: ToolExecutor,
  maxTokenBudget: number,
): Promise<AgentResult> {
  if (provider === 'anthropic') {
    const client = new AnthropicAgentClient({
      apiKey,
      model: config.model,
      baseUrl: config.baseUrl,
      inputCostPerMTok: config.inputCostPerMTok,
      outputCostPerMTok: config.outputCostPerMTok,
      maxTurns: config.maxTurns,
      maxTokenBudget,
      logger,
    });
    return client.run(systemPrompt, initialMessage, AGENT_TOOLS, toolExecutor);
  }

  const client = new OpenAIAgentClient({
    apiKey,
    model: config.model,
    baseUrl: config.baseUrl ?? 'https://openrouter.ai/api/v1',
    inputCostPerMTok: config.inputCostPerMTok,
    outputCostPerMTok: config.outputCostPerMTok,
    maxTurns: config.maxTurns,
    maxTokenBudget,
    providerRouting: config.providerRouting,
    requestTimeoutMs: config.requestTimeoutMs,
    logger,
  });
  return client.run(systemPrompt, initialMessage, toOpenAITools(AGENT_TOOLS), toolExecutor);
}

/**
 * Log the run summary, forward usage and trace via the context's
 * optional callbacks. Pulled out of `analyze()` to keep its
 * time-to-understand under the threshold.
 */
function reportAgentRun(
  pluginId: string,
  context: ReviewContext,
  logger: Logger,
  result: AgentResult,
): void {
  logger.info(
    `[${pluginId}] Review complete: ${result.findings.length} findings in ${result.turns} turns ($${result.usage.cost.toFixed(4)})`,
  );
  context.reportUsage?.(result.usage);
  if (result.trace) {
    context.reportTrace?.(result.trace);
  }
}

/**
 * Forward every extra pass's outcome to the delivery attestation via
 * `context.reportPassResult` — see `plugin-types.ts`'s doc comment on that
 * callback for why this is separate from `reportBudget`/`reportUsage` (those
 * stay main-pass-only aggregates; this attributes an extra pass's own
 * stop reason/tokens to that pass specifically).
 */
function reportPassOutcomes(context: ReviewContext, outcomes: PassOutcome[]): void {
  for (const outcome of outcomes) {
    context.reportPassResult?.(outcome);
  }
}

/**
 * Append the agent's summary as a special finding so `present()` can
 * render it. No-op when the agent didn't return a summary (e.g.,
 * budget exhausted before the wrap-up turn).
 */
function appendSummaryFinding(
  findings: ReviewFinding[],
  pluginId: string,
  summary: AgentResult['summary'],
): void {
  if (!summary) return;
  findings.push({
    pluginId,
    filepath: '',
    line: 0,
    severity: 'info' as const,
    category: 'summary',
    message: summary.overview,
    metadata: {
      riskLevel: summary.riskLevel,
      overview: summary.overview,
      keyChanges: summary.keyChanges,
    },
  });
}

/** Extra budget headroom for high-impact PRs, keyed by blast-radius risk. */
const BLAST_RADIUS_BUDGET_MULTIPLIER: Record<string, number> = {
  critical: 1.5,
  high: 1.25,
};

/**
 * Scale the agent's token budget up for high-impact changes. A critical
 * blast radius means the agent has many dependents to investigate, which is
 * exactly when a too-tight budget causes it to bail before a verdict. Clamped
 * to the shared ceiling (MAX_REVIEW_TOKEN_BUDGET) used by review-pr.ts scaling.
 */
export function scaleBudgetForBlastRadius(baseBudget: number, riskLevel?: string): number {
  const multiplier = riskLevel ? (BLAST_RADIUS_BUDGET_MULTIPLIER[riskLevel] ?? 1) : 1;
  return Math.min(Math.round(baseBudget * multiplier), MAX_REVIEW_TOKEN_BUDGET);
}

/**
 * When the agent bailed before producing a verdict, append a `summary` finding
 * so `present()` surfaces a clear notice instead of a misleading "no issues
 * found" / clean review.
 *
 * A NEVER-RAN main pass (every provider request failed — infrastructure, not a
 * partial review) escalates to an `error` finding so the check concludes
 * `failure` rather than the passing `neutral` a `warning` maps to. A partial
 * run, or an incomplete that came only from a failure-isolated extra pass
 * (doc-truth, or the stale-duplicate loop via the generic
 * `incompleteFromPass`), stays a `warning` (fail-open) — but still never
 * reads as clean.
 */
export function appendIncompleteNotice(
  findings: ReviewFinding[],
  pluginId: string,
  result: AgentResult,
): void {
  if (!result.incomplete) return;
  if (result.neverRan && !result.incompleteFromDocPass && !result.incompleteFromPass) {
    appendNeverRanNotice(findings, pluginId, result);
    return;
  }
  const reason = describeIncompleteStop(result.stopReason);
  // An incomplete that came only from an EXTRA pass (doc-truth, or a
  // generically-named one via `incompleteFromPass`) must not imply the whole
  // review is partial — the main pass finished normally. Doc-truth keeps its
  // own dedicated branch (unchanged wording, already tested); any other
  // named pass gets the same shape via the generic field.
  const message = result.incompleteFromDocPass
    ? `The documentation-truthfulness pass did not finish — it ${reason}. ` +
      `Doc-claim verification is partial; code findings are unaffected.`
    : result.incompleteFromPass
      ? `The ${result.incompleteFromPass} pass did not finish — it ${reason}. ` +
        `That pass's findings are partial; the main review's findings are unaffected.`
      : `Lien Review did not finish — it ${reason} while investigating. ` +
        `Any findings shown are partial; re-run the review to retry.`;
  findings.push({
    pluginId,
    filepath: '',
    line: 0,
    severity: 'warning' as const,
    category: 'summary',
    message,
    metadata: { incomplete: true, stopReason: result.stopReason, overview: message },
  });
}

/** Human-readable phrase for why an incomplete (but partial) run stopped. */
function describeIncompleteStop(stopReason: AgentResult['stopReason']): string {
  switch (stopReason) {
    case 'budget':
      return 'hit the token budget limit';
    case 'max_turns':
      return 'hit the turn limit';
    case 'completed':
      return 'ended without emitting a parseable JSON verdict';
    case 'incomplete_verdict':
      return 'did not produce a verdict for every candidate';
    default:
      return 'stopped unexpectedly';
  }
}

/**
 * Append the never-ran notice: an `error`-severity summary finding naming the
 * provider failure. The error severity is load-bearing — `determineConclusion`
 * maps it to a `failure` check conclusion, so a fully starved review can't pass
 * as clean. `metadata.neverRan` lets a conclusion-mapper key on it explicitly.
 */
function appendNeverRanNotice(
  findings: ReviewFinding[],
  pluginId: string,
  result: AgentResult,
): void {
  const cause = summarizeProviderError(result.errorMessage);
  const message =
    `Lien Review did not run — every provider request failed${cause ? ` (${cause})` : ''}. ` +
    `This is NOT a clean review; no code was analyzed. Re-run once the provider ` +
    `issue is resolved.`;
  findings.push({
    pluginId,
    filepath: '',
    line: 0,
    severity: 'error' as const,
    category: 'summary',
    message,
    metadata: {
      incomplete: true,
      neverRan: true,
      stopReason: result.stopReason,
      overview: message,
    },
  });
}

/**
 * True when `findings` contains the never-ran notice from `appendNeverRanNotice`
 * — the agent-review MAIN pass never completed a single turn because every LLM
 * provider request failed terminally (a 402 on an overdrawn account, an
 * invalid key, a provider outage). This is the single source of truth for that
 * signal: callers outside this module (the transport-agnostic review core, the
 * GitHub Action) key off this instead of re-deriving it from `metadata` shape
 * or from `conclusion`/summary text, so the contract only needs to change here
 * if the notice's shape ever does.
 */
export function hasProviderFailure(findings: ReviewFinding[]): boolean {
  return findings.some(f => (f.metadata as { neverRan?: boolean } | undefined)?.neverRan === true);
}

/** Cap the provider error to a short, single-line cause for the notice. */
const MAX_PROVIDER_ERROR_CHARS = 160;
function summarizeProviderError(msg?: string): string {
  if (!msg) return '';
  const oneLine = msg.replace(/\s+/g, ' ').trim();
  return oneLine.length <= MAX_PROVIDER_ERROR_CHARS
    ? oneLine
    : `${oneLine.slice(0, MAX_PROVIDER_ERROR_CHARS - 1).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Finding mapping
// ---------------------------------------------------------------------------

/**
 * Cap free-text finding fields. A verbose model (Kimi) can dump a multi-thousand
 * character stream-of-consciousness into a single `message`/`evidence`, which
 * both bloats the PR comment and risks truncating the whole verdict JSON. Trim
 * to a readable length at the display boundary.
 */
const MAX_FINDING_TEXT_CHARS = 1200;

export function clampText(text: string | undefined): string | undefined {
  if (!text || text.length <= MAX_FINDING_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_FINDING_TEXT_CHARS - 1).trimEnd()}…`;
}

function mapToReviewFinding(f: AgentFinding, pluginId: string): ReviewFinding {
  return {
    pluginId,
    filepath: f.filepath,
    line: f.line,
    endLine: f.endLine,
    symbolName: f.symbolName,
    severity: f.severity,
    category: f.category,
    message: clampText(f.message) ?? f.message,
    suggestion: clampText(f.suggestion),
    evidence: clampText(f.evidence),
    ...(f.ruleId ? { metadata: { ruleId: f.ruleId } } : {}),
  };
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

function formatArchDescription(findings: ReviewFinding[]): string {
  const count = findings.length;
  const rows = findings.map(f => {
    const scope = f.filepath ? `\`${f.filepath}:${f.line}\`` : 'General';
    return `| ${scope} | ${f.message} | ${f.suggestion ?? ''} |`;
  });
  const table = `| Scope | Observation | Suggestion |\n|---|---|---|\n${rows.join('\n')}`;
  return `<details>\n<summary>🏗️ <b>Architectural</b> · ${count} observation${count === 1 ? '' : 's'}</summary>\n\n${table}\n\n</details>`;
}

function formatCheckSummary(findings: ReviewFinding[], name: string): string {
  const bugs = findings.filter(
    f => f.category !== 'architectural' && f.category !== 'summary' && f.line > 0,
  );
  const arch = findings.filter(f => f.category === 'architectural');
  const summaries = findings.filter(f => f.category === 'summary');

  const sections: string[] = [`### ${name}`];

  // First summary → the primary risk/overview (or incomplete) line, byte-for-byte
  // as before. Any further summary → its own appended line so an appended notice
  // (e.g. an incomplete doc-truth pass) is never silently dropped.
  summaries.forEach((summary, i) => {
    const meta = summary.metadata as
      | { riskLevel?: string; overview?: string; incomplete?: boolean }
      | undefined;
    if (meta?.incomplete) {
      sections.push(`⚠️ **Review incomplete** — ${meta.overview ?? summary.message}`);
    } else if (i === 0) {
      sections.push(
        `**${capitalize(meta?.riskLevel ?? 'unknown')} Risk** — ${meta?.overview ?? summary.message}`,
      );
    } else {
      sections.push(meta?.overview ?? summary.message);
    }
  });

  if (bugs.length > 0) {
    const bugLines = bugs.map(f => {
      const icon = f.severity === 'error' ? '🔴' : '🟡';
      return `- ${icon} **${f.filepath}:${f.line}** — ${f.message}`;
    });
    sections.push(`**Findings (${bugs.length})**\n${bugLines.join('\n')}`);
  }

  if (arch.length > 0) {
    const archLines = arch.map(f => `- ${f.message}`);
    sections.push(`**Architectural (${arch.length})**\n${archLines.join('\n')}`);
  }

  if (bugs.length === 0 && arch.length === 0 && summaries.length === 0) {
    sections.push('No issues found.');
  }

  return sections.join('\n\n');
}

interface SummaryMeta {
  riskLevel?: string;
  overview?: string;
  keyChanges?: string[];
  incomplete?: boolean;
}

function summaryMetaOf(finding: ReviewFinding | undefined): SummaryMeta | undefined {
  return finding?.metadata as SummaryMeta | undefined;
}

/**
 * Render a NON-primary summary finding (any beyond the first) as its own
 * section: incomplete-flagged notices get a ⚠️ warning line; anything else a
 * plain paragraph. Shared by the PR description and the check-run summary so a
 * second summary the primary block can't absorb still surfaces.
 */
function formatExtraSummary(finding: ReviewFinding): string {
  const meta = summaryMetaOf(finding);
  const text = meta?.overview ?? finding.message;
  return meta?.incomplete ? `⚠️ ${text}` : text;
}

/**
 * Build the PR description section using GitHub's callout blockquote syntax.
 * Uses > [!NOTE] for clean PRs, > [!WARNING] when issues are found. The first
 * summary drives the callout; any further summaries render as appended
 * sections so an appended notice (e.g. an incomplete doc-truth pass) is visible.
 */
function buildDescription(
  bugFindings: ReviewFinding[],
  summaryFindings: ReviewFinding[],
  archFindings: ReviewFinding[],
  commitSha?: string,
): string {
  const meta = summaryMetaOf(summaryFindings[0]);
  const risk = meta?.riskLevel ?? 'low';
  const overview = meta?.overview ?? summaryFindings[0]?.message ?? '';
  const incomplete = meta?.incomplete === true;

  // An incomplete review must never read as a clean/approving NOTE.
  const calloutType = bugFindings.length > 0 || incomplete ? 'WARNING' : 'NOTE';
  const headline = incomplete
    ? '⚠️ **Review did not complete**'
    : bugFindings.length > 0
      ? `**${bugFindings.length} issue${bugFindings.length === 1 ? '' : 's'} found** · ${capitalize(risk)} Risk`
      : `**${capitalize(risk)} Risk**`;

  const lines: string[] = [];
  lines.push(`> [!${calloutType}]`);
  lines.push(`> ${headline}`);

  if (overview) {
    lines.push(`>`);
    lines.push(`> ${overview}`);
  }

  if (meta?.keyChanges && meta.keyChanges.length > 0) {
    lines.push(`>`);
    for (const change of meta.keyChanges) {
      lines.push(`> - ${change}`);
    }
  }

  const parts: string[] = [lines.join('\n')];

  for (const extra of summaryFindings.slice(1)) {
    parts.push(formatExtraSummary(extra));
  }

  if (archFindings.length > 0) {
    parts.push(formatArchDescription(archFindings));
  }

  // Footer with commit SHA
  const shortSha = commitSha ? commitSha.slice(0, 7) : '';
  const footer = shortSha
    ? `<sup>Reviewed by [Lien Review](https://lien.dev) for commit ${shortSha}. Updates automatically on new commits.</sup>`
    : `<sup>Reviewed by [Lien Review](https://lien.dev). Updates automatically on new commits.</sup>`;
  parts.push(footer);

  return parts.join('\n\n');
}

/**
 * Split bug findings by whether GitHub can anchor an inline comment to them.
 * GitHub only accepts inline review comments on lines inside the PR's diff
 * hunks; `diffLines` maps each changed file to that set of line numbers.
 *
 * A finding is `anchorable` when its (filepath, line) is a changed line.
 * Everything else is `unanchorable` — typically a finding whose *cause* is in
 * the diff but whose *manifestation* is in untouched code. Those are promoted
 * to a visible review comment rather than dropped from inline posting.
 *
 * When `diffLines` is absent (e.g. the runner failed to fetch patch data) the
 * determination can't be made, so every finding is treated as anchorable and
 * the inline-posting path does its own diff-line filtering. Nothing is promoted
 * in that case — matching the pre-existing degradation.
 */
export interface AnchorabilityPartition {
  anchorable: ReviewFinding[];
  unanchorable: ReviewFinding[];
}

export function partitionByDiffAnchorability(
  findings: ReviewFinding[],
  diffLines: Map<string, Set<number>> | undefined,
): AnchorabilityPartition {
  if (!diffLines || diffLines.size === 0) {
    return { anchorable: [...findings], unanchorable: [] };
  }
  const anchorable: ReviewFinding[] = [];
  const unanchorable: ReviewFinding[] = [];
  for (const f of findings) {
    if (diffLines.get(f.filepath)?.has(f.line)) anchorable.push(f);
    else unanchorable.push(f);
  }
  return { anchorable, unanchorable };
}

/**
 * Render findings that can't be anchored to a diff line as a visible,
 * above-the-fold PR review comment. Each renders as a marked bullet naming the
 * severity, category, symbol, and exact `file:line`, flagged "(outside this
 * diff)" so a reviewer understands why it isn't an inline comment.
 *
 * The dedup marker (`…:outside-diff`) shares the plugin marker prefix, so
 * `minimizeOutdatedComments(marker)` collapses the previous run's promoted
 * comment before a fresh one is posted — no double-posting across re-runs.
 */
export function buildOutOfDiffReviewBody(findings: ReviewFinding[], marker: string): string {
  const count = findings.length;
  const headline = `**⚠️ ${count} issue${count === 1 ? '' : 's'} relating to your changes, outside this diff**`;
  const intro =
    'Caused by changes in this PR but on lines GitHub cannot attach an inline ' +
    'comment to (outside the diff hunks):';
  const bullets = findings.map(f => {
    const emoji = f.severity === 'error' ? '🔴' : f.severity === 'warning' ? '🟡' : 'ℹ️';
    const category = f.category.replace(/_/g, ' ');
    const symbol = f.symbolName ? ` in \`${f.symbolName}\`` : '';
    const suggestion = f.suggestion ? `\n  💡 *${f.suggestion}*` : '';
    return `- ${emoji} **${category}**${symbol} — \`${f.filepath}:${f.line}\` *(outside this diff)*\n  ${f.message}${suggestion}`;
  });
  return `${marker}outside-diff -->\n${headline}\n\n${intro}\n\n${bullets.join('\n\n')}`;
}

/**
 * Build the review-level comment body with a collapsed "fix all" prompt.
 * Includes the dedup marker so minimizeOutdatedComments can clean up on reruns.
 */
function buildFixPrompt(findings: ReviewFinding[], marker: string): string {
  const count = findings.length;
  const headline = `**${count} issue${count === 1 ? '' : 's'} found**`;

  const instructions = findings.map(f => {
    const loc = `\`${f.filepath}:${f.line}\``;
    const symbol = f.symbolName ? ` in \`${f.symbolName}\`` : '';
    const fix = f.suggestion ? ` Fix: ${f.suggestion}` : '';
    return `- ${loc}${symbol}: ${f.message}${fix}`;
  });

  const prompt = `Verify each finding against the current code and only fix it if the issue is real.\n\n${instructions.join('\n')}`;

  return `${marker}review -->\n${headline}\n\n<details>\n<summary>🤖 Prompt for AI Agents</summary>\n\n\`\`\`\n${prompt}\n\`\`\`\n\n</details>`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
