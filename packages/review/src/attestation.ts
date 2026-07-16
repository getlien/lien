/**
 * Delivery attestation — a machine-readable receipt for a single Lien Review
 * run, answering "did the review actually happen and reach the PR" as a
 * structured, versioned record rather than prose scattered across findings,
 * logs, and a swallowed `.catch()`.
 *
 * Every value plumbed in here is already computed somewhere in the pipeline
 * (agent-review's `AgentResult`, `postPRReview`'s `PostReviewResult`, the
 * engine's skip/annotation bookkeeping) — this module only assembles and
 * classifies it. No new detection logic, no LLM calls: the same
 * precompute-a-signal-block pattern as `blast-radius.ts` and
 * `stale-literal-signals.ts`, applied to operational state instead of code
 * findings.
 *
 * See `.wip/attestation-design.md` for the full design (schema rationale,
 * the two discard-point bugs this closes, and the open questions this file's
 * behavior resolves).
 */

import type { ReviewFinding } from './plugin-types.js';
import type { AgentStopReason } from './plugins/agent/types.js';

// ---------------------------------------------------------------------------
// Schema (v2)
// ---------------------------------------------------------------------------

/**
 * v2 (this generalization): `provider.passes[]` grows past length 1 for the
 * first time — one entry per pass the agent-review plugin actually ran
 * (main, plus any extra pass like doc-truth), not just the main pass — and
 * `BudgetAttestation` gains a per-pass breakdown. Both are additive shape
 * changes, but the version bump is a deliberate owner call (not the
 * "additive fields don't bump it" convention) because this is the first time
 * `passes`/`budget` carry more than one pass's worth of data; a consumer that
 * assumed `passes.length <= 1` would have silently ignored real data before
 * this bump. v1 attestations (`passes: [mainPass]` only) remain valid v2
 * shapes — nothing about the v1 schema was removed or renamed.
 */
export const ATTESTATION_VERSION = 2 as const;

/** `AgentStopReason` plus `'not_run'` for a pass that was never attempted. */
export type ProviderStopReason = AgentStopReason | 'not_run';

export interface ProviderPassAttestation {
  /** `'main'` for the primary investigation, or an extra pass's own name (e.g. `'doc-truth'`). */
  name: string;
  ran: boolean;
  stopReason: ProviderStopReason;
  /** Every provider request failed terminally — zero completed turns. */
  neverRan: boolean;
}

/** A plugin (or a plugin's internal sub-pass) that didn't run this turn, and why. */
export interface SkippedPass {
  plugin: string;
  reason: string;
}

/** One pass's own token allocation/spend — the breakdown behind `BudgetAttestation`'s aggregate. */
export interface PassBudgetAttestation {
  name: string;
  allocatedTokens: number;
  spentTokens: number;
  /** This SPECIFIC pass ran out of budget before finishing (`stopReason === 'budget'`). */
  starved: boolean;
}

export interface BudgetAttestation {
  /** Sum of every pass's `allocatedTokens`. */
  allocatedTokens: number;
  /** Sum of every pass's `spentTokens`. */
  spentTokens: number;
  /** True when ANY pass starved — see `passes[]` for which one. */
  starved: boolean;
  /**
   * Per-pass breakdown. Before this field existed, a doc-truth-only budget
   * starvation was only visible aggregated into the main pass's numbers —
   * indistinguishable from the main pass itself starving. Empty when the
   * agent-review plugin didn't run at all.
   */
  passes: PassBudgetAttestation[];
}

export interface InlineCommentsAttestation {
  /** Candidate inline comments the plugin wanted to post. */
  attempted: number;
  /** Actually landed on the PR, per `PostReviewResult` — not the attempted count. */
  posted: number;
  /** Failed to land: outside the diff, or dropped by GitHub on anchor validation. */
  dropped: number;
  /** Skipped because an equivalent comment already existed from a prior run. */
  deduped: number;
}

export interface DeliveryAttestation {
  annotationsEmitted: number;
  inlineComments: InlineCommentsAttestation;
  /** null when no plugin contributed a description section this run (nothing to update). */
  descriptionBadge: { updated: boolean | null };
  /** null when no plugin attempted an out-of-diff review comment this run. */
  outOfDiffReviewPosted: boolean | null;
}

/**
 * `summary_only_diff` (#572): zero analyzable files, but the diff-only
 * summary-only agent mode ran (summary review type on, non-empty PR diff) —
 * distinct from `full_repo_fallback`, where the agent didn't run at all
 * (summary off, or no diff data available).
 */
export type EligibilityPath =
  | 'normal'
  | 'zero_files_early_exit'
  | 'full_repo_fallback'
  | 'summary_only_diff';

export interface ScopeAttestation {
  eligibilityPath: EligibilityPath;
  filesAnalyzed: number;
}

/**
 * `degraded:provider_partial` covers any non-`neverRan` incomplete stop
 * (`max_turns`, or `completed` without a parseable verdict) that budget
 * exhaustion doesn't already explain more specifically.
 * `degraded:delivery_incomplete` covers a description-badge update or an
 * out-of-diff review comment that was attempted and failed to land — distinct
 * from `comments_dropped` (which is about the per-finding inline comments).
 * `failed:analysis_error` covers a pre-engine pipeline failure (the
 * complexity report itself couldn't be built) — distinct from a provider
 * failure, but still not a "delivered" run.
 */
export type AttestationVerdict =
  | 'delivered'
  | 'degraded:provider_partial'
  | 'degraded:budget_starved'
  | 'degraded:comments_dropped'
  | 'degraded:delivery_incomplete'
  | 'failed:provider_never_ran'
  | 'failed:analysis_error';

export interface Attestation {
  attestationVersion: typeof ATTESTATION_VERSION;
  run: { conclusion: 'success' | 'failure' | 'neutral'; filesAnalyzed: number };
  provider: { passes: ProviderPassAttestation[] };
  budget: BudgetAttestation;
  passesSkipped: SkippedPass[];
  delivery: DeliveryAttestation;
  scope: ScopeAttestation;
  verdict: AttestationVerdict;
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/** Narrow shape of the metadata `appendIncompleteNotice`/`appendNeverRanNotice` attach. */
interface AgentSummaryMetadata {
  incomplete?: boolean;
  neverRan?: boolean;
  stopReason?: AgentStopReason;
}

/**
 * Derive the main agent-review pass's outcome from its findings. Reliable
 * because the notice-appending helpers in `plugins/agent/index.ts` are
 * exhaustive: a neverRan or incomplete run always leaves a marked summary
 * finding, and a run that completed cleanly leaves neither — so their
 * absence IS the "completed" signal, not just a default.
 */
export function deriveMainPassAttestation(
  findings: ReviewFinding[],
  agentAttempted: boolean,
  providerFailure: boolean,
): ProviderPassAttestation {
  if (!agentAttempted) {
    return { name: 'main', ran: false, stopReason: 'not_run', neverRan: false };
  }
  if (providerFailure) {
    return { name: 'main', ran: true, stopReason: 'error', neverRan: true };
  }
  const incompleteFinding = findings.find(
    f => (f.metadata as AgentSummaryMetadata | undefined)?.incomplete === true,
  );
  if (incompleteFinding) {
    const stopReason = (incompleteFinding.metadata as AgentSummaryMetadata).stopReason ?? 'error';
    return { name: 'main', ran: true, stopReason, neverRan: false };
  }
  return { name: 'main', ran: true, stopReason: 'completed', neverRan: false };
}

/**
 * Verdict precedence (most to least severe): a provider that never ran at all
 * outranks everything — nothing was analyzed. Among the passes that DID run,
 * the first one (in `passes` order — main first, then any extra pass) whose
 * `stopReason !== 'completed'` decides the degraded verdict: budget
 * starvation is a more specific, more actionable diagnosis than the generic
 * "partial" bucket, so a pass that stopped on `'budget'` reports
 * `degraded:budget_starved` and anything else reports
 * `degraded:provider_partial` — attributed to WHICHEVER pass actually
 * stopped, not hardcoded to the main pass (the bug this generalization
 * fixes: before per-pass attestation existed, a doc-truth-only budget
 * starvation was folded into the main pass's own `stopReason` upstream — see
 * `doc-truth-pass.ts`'s `mergeDocPassIntoResult` — so this verdict looked
 * identical whether it was main or an extra pass that actually starved).
 * Dropped inline comments and other delivery failures only matter once every
 * pass came back clean. `descriptionBadgeUpdated`/`outOfDiffReviewPosted` are
 * checked against `=== false` specifically (not falsy) — `null`/`undefined`
 * means "nothing was attempted this run", which is not a failure.
 */
export function computeVerdict(input: {
  pipelineFailed: boolean;
  providerFailure: boolean;
  passes: ProviderPassAttestation[];
  inlineComments: InlineCommentsAttestation;
  descriptionBadgeUpdated?: boolean | null;
  outOfDiffReviewPosted?: boolean | null;
}): AttestationVerdict {
  if (input.pipelineFailed) return 'failed:analysis_error';
  if (input.providerFailure) return 'failed:provider_never_ran';
  const incompletePass = input.passes.find(p => p.ran && p.stopReason !== 'completed');
  if (incompletePass) {
    return incompletePass.stopReason === 'budget'
      ? 'degraded:budget_starved'
      : 'degraded:provider_partial';
  }
  if (input.inlineComments.dropped > 0) return 'degraded:comments_dropped';
  if (input.descriptionBadgeUpdated === false || input.outOfDiffReviewPosted === false) {
    return 'degraded:delivery_incomplete';
  }
  return 'delivered';
}

/** One extra pass's outcome + its own budget, as reported by `plugins/agent/review-pass.ts`'s `PassOutcome`. */
export interface ExtraPassAttestationInput {
  name: string;
  stopReason: ProviderStopReason;
  neverRan: boolean;
  allocatedTokens: number;
  spentTokens: number;
}

export interface AttestationInput {
  conclusion: 'success' | 'failure' | 'neutral';
  filesAnalyzed: number;
  eligibilityPath: EligibilityPath;
  findings: ReviewFinding[];
  /** Was the agent-review plugin registered AND not skipped by shouldActivate? */
  agentAttempted: boolean;
  /** `hasProviderFailure(findings)` — the existing SSOT (see plugins/agent/index.ts). */
  providerFailure: boolean;
  /** The MAIN pass's own allocated ceiling and spent tokens (not the run's aggregate — see `extraPasses`). */
  allocatedTokens: number;
  spentTokens: number;
  /**
   * Any pass beyond main that actually ran (e.g. doc-truth) — one entry per
   * pass, each with its own outcome and budget. Defaults to `[]`: the common
   * case (no extra pass fired, or none exists) needs nothing here. Ignored
   * when `agentAttempted` is false (an extra pass can't run without main).
   */
  extraPasses?: ExtraPassAttestationInput[];
  passesSkipped: SkippedPass[];
  annotationsEmitted: number;
  inlineComments: InlineCommentsAttestation;
  /** null when no plugin contributed a description section this run (nothing to update). */
  descriptionBadgeUpdated: boolean | null;
  outOfDiffReviewPosted: boolean | null;
  /** True for the pre-engine "couldn't build a complexity report" failure path. */
  pipelineFailed?: boolean;
}

/** Build one pass's budget entry — shared between the main pass and every extra pass. */
function passBudget(
  name: string,
  stopReason: ProviderStopReason,
  allocated: number,
  spent: number,
): PassBudgetAttestation {
  return { name, allocatedTokens: allocated, spentTokens: spent, starved: stopReason === 'budget' };
}

/**
 * Build the full `passes[]` (main + extra) and the aggregated
 * `BudgetAttestation` from them. Extracted from `assembleAttestation` to
 * keep that function's own complexity down — this is the piece that grew
 * when per-pass attestation generalized past a single hardcoded main pass.
 * Both are empty/zeroed when the agent-review plugin was never attempted —
 * an extra pass can't run without main (see `runExtraPasses`).
 */
function buildPassesAndBudget(
  input: AttestationInput,
  mainPass: ProviderPassAttestation,
): { passes: ProviderPassAttestation[]; budget: BudgetAttestation } {
  if (!input.agentAttempted) {
    return {
      passes: [],
      budget: { allocatedTokens: 0, spentTokens: 0, starved: false, passes: [] },
    };
  }
  const extraPasses = input.extraPasses ?? [];
  const passes: ProviderPassAttestation[] = [
    mainPass,
    ...extraPasses.map(p => ({
      name: p.name,
      ran: true,
      stopReason: p.stopReason,
      neverRan: p.neverRan,
    })),
  ];
  const passBudgets: PassBudgetAttestation[] = [
    passBudget(mainPass.name, mainPass.stopReason, input.allocatedTokens, input.spentTokens),
    ...extraPasses.map(p => passBudget(p.name, p.stopReason, p.allocatedTokens, p.spentTokens)),
  ];
  const budget: BudgetAttestation = {
    allocatedTokens: passBudgets.reduce((sum, p) => sum + p.allocatedTokens, 0),
    spentTokens: passBudgets.reduce((sum, p) => sum + p.spentTokens, 0),
    starved: passBudgets.some(p => p.starved),
    passes: passBudgets,
  };
  return { passes, budget };
}

export function assembleAttestation(input: AttestationInput): Attestation {
  const mainPass = deriveMainPassAttestation(
    input.findings,
    input.agentAttempted,
    input.providerFailure,
  );
  const { passes, budget } = buildPassesAndBudget(input, mainPass);
  const verdict = computeVerdict({
    pipelineFailed: input.pipelineFailed ?? false,
    providerFailure: input.providerFailure,
    passes,
    inlineComments: input.inlineComments,
    descriptionBadgeUpdated: input.descriptionBadgeUpdated,
    outOfDiffReviewPosted: input.outOfDiffReviewPosted,
  });

  return {
    attestationVersion: ATTESTATION_VERSION,
    run: { conclusion: input.conclusion, filesAnalyzed: input.filesAnalyzed },
    provider: { passes },
    budget,
    passesSkipped: input.passesSkipped,
    delivery: {
      annotationsEmitted: input.annotationsEmitted,
      inlineComments: input.inlineComments,
      descriptionBadge: { updated: input.descriptionBadgeUpdated },
      outOfDiffReviewPosted: input.outOfDiffReviewPosted,
    },
    scope: { eligibilityPath: input.eligibilityPath, filesAnalyzed: input.filesAnalyzed },
    verdict,
  };
}

/** Zero-value attestation for the early-return paths where the engine never ran. */
export function emptyAttestation(
  conclusion: 'success' | 'failure',
  filesAnalyzed: number,
  eligibilityPath: EligibilityPath,
  pipelineFailed = false,
): Attestation {
  return assembleAttestation({
    conclusion,
    filesAnalyzed,
    eligibilityPath,
    findings: [],
    agentAttempted: false,
    providerFailure: false,
    allocatedTokens: 0,
    spentTokens: 0,
    passesSkipped: [],
    annotationsEmitted: 0,
    inlineComments: { attempted: 0, posted: 0, dropped: 0, deduped: 0 },
    descriptionBadgeUpdated: null,
    outOfDiffReviewPosted: null,
    pipelineFailed,
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * One compact line for the PR description — only meant to be shown when
 * `verdict !== 'delivered'` (a clean run doesn't need the line; see the
 * budget-discipline precedent in `guidance-surface-signals.ts`).
 */
export function formatAttestationBadgeLine(attestation: Attestation): string {
  const { inlineComments } = attestation.delivery;
  const parts = [`Attested: ${attestation.verdict}`];
  if (inlineComments.attempted > 0) {
    parts.push(`${inlineComments.posted}/${inlineComments.attempted} comments posted`);
  }
  if (attestation.budget.allocatedTokens > 0) {
    parts.push(
      `${formatKTokens(attestation.budget.spentTokens)}/${formatKTokens(attestation.budget.allocatedTokens)} tokens`,
    );
  }
  return parts.join(' · ');
}

function formatKTokens(tokens: number): string {
  return `${Math.round(tokens / 1000)}K`;
}
