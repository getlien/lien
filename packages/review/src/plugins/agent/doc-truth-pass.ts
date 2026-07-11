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
 * The orchestration (running the client, merging usage/trace/findings) lives in
 * `index.ts`'s `analyze()`; this module holds the deterministic, LLM-free pieces
 * it composes: the gate, the prompt builder, and the merge helpers. The client
 * runner is injected into `runDocTruthPass` so failure isolation and gating are
 * unit-testable with zero LLM spend.
 */

import type { ReviewContext } from '../../plugin-types.js';
import { renderGuidanceSurfaceSection } from '../../guidance-surface-signals.js';
import { extractDocClaims, renderDocClaimsSection } from '../../doc-claims-signals.js';
import type { Logger } from '../../logger.js';

import type { AgentConfig, AgentFinding, AgentResult, AgentTrace, ResolvedRules } from './types.js';
import { DOC_TRUTH } from './rules.js';
import { buildSystemPrompt } from './system-prompt.js';
import { envDisabled } from './agent-client-shared.js';

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
 * Whether to run the doc-truth second pass. True iff the PR added at least one
 * claim-shaped line to a touched guidance/doc surface (which also implies a doc
 * surface was touched), and neither the config nor the env kill-switch disables
 * it. Extraction is the same deterministic pass the main prompt already runs,
 * so a non-empty worklist here means the pass has something to verify.
 */
export function shouldRunDocTruthPass(context: ReviewContext, config?: AgentConfig): boolean {
  if (config?.docTruthPass === false) return false;
  if (envDisabled(process.env[DOC_PASS_ENV])) return false;
  const patches = context.pr?.patches;
  if (!patches || patches.size === 0) return false;
  return extractDocClaims(patches).length > 0;
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
 * evidence, and the <guidance_surface_changes> hunks (the isGuidanceSurface-
 * filtered, budget-capped diff of exactly the touched doc surfaces — the same
 * block the doc-truth rule and the doc_claims header reference by name). No
 * blast-radius, complexity, or other-rule signals: no competition, no
 * distraction.
 */
export function buildDocTruthPassInitialMessage(context: ReviewContext): string {
  const sections: string[] = [];
  pushIfPresent(sections, renderPrHeader(context));
  sections.push(DOC_PASS_INTRO);
  pushIfPresent(sections, renderDocClaimsSection(context));
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

// ---------------------------------------------------------------------------
// Runner (client injected for zero-LLM testing)
// ---------------------------------------------------------------------------

/**
 * Runs the doc-truth client loop for the given prompts and budget. Injected
 * into `runDocTruthPass` so the gate, prompt build, and failure isolation are
 * unit-testable without a real client. `index.ts` supplies a closure over
 * `runAgentClient` (with the shared tool executor) as the production impl.
 */
export type DocTruthClientRunner = (
  systemPrompt: string,
  initialMessage: string,
  maxTokenBudget: number,
  maxTurns: number,
) => Promise<AgentResult>;

/**
 * Run the second, claims-only doc-truth pass when the PR warrants it. Returns
 * the pass's AgentResult, or null when the pass is gated off OR when it fails —
 * a pass-2 error must never fail the whole review, so it is caught, logged, and
 * swallowed here (the caller keeps the main-pass findings).
 */
export async function runDocTruthPass(
  context: ReviewContext,
  config: AgentConfig,
  logger: Logger,
  runClient: DocTruthClientRunner,
): Promise<AgentResult | null> {
  if (!shouldRunDocTruthPass(context, config)) return null;
  try {
    const { systemPrompt, initialMessage } = buildDocTruthPassPrompts(context);
    const budget = docTruthPassBudget(config.maxTokenBudget);
    const result = await runClient(systemPrompt, initialMessage, budget, DOC_PASS_MAX_TURNS);
    logger.info(
      `[agent] doc-truth pass: ${result.findings.length} finding(s) in ${result.turns} turn(s) ($${result.usage.cost.toFixed(4)})`,
    );
    return result;
  } catch (err) {
    logger.warning(
      `[agent] doc-truth pass failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

/** Same file and within DEDUPE_LINE_PROXIMITY lines — treat as one location. */
function sameLocation(a: AgentFinding, b: AgentFinding): boolean {
  return a.filepath === b.filepath && Math.abs(a.line - b.line) <= DEDUPE_LINE_PROXIMITY;
}

/**
 * Fold the doc pass's findings into the main pass's. Every doc-pass finding gets
 * `ruleId: 'doc-truth'` (the pass has a single rule, so attribution is
 * unambiguous regardless of what the model emitted). A doc-pass finding is
 * dropped when the main pass already reported one at the same file within
 * DEDUPE_LINE_PROXIMITY lines — the main-pass version is kept. Returns a new
 * array; inputs are not mutated.
 */
export function mergeDocTruthFindings(
  mainFindings: AgentFinding[],
  docFindings: AgentFinding[],
): AgentFinding[] {
  const forced = docFindings.map(f => ({ ...f, ruleId: 'doc-truth' }));
  const kept = forced.filter(df => !mainFindings.some(mf => sameLocation(mf, df)));
  return [...mainFindings, ...kept];
}

/**
 * Append the doc pass's turns to the main trace so the single trace surfaced via
 * `reportTrace` carries BOTH passes: the harness derives tool calls and turn
 * count from `trace.turns`, so main-pass `expectToolCalled` assertions keep
 * working while the doc pass's tool calls also become visible. Doc turns are
 * renumbered to continue after the main pass and stamped `phase: 'doc-truth'`.
 * No-op when either trace is absent (production runners don't capture traces).
 */
export function appendDocTruthTurns(
  mainTrace: AgentTrace | undefined,
  docTrace: AgentTrace | undefined,
): void {
  if (!mainTrace || !docTrace) return;
  const offset = mainTrace.turns.length;
  for (const turn of docTrace.turns) {
    mainTrace.turns.push({ ...turn, turnNumber: offset + turn.turnNumber, phase: 'doc-truth' });
  }
}
