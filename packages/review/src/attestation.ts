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
// Schema (v1)
// ---------------------------------------------------------------------------

export const ATTESTATION_VERSION = 1 as const;

/** `AgentStopReason` plus `'not_run'` for a pass that was never attempted. */
export type ProviderStopReason = AgentStopReason | 'not_run';

export interface ProviderPassAttestation {
  name: 'main';
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

export interface BudgetAttestation {
  allocatedTokens: number;
  spentTokens: number;
  /** Ran out of budget before finishing — the main pass's `stopReason` was `'budget'`. */
  starved: boolean;
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
  descriptionBadge: { updated: boolean };
  /** null when no plugin attempted an out-of-diff review comment this run. */
  outOfDiffReviewPosted: boolean | null;
}

export type EligibilityPath = 'normal' | 'zero_files_early_exit' | 'full_repo_fallback';

export interface ScopeAttestation {
  eligibilityPath: EligibilityPath;
  filesAnalyzed: number;
}

/**
 * `degraded:provider_partial` covers any non-`neverRan` incomplete stop
 * (`max_turns`, or `completed` without a parseable verdict) that budget
 * exhaustion doesn't already explain more specifically.
 * `failed:analysis_error` covers a pre-engine pipeline failure (the
 * complexity report itself couldn't be built) — distinct from a provider
 * failure, but still not a "delivered" run.
 */
export type AttestationVerdict =
  | 'delivered'
  | 'degraded:provider_partial'
  | 'degraded:budget_starved'
  | 'degraded:comments_dropped'
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
 * outranks everything — nothing was analyzed. Budget starvation is a more
 * specific, more actionable diagnosis than the generic "partial" bucket, so
 * it's checked first among incomplete-stop reasons. Dropped inline comments
 * only matter once the review itself came back clean.
 */
export function computeVerdict(input: {
  pipelineFailed: boolean;
  providerFailure: boolean;
  mainPass: ProviderPassAttestation;
  budget: BudgetAttestation;
  inlineComments: InlineCommentsAttestation;
}): AttestationVerdict {
  if (input.pipelineFailed) return 'failed:analysis_error';
  if (input.providerFailure) return 'failed:provider_never_ran';
  if (input.mainPass.ran && input.mainPass.stopReason !== 'completed') {
    return input.budget.starved ? 'degraded:budget_starved' : 'degraded:provider_partial';
  }
  if (input.inlineComments.dropped > 0) return 'degraded:comments_dropped';
  return 'delivered';
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
  allocatedTokens: number;
  spentTokens: number;
  passesSkipped: SkippedPass[];
  annotationsEmitted: number;
  inlineComments: InlineCommentsAttestation;
  descriptionBadgeUpdated: boolean;
  outOfDiffReviewPosted: boolean | null;
  /** True for the pre-engine "couldn't build a complexity report" failure path. */
  pipelineFailed?: boolean;
}

export function assembleAttestation(input: AttestationInput): Attestation {
  const mainPass = deriveMainPassAttestation(
    input.findings,
    input.agentAttempted,
    input.providerFailure,
  );
  const budget: BudgetAttestation = {
    allocatedTokens: input.allocatedTokens,
    spentTokens: input.spentTokens,
    starved: mainPass.stopReason === 'budget',
  };
  const verdict = computeVerdict({
    pipelineFailed: input.pipelineFailed ?? false,
    providerFailure: input.providerFailure,
    mainPass,
    budget,
    inlineComments: input.inlineComments,
  });

  return {
    attestationVersion: ATTESTATION_VERSION,
    run: { conclusion: input.conclusion, filesAnalyzed: input.filesAnalyzed },
    provider: { passes: input.agentAttempted ? [mainPass] : [] },
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
    descriptionBadgeUpdated: false,
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
