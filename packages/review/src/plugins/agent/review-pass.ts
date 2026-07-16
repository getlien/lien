/**
 * Generalized "extra pass" executor (per-rule-loops design, §1 — N-pass
 * plumbing).
 *
 * Before this module existed, `doc-truth-pass.ts` was the only extra LLM
 * call bolted onto the main agent-review run, and its gate/prompt/budget/
 * runner/merge pieces were wired into `index.ts`'s `analyze()` by hand as a
 * single hardcoded `docResult` variable. This module factors the GENERIC
 * part of that shape — the gate-check, client-run, failure-isolation, trace-
 * append, and reporting plumbing — into a `ReviewPassSpec` contract plus a
 * `runExtraPasses` orchestrator, so `analyze()` can run an ORDERED LIST of
 * extra passes instead of one bespoke variable. `doc-truth-pass.ts` keeps
 * ownership of doc-truth's own gate/prompt/budget/merge functions (they stay
 * pure and independently unit-tested) and exposes them bundled as a single
 * `ReviewPassSpec` (`DOC_TRUTH_PASS_SPEC`) that plugs into this module.
 *
 * Execution is SERIAL for v1: `runExtraPasses` runs `specs` in array order,
 * one at a time, awaiting each before starting the next. Doc-truth's pass has
 * a real data dependency on the main pass's outcome (it must not run at all
 * when the main pass never completed a turn — see the `neverRan` check
 * below), and no second pass exists yet to make concurrent execution's added
 * complexity (trace-offset races, interleaved budget reporting) worth paying
 * for. Revisit only once ≥3 dedicated passes exist and latency is a measured
 * problem (YAGNI).
 */

import type { ReviewContext } from '../../plugin-types.js';
import type { Logger } from '../../logger.js';
import type {
  AgentConfig,
  AgentFinding,
  AgentResult,
  AgentStopReason,
  AgentTrace,
} from './types.js';

/**
 * One "extra" pass beyond the main investigation — a second (or third, …)
 * LLM call scoped to a narrower question, whose output folds back into the
 * main pass's findings/result. Mirrors `doc-truth-pass.ts`'s six pieces
 * (gate, prompt builder, budget, runner, findings-merge, result-merge),
 * generalized so a future dedicated pass (a candidate-loop rule, per the
 * per-rule-loops design doc) can be added to an `EXTRA_PASSES` list without
 * re-deriving the gate/failure-isolation/reporting plumbing doc-truth-pass.ts
 * already worked out.
 */
export interface ReviewPassSpec {
  /** Stable id — becomes the trace's `phase` tag and this pass's attestation name. */
  name: string;
  /** Plugin name this pass reports itself under via `context.reportSkip`. */
  skipPlugin: string;
  /** Why this pass would not run right now, or null if it should run. */
  gateReason(context: ReviewContext, config: AgentConfig): string | null;
  /** Build this pass's system + initial prompts. */
  buildPrompts(context: ReviewContext): { systemPrompt: string; initialMessage: string };
  /**
   * This pass's token budget, computed from the main pass's base budget.
   * `context` is available for a candidate-loop pass that scales its budget
   * by its own candidate count (per the per-rule-loops design doc §2) rather
   * than a flat fraction — doc-truth's own `docTruthPassBudget` ignores it
   * (a function declaring fewer parameters than an interface's function type
   * is still a valid implementation of that type).
   */
  budget(baseBudget: number, context: ReviewContext): number;
  /** Turn cap for this pass's client loop. */
  maxTurns: number;
  /** Fold this pass's findings into the running merged list. */
  mergeFindings(mergedFindings: AgentFinding[], passFindings: AgentFinding[]): AgentFinding[];
  /** Fold this pass's result-level state (incomplete/risk) into the main result. */
  mergeResultState(
    main: AgentResult,
    passResult: AgentResult | null,
    mergedFindings: AgentFinding[],
  ): void;
  /**
   * Optional post-processing hook run on this pass's raw client result
   * before it is logged/returned to the caller. A candidate-loop pass whose
   * output contract is "one verdict per candidate id" (per the per-rule-
   * loops design doc §2/§4) uses this to (a) reduce the raw per-candidate
   * verdict array down to real findings and (b) mark the result incomplete
   * when the model's output didn't cover every candidate — even though the
   * underlying client returned a syntactically complete verdict (has a
   * summary). Identity (no post-processing) when omitted; doc-truth's own
   * open findings-list shape needs nothing here.
   */
  postProcessResult?(result: AgentResult, context: ReviewContext): AgentResult;
}

/**
 * The PR title/body header, mirroring the main pass's `<pr_metadata>` block.
 * Shared by every extra pass's prompt builder (doc-truth, stale-duplicate,
 * incomplete-handling) — extracted here on this module's third identical
 * copy rather than left duplicated a third time (CLAUDE.md's DRY guidance:
 * wait for the 3rd use).
 */
export function renderPassPrHeader(context: ReviewContext): string | null {
  if (!context.pr) return null;
  const body = context.pr.body ? `\nDescription: ${context.pr.body}` : '';
  return `<pr_metadata>\nTitle: ${context.pr.title}${body}\n</pr_metadata>`;
}

/** A pass's client loop, closed over the pass-agnostic transport (provider/apiKey/toolExecutor). */
export type PassClientRunner = (
  systemPrompt: string,
  initialMessage: string,
  maxTokenBudget: number,
  maxTurns: number,
) => Promise<AgentResult>;

/**
 * Run one extra pass's client loop when it's gated on. Mirrors the shape
 * `doc-truth-pass.ts`'s original `runDocTruthPass` had: gate check first
 * (reporting the precise skip reason), then build+run, catching and
 * swallowing any failure — a pass-2+ error must never fail the whole review.
 */
export async function runReviewPass(
  spec: ReviewPassSpec,
  context: ReviewContext,
  config: AgentConfig,
  logger: Logger,
  runClient: PassClientRunner,
): Promise<AgentResult | null> {
  const skipReason = spec.gateReason(context, config);
  if (skipReason) {
    context.reportSkip?.({ plugin: spec.skipPlugin, reason: skipReason });
    return null;
  }
  try {
    const { systemPrompt, initialMessage } = spec.buildPrompts(context);
    const budget = spec.budget(config.maxTokenBudget, context);
    const rawResult = await runClient(systemPrompt, initialMessage, budget, spec.maxTurns);
    const result = spec.postProcessResult ? spec.postProcessResult(rawResult, context) : rawResult;
    logger.info(
      `[agent] ${spec.name} pass: ${result.findings.length} finding(s) in ${result.turns} turn(s) ($${result.usage.cost.toFixed(4)})`,
    );
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warning(`[agent] ${spec.name} pass failed: ${message}`);
    context.reportSkip?.({ plugin: spec.skipPlugin, reason: `failed: ${message}` });
    return null;
  }
}

/**
 * Append a pass's turns to the main trace, renumbered to continue after the
 * main pass and stamped with `phase`. Generalizes `doc-truth-pass.ts`'s
 * original `appendDocTruthTurns` — same renumbering scheme, parameterized
 * phase tag instead of the hardcoded `'doc-truth'` literal.
 */
export function appendPassTurns(
  mainTrace: AgentTrace | undefined,
  passTrace: AgentTrace | undefined,
  phase: string,
): void {
  if (!mainTrace || !passTrace) return;
  const offset = mainTrace.turns.length;
  for (const turn of passTrace.turns) {
    mainTrace.turns.push({ ...turn, turnNumber: offset + turn.turnNumber, phase });
  }
}

/**
 * One extra pass's outcome, reported for the delivery attestation
 * (`attestation.ts`'s `provider.passes[]` / `BudgetAttestation`). Only
 * produced for a pass that actually RAN — a gated-off or failed pass is
 * already covered by `context.reportSkip`'s `passesSkipped` list, so it
 * isn't duplicated here (see the per-rule-loops design doc §6).
 */
export interface PassOutcome {
  name: string;
  stopReason: AgentStopReason;
  neverRan: boolean;
  allocatedTokens: number;
  spentTokens: number;
}

/**
 * Run every extra pass in `specs`, IN ORDER (serial — see this module's doc
 * comment), folding each pass's findings/result-state into `main`/
 * `findings` before moving to the next. When the main pass never ran at all
 * (every provider request failed), every extra pass is skipped without even
 * evaluating its own gate — running one anyway would only fire a second
 * doomed request, and a failure-isolated extra pass's own incomplete state
 * must never overwrite the main pass's `neverRan` marker.
 */
export async function runExtraPasses(
  specs: ReviewPassSpec[],
  context: ReviewContext,
  config: AgentConfig,
  logger: Logger,
  main: AgentResult,
  findings: AgentFinding[],
  runClientFor: (spec: ReviewPassSpec) => PassClientRunner,
): Promise<{ findings: AgentFinding[]; outcomes: PassOutcome[] }> {
  const outcomes: PassOutcome[] = [];
  let merged = findings;
  for (const spec of specs) {
    if (main.neverRan) {
      context.reportSkip?.({
        plugin: spec.skipPlugin,
        reason: 'main pass never ran (provider failure)',
      });
      continue;
    }
    const passResult = await runReviewPass(spec, context, config, logger, runClientFor(spec));
    if (passResult) {
      appendPassTurns(main.trace, passResult.trace, spec.name);
      context.reportUsage?.(passResult.usage);
      outcomes.push({
        name: spec.name,
        stopReason: passResult.stopReason,
        neverRan: passResult.neverRan ?? false,
        allocatedTokens: spec.budget(config.maxTokenBudget, context),
        spentTokens: passResult.usage.totalTokens,
      });
    }
    merged = spec.mergeFindings(merged, passResult?.findings ?? []);
    spec.mergeResultState(main, passResult, merged);
  }
  return { findings: merged, outcomes };
}
