/**
 * Diff-only summary pass (issue #572, remaining half).
 *
 * `AgentReviewPlugin.shouldActivate` has always required `context.chunks.length
 * > 0` — no analyzable code chunks, no review. That's correct for bug-hunting
 * (there's nothing to investigate), but it also silences the plugin's SUMMARY
 * output on a PR that touches only non-indexed files (docs, config, shell
 * scripts): `runAnalysisPhase`'s zero-analyzable-files fallback in
 * `review-pr.ts` already fetches the PR's patches when `summary` is enabled
 * (`tryFetchPRPatches`), but hardcodes `chunks: []` — so the plugin never even
 * activates, and the PR description ends up with an empty "Low Risk" shell and
 * no overview (see PR #766 as a live repro).
 *
 * This module is the fix's payload: a STRICTLY GATED alternate mode that runs
 * only when there are zero analyzable chunks AND summary review is enabled AND
 * the PR's raw diff is available. It builds its initial message from
 * `pr.patches` instead of chunks, uses a single dedicated "summary-only" rule
 * (no bug-hunting investigation strategy competes for the findings list), and
 * scales the token budget down to a diff-proportional, low-capped amount —
 * this is a summary, not an investigation.
 *
 * Mirrors the `doc-truth-pass.ts` shape: the gate, prompt builder, and budget
 * function live here as pure/deterministic pieces; `index.ts`'s `analyze()`
 * composes them with the shared agent-client runner.
 */

import type { ReviewContext } from '../../plugin-types.js';
import { reviewTokenBudgetMultiplier } from '../../defaults.js';

import type { ReviewRule, ResolvedRules } from './types.js';
import { buildSystemPrompt } from './system-prompt.js';

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

/**
 * The pure triple condition this whole mode is gated on, expressed over
 * primitives so every layer that needs it (the plugin's `shouldActivate`,
 * `review-pr.ts`'s budget selection, and its `eligibilityPath` tagging) can
 * evaluate it from whatever shape of context it has on hand, without each
 * layer re-deriving the boolean logic independently.
 */
export function isSummaryOnlyEligible(
  noAnalyzableChunks: boolean,
  summaryEnabled: boolean,
  hasPatches: boolean,
): boolean {
  return noAnalyzableChunks && summaryEnabled && hasPatches;
}

/** `isSummaryOnlyEligible`, evaluated against a `ReviewContext`. */
export function isSummaryOnlyMode(context: ReviewContext, summaryEnabled: boolean): boolean {
  return isSummaryOnlyEligible(
    context.chunks.length === 0,
    summaryEnabled,
    (context.pr?.patches?.size ?? 0) > 0,
  );
}

// ---------------------------------------------------------------------------
// Rule (single, dedicated — never added to BUILTIN_RULES/selectRules)
// ---------------------------------------------------------------------------

export const SUMMARY_ONLY_RULE: ReviewRule = {
  id: 'summary-only',
  name: 'Diff-Only Summary',
  description:
    'Produce a risk overview from the raw diff alone, for PRs with no analyzable code chunks',
  prompt: `### Diff-Only Summary
This PR touches no files eligible for structural code analysis (e.g. docs,
config, or shell scripts) — there are no indexed code chunks to investigate,
so tools like get_dependents/get_files_context/get_complexity will find
nothing useful here. Base your summary ONLY on the <diff> and
<changed_files> sections below.

Your job is limited to the "summary" field: a concise overview of what
changed and why it matters, a realistic riskLevel, and 2-4 keyChanges
bullets. Do NOT fabricate a code investigation you did not perform, and do
NOT report code "bugs" — there is no analyzable code in this PR to find bugs
in. Leave "findings" empty unless the diff itself reveals an unambiguous,
self-contained problem visible directly in the patch text (e.g. a broken
link, invalid config syntax, a contradiction between two edited docs)
without further investigation.

Budget discipline: this pass has a small, diff-proportional token budget.
Read the diff once, then answer — avoid unnecessary tool calls.`,
  example: `### Good output — docs-only PR, no findings, plain summary:
{
  "findings": [],
  "summary": {
    "riskLevel": "low",
    "overview": "Removes one stale sentence from CLAUDE.md that described packages/runner and platform/ as retired remnants still present in the tree — they were already deleted in an earlier PR. No code or behavior changes.",
    "keyChanges": ["Deleted one outdated line from the monorepo structure list in CLAUDE.md"]
  }
}`,
  triggers: { always: false },
  severity: 'warning',
  category: 'summary',
  enabled: true,
  source: 'builtin',
};

/**
 * Only the summary-only rule is active. `skipped` is unused by
 * `buildSystemPrompt` (it reads `active` only), so an empty list is honest.
 */
export const SUMMARY_ONLY_RULES: ResolvedRules = { active: [SUMMARY_ONLY_RULE], skipped: [] };

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

/** Max diff characters before truncation — small relative to the main pass's
 * 50K (`MAX_DIFF_CHARS` in system-prompt.ts): this mode's whole token budget
 * is capped low (see `scaleSummaryOnlyBudget`), so the diff itself must not
 * consume it all. */
export const MAX_SUMMARY_DIFF_CHARS = 12_000;

function renderSummaryOnlyDiff(context: ReviewContext): string {
  const patches = context.pr?.patches;
  if (!patches || patches.size === 0) return '<diff>\n(no diff available)\n</diff>';
  let diffText = '';
  for (const [file, patch] of patches) {
    diffText += `### ${file}\n\`\`\`diff\n${patch}\n\`\`\`\n\n`;
  }
  if (diffText.length > MAX_SUMMARY_DIFF_CHARS) {
    diffText =
      diffText.slice(0, MAX_SUMMARY_DIFF_CHARS) +
      '\n\n[Diff truncated for this summary-only pass — base your summary on what is shown above.]';
  }
  return `<diff>\n${diffText}</diff>`;
}

function renderSummaryOnlyChangedFiles(context: ReviewContext): string {
  const files = context.allChangedFiles ?? context.changedFiles;
  const list = files.map(f => `- ${f}`).join('\n');
  return `<changed_files>\n${list}\n</changed_files>`;
}

function renderSummaryOnlyPrMetadata(context: ReviewContext): string | null {
  if (!context.pr) return null;
  const body = context.pr.body ? `\nDescription: ${context.pr.body}` : '';
  return `<pr_metadata>\nTitle: ${context.pr.title}${body}\n</pr_metadata>`;
}

/**
 * Build the diff-only initial message: PR header, the changed-files list
 * (from `allChangedFiles` since there are no analyzable chunks to derive it
 * from), and the raw diff — no blast radius, no complexity, no per-rule
 * signal sections (those all key off `context.chunks`, which is empty here).
 */
export function buildSummaryOnlyInitialMessage(context: ReviewContext): string {
  const sections: string[] = [];
  const prMeta = renderSummaryOnlyPrMetadata(context);
  if (prMeta) sections.push(prMeta);
  sections.push(renderSummaryOnlyChangedFiles(context));
  sections.push(renderSummaryOnlyDiff(context));
  sections.push(
    'This PR has no analyzable code chunks. Write a summary per the Diff-Only ' +
      'Summary strategy above, based on the diff, then output it as JSON.',
  );
  return sections.join('\n\n');
}

/**
 * The system + initial prompts for the summary-only pass. The system prompt
 * reuses the standard `buildSystemPrompt` pipeline with ONLY the
 * `summary-only` rule active, so the output format enumerates just that rule
 * id and no bug-hunting investigation strategy appears.
 */
export function buildSummaryOnlyPrompts(context: ReviewContext): {
  systemPrompt: string;
  initialMessage: string;
} {
  return {
    systemPrompt: buildSystemPrompt(SUMMARY_ONLY_RULES),
    initialMessage: buildSummaryOnlyInitialMessage(context),
  };
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

/** Turn cap for the summary-only pass. No chunks to investigate and the
 * evidence (the diff) is inline — this is a read-once-then-answer pass, not
 * a tool-calling investigation. Small but non-zero: the model may still use
 * a tool (e.g. read_file) to double-check something the diff alone doesn't
 * make clear. */
export const SUMMARY_ONLY_MAX_TURNS = 4;

const SUMMARY_ONLY_MIN_BUDGET = 6_000;
/** Low cap — this is a summary, not a review. Well below the normal path's
 * 60K floor (`scaleAgentBudget`'s clamp). */
const SUMMARY_ONLY_MAX_BUDGET = 20_000;
const SUMMARY_ONLY_CHARS_PER_TOKEN = 4;
/** Fixed overhead: system prompt + PR metadata + JSON verdict output,
 * independent of diff size. */
const SUMMARY_ONLY_BASE_OVERHEAD_TOKENS = 2_500;

/**
 * Scale the summary-only pass's token budget proportionally to the diff's
 * size, clamped to a low ceiling. Unlike `scaleAgentBudget` (sized for a
 * multi-phase investigation over indexed chunks), this mode has no chunks and
 * no investigation phases — the diff IS the input, so the budget only needs
 * to cover reading it once plus a compact JSON verdict.
 */
export function scaleSummaryOnlyBudget(
  patches: Map<string, string> | undefined,
  model: string,
): number {
  const diffChars = patches
    ? [...patches.values()].reduce((sum, patch) => sum + patch.length, 0)
    : 0;
  const estimatedDiffTokens = Math.ceil(diffChars / SUMMARY_ONLY_CHARS_PER_TOKEN);
  const base = SUMMARY_ONLY_BASE_OVERHEAD_TOKENS + estimatedDiffTokens;
  const scaled = Math.round(base * reviewTokenBudgetMultiplier(model));
  return Math.min(Math.max(scaled, SUMMARY_ONLY_MIN_BUDGET), SUMMARY_ONLY_MAX_BUDGET);
}
