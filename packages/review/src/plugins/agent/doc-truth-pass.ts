/**
 * Dedicated doc-truth second pass (issue #732).
 *
 * A single review call gives all nine rules one findings list to compete for,
 * under a prompt that rewards concision. On a doc-touching PR that also carries
 * real code bugs, documentation drift rationally loses that competition — a
 * failure verified to be architectural, not model-bound (Sonnet 5 fails pr667
 * exactly like Kimi). This module removes the competition: for a PR that
 * touched documentation/guidance surfaces, run a SECOND, claims-only review
 * after the main pass, with the doc-truth rule as the only active rule and only
 * the doc-claim signals in the prompt — no blast radius, no complexity, no code
 * bugs to chase. Its findings fold back into the main review's output.
 *
 * This module holds doc-truth's deterministic, LLM-free pieces: the gate, the
 * prompt builder, the budget, and the merge helpers. They are bundled at the
 * bottom into `DOC_TRUTH_PASS_SPEC`, a `ReviewPassSpec` (see `review-pass.ts`)
 * that the generic `runReviewPass`/`runExtraPasses` executor runs — that
 * generic executor owns the client-run/failure-isolation/reporting plumbing
 * this module used to own itself (`runDocTruthPass`, `appendDocTruthTurns`),
 * so every piece here stays unit-testable with zero LLM spend.
 */

import type { ReviewContext } from '../../plugin-types.js';
import { renderGuidanceSurfaceSection } from '../../guidance-surface-signals.js';
import { extractDocClaims, renderDocClaimsSection } from '../../doc-claims-signals.js';
import { renderRenameSweepSection } from '../../rename-sweep-signals.js';

import type { AgentConfig, AgentFinding, AgentResult, ResolvedRules } from './types.js';
import { DOC_TRUTH } from './rules.js';
import { buildSystemPrompt } from './system-prompt.js';
import { envDisabled } from './agent-client-shared.js';
import type { ReviewPassSpec } from './review-pass.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Turn cap for the claims-only pass. The evidence is inline (the <doc_claims>
 * worklist pre-computes each claim's code excerpt), so verification is a
 * comparison, not an investigation — it rarely needs the tool loop. A small cap
 * keeps a doc-heavy PR from spending main-pass-sized budget on the second call.
 */
export const DOC_PASS_MAX_TURNS = 6;

/**
 * The doc pass's token budget as a fraction of the main pass's base budget.
 * ~40% is ample for a claims-only pass whose input is the (already compact)
 * doc-claim signals rather than the full diff + all signals.
 */
export const DOC_PASS_BUDGET_FRACTION = 0.4;

/** Env kill-switch (parity with the client's LIEN_REVIEW_LOG_AGENT style). */
const DOC_PASS_ENV = 'LIEN_REVIEW_DOC_PASS';

/**
 * Two findings on the same file within this many lines are treated as the same
 * location when deduping the doc pass against the main pass.
 */
const DEDUPE_LINE_PROXIMITY = 2;

/**
 * Only the doc-truth rule is active in the second pass. `skipped` is unused by
 * `buildSystemPrompt` (it reads `active` only), so an empty list is honest here.
 */
const DOC_TRUTH_ONLY_RULES: ResolvedRules = { active: [DOC_TRUTH], skipped: [] };

const DOC_PASS_INTRO =
  'This is a DOCUMENTATION-TRUTHFULNESS review — a dedicated second pass over a ' +
  'PR that touched documentation/guidance surfaces. Your ONLY job is to verify ' +
  'the behavioral and structural CLAIMS those surfaces make against the code the ' +
  'PR changed. Do NOT report code bugs, style, naming, or anything outside ' +
  'documentation truthfulness — those are handled elsewhere. Work the ' +
  '<doc_claims> worklist: for each claim, compare it against its evidence ' +
  'excerpt (or locate the described code via get_files_context when no excerpt ' +
  'is attached), and emit a doc-truth finding only when the code CONTRADICTS the ' +
  'claim — or when the diff changed the behavior and left the prose describing ' +
  'the OLD behavior. A claim the code confirms needs no finding.\n\n' +
  'Compare claims STRICTLY, not charitably. When a claim enumerates conditions, ' +
  'requirements, gates, or a key/file list, the enumeration must match the code ' +
  'EXACTLY: a condition the code checks but the claim omits IS a contradiction ' +
  '(the doc tells readers a weaker rule than the code enforces), and so is a ' +
  'condition the claim states but the code does not check. "Close enough", ' +
  '"covers the main case", or "the extra condition is an implementation detail" ' +
  'are NOT confirmations — if the enumerations differ, report it and cite both ' +
  'sides. Descriptive prose without a checkable enumeration or behavior stays ' +
  'held to the ordinary contradicts-or-confirms standard.\n\n' +
  'Budget discipline: an evidence excerpt attached to a claim IS the described ' +
  'code — compare against it directly and do NOT re-read that file with tools; ' +
  'spend tool calls ONLY on claims with no attached evidence. Your budget is ' +
  'sized for comparisons, not re-investigation: emit your verdict JSON as soon ' +
  'as the worklist is judged, and if you approach the budget, output the ' +
  'verdict for the claims you have judged rather than reading more files.';

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

/**
 * Precisely why the doc-truth pass would not run right now, or null if it
 * should run. Kept separate from `shouldRunDocTruthPass`'s boolean so a
 * caller reporting the skip to the delivery attestation (see this module's
 * `DOC_TRUTH_PASS_SPEC.gateReason`, run by `review-pass.ts`'s
 * `runReviewPass`) can name the REAL reason — config-disabled, env-disabled,
 * or no doc claims are three different operational states that a bare
 * boolean collapses into one.
 */
export function docTruthSkipReason(context: ReviewContext, config?: AgentConfig): string | null {
  if (config?.docTruthPass === false) return 'disabled via config (docTruthPass: false)';
  if (envDisabled(process.env[DOC_PASS_ENV])) return `disabled via ${DOC_PASS_ENV} env var`;
  const patches = context.pr?.patches;
  if (!patches || patches.size === 0) return 'no PR patch data available';
  if (extractDocClaims(patches).length === 0) return 'not a doc-touching PR (no doc claims)';
  return null;
}

/**
 * Whether to run the doc-truth second pass. True iff the PR added at least one
 * claim-shaped line to a touched guidance/doc surface (which also implies a doc
 * surface was touched), and neither the config nor the env kill-switch disables
 * it. Extraction is the same deterministic pass the main prompt already runs,
 * so a non-empty worklist here means the pass has something to verify.
 */
export function shouldRunDocTruthPass(context: ReviewContext, config?: AgentConfig): boolean {
  return docTruthSkipReason(context, config) === null;
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

/** Push a section only when it is a non-empty string (signal renderers return ''). */
function pushIfPresent(sections: string[], value: string | null | undefined): void {
  if (value) sections.push(value);
}

/** The PR title/body header, mirroring the main pass's <pr_metadata> block. */
function renderPrHeader(context: ReviewContext): string | null {
  if (!context.pr) return null;
  const body = context.pr.body ? `\nDescription: ${context.pr.body}` : '';
  return `<pr_metadata>\nTitle: ${context.pr.title}${body}\n</pr_metadata>`;
}

/**
 * Build the claims-only initial message: the PR header, the intro that scopes
 * the pass to doc-truth, the <doc_claims> worklist WITH its pre-fetched
 * evidence, the <rename_sweep> block when the diff carries a mechanical
 * identifier-rename sweep (the doc-truth rule's protocol explicitly tells the
 * agent to check for this block — see rules.ts — as a supplementary
 * claim-verification worklist, so it must actually be rendered here), and the
 * <guidance_surface_changes> hunks (the isGuidanceSurface-filtered,
 * budget-capped diff of exactly the touched doc surfaces — the same block the
 * doc-truth rule and the doc_claims header reference by name). No
 * blast-radius, complexity, or other-rule signals: no competition, no
 * distraction.
 */
export function buildDocTruthPassInitialMessage(context: ReviewContext): string {
  const sections: string[] = [];
  pushIfPresent(sections, renderPrHeader(context));
  sections.push(DOC_PASS_INTRO);
  pushIfPresent(sections, renderDocClaimsSection(context));
  pushIfPresent(sections, renderRenameSweepSection(context));
  pushIfPresent(sections, renderGuidanceSurfaceSection(context));
  sections.push(
    'Verify each claim against the code, then output findings as JSON. If every ' +
      'claim checks out, output an empty findings array with a low-risk summary.',
  );
  return sections.join('\n\n');
}

/**
 * The system + initial prompts for the doc-truth pass. The system prompt is the
 * standard agent prompt with ONLY the doc-truth rule active (so the output
 * format enumerates just `doc-truth` and no competing investigation strategies
 * appear).
 */
export function buildDocTruthPassPrompts(context: ReviewContext): {
  systemPrompt: string;
  initialMessage: string;
} {
  return {
    systemPrompt: buildSystemPrompt(DOC_TRUTH_ONLY_RULES),
    initialMessage: buildDocTruthPassInitialMessage(context),
  };
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

/** The doc pass's token budget: a fraction of the main pass's base budget. */
export function docTruthPassBudget(baseBudget: number): number {
  return Math.round(baseBudget * DOC_PASS_BUDGET_FRACTION);
}

/** Plugin name the doc-truth pass reports itself under in the delivery attestation. */
const DOC_TRUTH_SKIP_PLUGIN = 'agent-review:doc-truth';

// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

/** Same file and within DEDUPE_LINE_PROXIMITY lines — treat as one location. */
function sameLocation(a: AgentFinding, b: AgentFinding): boolean {
  return a.filepath === b.filepath && Math.abs(a.line - b.line) <= DEDUPE_LINE_PROXIMITY;
}

/** error outranks warning — used so dedupe never drops the sharper finding. */
function severityRank(f: AgentFinding): number {
  return f.severity === 'error' ? 1 : 0;
}

/**
 * Fold the doc pass's findings into the main pass's. Every doc-pass finding gets
 * `ruleId: 'doc-truth'` (the pass has a single rule, so attribution is
 * unambiguous regardless of what the model emitted). A doc-pass finding is
 * dropped only when the main pass already reported one at the same location
 * (same file, within DEDUPE_LINE_PROXIMITY lines) AT LEAST AS SEVERE — a
 * doc-truth `error` must not be silenced by a nearby main-pass `warning`.
 * Returns a new array; inputs are not mutated.
 */
export function mergeDocTruthFindings(
  mainFindings: AgentFinding[],
  docFindings: AgentFinding[],
): AgentFinding[] {
  const forced = docFindings.map(f => ({ ...f, ruleId: 'doc-truth' }));
  const kept = forced.filter(
    df => !mainFindings.some(mf => sameLocation(mf, df) && severityRank(mf) >= severityRank(df)),
  );
  return [...mainFindings, ...kept];
}

/**
 * Merge the doc pass's RESULT-LEVEL state into the main pass's before the
 * summary/incomplete notices are appended. The render path (`present()` /
 * `formatCheckSummary()`) consumes a SINGLE summary-category finding — a
 * second appended notice is never rendered — so doc-pass state must be folded
 * into the one summary the main pass owns:
 *  - incomplete: an unfinished doc pass marks the merged result incomplete
 *    (with the doc pass's stopReason when the main pass finished cleanly);
 *  - risk: doc-truth `error` findings lift a low/absent risk level to medium
 *    and note the documentation contradictions in the overview, so the
 *    headline can't read "Low Risk / no issues" above doc-truth errors.
 * Mutates and returns `main` (the caller owns it).
 */
export function mergeDocPassIntoResult(
  main: AgentResult,
  docResult: AgentResult | null,
  mergedFindings: AgentFinding[],
): AgentResult {
  if (!docResult) return main;

  if (docResult.incomplete && !main.incomplete) {
    main.incomplete = true;
    main.stopReason = docResult.stopReason;
    main.incompleteFromDocPass = true;
  }

  const docErrors = mergedFindings.filter(
    f => f.ruleId === 'doc-truth' && f.severity === 'error',
  ).length;
  if (docErrors > 0 && main.summary) {
    const level = main.summary.riskLevel?.toLowerCase();
    if (level === undefined || level === 'low') main.summary.riskLevel = 'medium';
    main.summary.overview =
      `${main.summary.overview} The documentation-truthfulness pass found ` +
      `${docErrors} contradiction(s) between touched docs and the code — see the doc-truth findings.`;
  }
  return main;
}

// ---------------------------------------------------------------------------
// ReviewPassSpec (plugs doc-truth into the generalized executor)
// ---------------------------------------------------------------------------

/**
 * Doc-truth bundled as a `ReviewPassSpec` (see `review-pass.ts`) — the first
 * (and, before that generalization, only) entry in `index.ts`'s extra-pass
 * list. Every field here is one of this module's own pure functions; the
 * generic executor supplies the gate-check/run/failure-isolation/reporting
 * plumbing that used to be doc-truth-specific (`runDocTruthPass`,
 * `appendDocTruthTurns`).
 */
export const DOC_TRUTH_PASS_SPEC: ReviewPassSpec = {
  name: 'doc-truth',
  skipPlugin: DOC_TRUTH_SKIP_PLUGIN,
  gateReason: docTruthSkipReason,
  buildPrompts: buildDocTruthPassPrompts,
  budget: docTruthPassBudget,
  maxTurns: DOC_PASS_MAX_TURNS,
  mergeFindings: mergeDocTruthFindings,
  mergeResultState: mergeDocPassIntoResult,
};
