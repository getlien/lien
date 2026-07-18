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
  /**
   * Build this pass's system + initial prompts. `budget` is this pass's own
   * FINAL allocated budget (already computed via this same spec's `budget()`
   * below) — a candidate-loop pass uses it to rank-and-cap its worklist to
   * what this invocation can actually afford (see `affordableCandidateCeiling`
   * below); a pass with no overflow handling ignores the parameter (a
   * function declaring fewer parameters than an interface's function type is
   * still a valid implementation of that type — same precedent as `budget`'s
   * own doc comment below).
   */
  buildPrompts(
    context: ReviewContext,
    budget: number,
  ): { systemPrompt: string; initialMessage: string };
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
   * open findings-list shape needs nothing here. `budget` is the SAME
   * allocated-budget value `buildPrompts` received — a pass with overflow
   * handling recomputes the identical rank-and-cap worklist from it here (to
   * check verdict coverage against exactly what was LISTED, not the full
   * pre-cap candidate set) and stamps `candidatesDeferred`/
   * `deferredCandidateIds` on the returned result.
   */
  postProcessResult?(result: AgentResult, context: ReviewContext, budget: number): AgentResult;
}

/**
 * Absolute floor (tokens) under every extra pass's own budget formula —
 * whatever a pass computes (doc-truth's fraction of the main base,
 * stale-duplicate/incomplete-handling's per-candidate scaling), the result
 * is never allowed below this. Sized from PR #811's measured per-turn
 * appetite on Kimi: a single reasoning + tool-request turn cost 5,526-6,564
 * tokens BEFORE any tool result came back (`get_files_context`/`read_file`)
 * — bigger than doc-truth's (2,422) and stale-duplicate's (4,400) entire
 * pre-fix allocations, so either one hard-stopped the tool-calling loop
 * before it ever dispatched the call it asked for. 11,000 affords one such
 * turn plus a smaller follow-up/verdict turn with margin: "one real tool
 * round-trip", not the ~24K+ headroom normal-mode's `scaleAgentBudget`
 * passes enjoy. Shared across all three passes (this module's third
 * identical floor rather than a fourth copy of the same constant + the same
 * justifying comment — CLAUDE.md's DRY guidance: wait for the 3rd use). See
 * the PR body's before/after table for the exact #811 numbers this floor
 * fixes.
 */
export const EXTRA_PASS_MIN_BUDGET_TOKENS = 11_000;

// ---------------------------------------------------------------------------
// Candidate-overflow handling (rank-and-cap with attested deferral)
// ---------------------------------------------------------------------------

/**
 * Realistic cost (tokens) of ONE turn that dispatches a real tool call and
 * receives its result — PR #811/#813's measured envelope (5,526-6,564
 * tokens/turn on Kimi, the same measurement `EXTRA_PASS_MIN_BUDGET_TOKENS`
 * above is derived from) rounded to a clean number. This is the REALISTIC
 * per-candidate cost for a candidate-loop pass whose candidates carry no
 * inline evidence and so need a fresh read_file/get_files_context round-trip
 * to judge (incomplete-handling, removed-exports) — a much bigger number
 * than either pass's own PER_CANDIDATE_TOKENS budget-SIZING constant
 * (800-900), which only accounts for the candidate's rendered PROMPT text,
 * not the tool round-trip needed to actually investigate it. PR #813 is the
 * proof this gap matters: incomplete-handling's 15-candidate worklist got a
 * budget "correctly" scaled to 16,000 tokens under that prompt-sizing
 * formula and still ran out on turn 2, mid-investigation — the formula sized
 * the PROMPT, not the INVESTIGATION. A pass whose candidates carry
 * pre-fetched evidence (stale-duplicate's snippet, doc-truth's excerpt)
 * doesn't pay this cost per candidate — those callers pass their own nominal
 * per-candidate constant to `affordableCandidateCeiling` instead.
 */
export const OBSERVED_TOKENS_PER_TURN = 6_000;

/**
 * Tokens reserved off the top of a pass's budget for its own final
 * verdict-emission turn — synthesizing and emitting the JSON verdict array
 * once every listed candidate has been judged. Smaller than a full
 * investigative round-trip (no new tool dispatch, just synthesis), which is
 * exactly how `EXTRA_PASS_MIN_BUDGET_TOKENS` (11,000) was already derived:
 * "one such [investigative] turn plus a SMALLER follow-up/verdict turn with
 * margin" (see that constant's doc comment). This is that already-implied
 * "smaller" number, made explicit: 11,000 total minus the one investigative
 * turn `OBSERVED_TOKENS_PER_TURN` accounts for.
 */
export const VERDICT_EMISSION_RESERVE_TOKENS =
  EXTRA_PASS_MIN_BUDGET_TOKENS - OBSERVED_TOKENS_PER_TURN;

/**
 * How many candidates THIS invocation's allocated budget can afford an
 * EVIDENCE-BACKED verdict for — the rank-and-cap ceiling every candidate-loop
 * pass inverts its own budget math against (per-rule-loops candidate-overflow
 * handling; see PR #813's 15-candidate incomplete-handling run and the
 * Finding-A calibrate's ~51-claim doc-truth worklist, both of which exceeded
 * what their invocation could actually afford). `budget` is deliberately NOT
 * reduced by each pass's own fixed prompt overhead (BASE_OVERHEAD_TOKENS-style
 * constants) a second time here — that overhead is already what sized the
 * budget number in the first place (each pass's own `budget()` formula), and
 * PR #811's per-turn measurement that grounds `OBSERVED_TOKENS_PER_TURN`
 * already reflects a real turn's total cost (system prompt + worklist +
 * response), not just the tool-call delta. Only `VERDICT_EMISSION_RESERVE_TOKENS`
 * is reserved on top, for the pass's own closing turn.
 *
 * `tokensPerCandidate` is the caller's judgment call on realistic per-candidate
 * cost, not this function's: pass `OBSERVED_TOKENS_PER_TURN` itself for a loop
 * whose candidates typically need a fresh tool round-trip to judge (no inline
 * evidence attached), or the pass's own nominal PER_CANDIDATE_* budget-sizing
 * constant for a loop whose candidates carry pre-fetched evidence (a
 * comparison, not an investigation) — see each pass's own call site for which
 * applies. Floored at 0; given every pass's budget floor
 * (`EXTRA_PASS_MIN_BUDGET_TOKENS` = 11,000 > `VERDICT_EMISSION_RESERVE_TOKENS`
 * + any tokensPerCandidate used today), the ceiling is always ≥1 in practice —
 * a pass that passed its own eligibility gate (≥1 real candidate exists) never
 * gets capped down to a vacuous, zero-candidate worklist.
 */
export function affordableCandidateCeiling(budget: number, tokensPerCandidate: number): number {
  const investigable = budget - VERDICT_EMISSION_RESERVE_TOKENS;
  return Math.max(0, Math.floor(investigable / tokensPerCandidate));
}

/** The result of capping a candidate array to an affordable ceiling. */
export interface CandidateCap<T> {
  /** Candidates that fit within the ceiling — this run's actual worklist. */
  kept: T[];
  /** Candidates beyond the ceiling — excluded from the worklist, attested as deferred. */
  deferred: T[];
}

/**
 * Cap a candidate array — already in its OWN signal's existing priority/score
 * order (highest-confidence or most-repeated first; see each pass's own
 * `compute*Candidates` doc comment) — to the first `ceiling` entries. No new
 * ranking is invented: this only truncates an already-ordered list, per the
 * per-rule-loops candidate-overflow design ("each signal already has an
 * internal sort order — reuse; don't invent new scoring").
 */
export function capCandidatesToCeiling<T>(candidates: T[], ceiling: number): CandidateCap<T> {
  if (candidates.length <= ceiling) return { kept: candidates, deferred: [] };
  return { kept: candidates.slice(0, ceiling), deferred: candidates.slice(ceiling) };
}

/** Cap on how many deferred-candidate labels are attested (attestation stays short). */
export const MAX_DEFERRED_LABELS = 10;

/** Best-effort human-readable labels for a (possibly capped) deferred list — for the delivery
 *  attestation's `deferredCandidateIds`, NOT the pass's own `candidate-N` worklist ids (those are
 *  only ever assigned to KEPT/listed candidates — a deferred candidate never gets one). */
export function deferredCandidateLabels<T>(deferred: T[], labelFor: (item: T) => string): string[] {
  return deferred.slice(0, MAX_DEFERRED_LABELS).map(labelFor);
}

/**
 * The prompt note telling the model its worklist was capped — the honesty
 * half of candidate-overflow handling (per-rule-loops design point 2/3): the
 * model must know deferral happened so its summary doesn't imply exhaustive
 * coverage, while still being told every LISTED candidate is mandatory (a
 * capped-but-complete run is a clean verdict, not incompleteness — see
 * `incomplete_verdict`'s own doc comment on `AgentStopReason`). Returns ''
 * when nothing was deferred (the common case), so callers can push it
 * unconditionally alongside the worklist with `pushIfPresent`-style helpers.
 */
export function renderDeferralNote(deferredCount: number): string {
  if (deferredCount <= 0) return '';
  return (
    `NOTE — CANDIDATE OVERFLOW: ${deferredCount} additional eligible candidate(s) exist beyond ` +
    "this run's worklist below. They were DEFERRED — excluded, not silently investigated — " +
    "because this invocation's budget cannot afford an evidence-backed verdict for all of them. " +
    'This is a deliberate, attested cap, not incompleteness: you must still judge every ' +
    'candidate actually LISTED below (per <output_format>), and your summary must not describe ' +
    'or imply exhaustive coverage of every candidate that exists — only of the ones listed.'
  );
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
    const budget = spec.budget(config.maxTokenBudget, context);
    const { systemPrompt, initialMessage } = spec.buildPrompts(context, budget);
    const rawResult = await runClient(systemPrompt, initialMessage, budget, spec.maxTurns);
    const result = spec.postProcessResult
      ? spec.postProcessResult(rawResult, context, budget)
      : rawResult;
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
  /**
   * How many of this pass's eligible candidates were excluded from its
   * worklist by the rank-and-cap ceiling (see `affordableCandidateCeiling`) —
   * 0 for a pass with no overflow handling, or one whose full candidate list
   * fit inside this run's budget (the common case). Read straight off the
   * pass's own `AgentResult.candidatesDeferred` (set by its
   * `postProcessResult`).
   */
  candidatesDeferred: number;
  /** Best-effort human-readable labels for the deferred candidates (capped short list). */
  deferredCandidateIds?: string[];
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
        candidatesDeferred: passResult.candidatesDeferred ?? 0,
        deferredCandidateIds: passResult.deferredCandidateIds,
      });
    }
    merged = spec.mergeFindings(merged, passResult?.findings ?? []);
    spec.mergeResultState(main, passResult, merged);
  }
  return { findings: merged, outcomes };
}
