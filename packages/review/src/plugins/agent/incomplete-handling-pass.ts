/**
 * Dedicated incomplete-handling candidate-loop (per-rule-loops design doc
 * §7 item 5, `.wip/per-rule-loops-design.md` in the design session's
 * worktree) — the second candidate loop, structurally mirroring the
 * stale-duplicate pilot (`stale-duplicate-pass.ts`, PR #803).
 *
 * `incomplete-handling` has THREE deterministic signals feeding the main
 * pass today, each covering a different omission shape (system-prompt.ts's
 * doc comment on `<incomplete-handling>` gating):
 *  - `variant-sweep-signals.ts` — an added enum member / union arm /
 *    const-object key whose consumer sites weren't updated.
 *  - `sibling-surface-signals.ts` — a same-directory or mirror-directory
 *    sibling file that didn't receive a matching change.
 *  - `unread-field-signals.ts` — an added interface/type-literal/class
 *    field with no read site anywhere in the indexed corpus.
 *
 * The design doc's gating-matrix row for this rule is explicit: build ONE
 * candidate loop unifying all three shapes under the SAME `ruleId`, not
 * three separate loops for one rule. This module does that: a single
 * `<incomplete_handling_candidates>` worklist interleaves candidates from
 * all three signals (each carrying its own `shape` tag and the evidence its
 * signal already computed), judged with one per-candidate-id-required
 * verdict contract — the same honesty mechanism the pilot's
 * `postProcessStaleDuplicateResult` established for the pr658 Finding-A
 * omission class (a long open worklist can under-report even inside a
 * dedicated, single-rule pass).
 *
 * ## Verdict vocabulary: four values, not the pilot's three
 *
 * The pilot's `stale | intentional-reuse | unverifiable` doesn't fit this
 * rule's three heterogeneous shapes as cleanly — a sibling-surface or
 * variant-sweep candidate can turn out to be handled via a code path the
 * signal's shallow textual match couldn't see (a helper function, a
 * differently-named consumer), which is a distinct disposition from "the
 * omission is deliberate" (an intentional catch-all default, a
 * structurally-incapable sibling). This module uses:
 *  - `incomplete` — the omission is real; converts to a finding.
 *  - `handled` — investigation shows it IS actually handled, just not in a
 *    way the textual signal could see (e.g. a dispatch table, a wrapper
 *    that reads the field indirectly).
 *  - `intentional` — the omission is a deliberate design choice (a
 *    catch-all default, a sibling that structurally cannot support the
 *    behavior, a documented gap).
 *  - `unverifiable` — investigation couldn't confirm either way (budget,
 *    or the evidence needed lives outside the indexed corpus).
 * Only `incomplete` becomes a finding; the other three are silent
 * dispositions the honesty contract still requires one of, per candidate.
 *
 * ## FP guard baked in from day one
 *
 * The stale-duplicate pilot's own eval found its loop wrongly flagging
 * decorative test-double/mock/fixture data (2/51) — a known-avoidable FP
 * class. This loop's prompt (`FP_GUARD` below) warns against it up front
 * rather than discovering it the same way a second time.
 *
 * ## Toolset: read_file + get_files_context + grep_codebase
 *
 * Unlike the pilot's stale-literal candidates (which carry an inline
 * snippet for every site), NONE of the three signals here attach a code
 * snippet to a consumer/sibling/declaration site — only `file:line` plus
 * metadata (which existing variants a consumer handles; which siblings
 * lack/share a pattern). Judging a candidate therefore requires actually
 * reading the referenced site, so `read_file` is load-bearing, not optional
 * — a harder requirement than the pilot's "sometimes can't disambiguate
 * from the snippet alone". `get_files_context` is added on top (not in the
 * pilot's toolset) because this rule's omission shapes are inherently
 * cross-file — "is the variant handled elsewhere?", "is the sibling
 * updated?" — and a file's imports/call sites/test associations are exactly
 * the structural view needed to judge whether an omission is handled via a
 * different mechanism (a dispatch table, a wrapper) that the signal's
 * token-level scan can't see. `grep_codebase` stays for the same reason the
 * pilot keeps it: a documented escape hatch when the signal's own textual
 * match (already a corpus-wide scan, more systematic than a one-off human
 * grep) still leaves a specific candidate ambiguous — e.g. a dynamic/
 * computed access the field-read patterns don't cover (see
 * `unread-field-signals.ts`'s own documented gap). `get_dependents` /
 * `list_functions` / `get_complexity` are still dropped: judging a handed
 * candidate is not a symbol-search or complexity-triage task.
 */

import type { ReviewContext } from '../../plugin-types.js';

import type { AgentConfig, AgentFinding, AgentResult, ResolvedRules } from './types.js';
import { INCOMPLETE_HANDLING } from './rules.js';
import { envDisabled } from './agent-client-shared.js';
import {
  computeVariantSweepContexts,
  type VariantSweepContext,
} from '../../variant-sweep-signals.js';
import { extractSiblingSurfaces, type SiblingSurfaceEntry } from '../../sibling-surface-signals.js';
import {
  computeUnreadFieldCandidates,
  type UnreadFieldCandidate,
} from '../../unread-field-signals.js';
import {
  renderPassPrHeader,
  EXTRA_PASS_MIN_BUDGET_TOKENS,
  VERDICT_EMISSION_RESERVE_TOKENS,
  affordableCandidateCeiling,
  capCandidatesToCeiling,
  deferredCandidateLabels,
  renderDeferralNote,
  type ReviewPassSpec,
} from './review-pass.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Turn cap for the candidate-loop pass. Higher than the pilot's 6: unlike
 * stale-literal's snippet-carrying candidates, every candidate here needs at
 * least one read_file/get_files_context round trip before it can be judged
 * (see module doc), so the loop needs headroom for that per-candidate cost.
 */
export const INCOMPLETE_PASS_MAX_TURNS = 8;

/**
 * This pass's OWN per-candidate cost — no longer shared with `review-pass.ts`'s generic
 * `OBSERVED_TOKENS_PER_TURN` (6,000), which the removed-exports-loop still uses. Derived from
 * PR #813/#814/#819/#820/#822's five STARVED production firings: `spentTokens ÷ candidateCount`
 * ranged 3,579-29,988/candidate (mean ≈11,586 — see the PR body's full arithmetic). The old
 * `PER_CANDIDATE_TOKENS` (900, a prompt-SIZING estimate — just the rendered candidate text) and
 * the borrowed `OBSERVED_TOKENS_PER_TURN` (6,000, one bare tool-dispatch turn) both undercounted
 * this pass's REAL per-candidate cost: judging one candidate here needs a read_file +
 * get_files_context round-trip (sometimes grep_codebase too — module doc), each turn re-sending
 * accumulated conversation context. 12,000 rounds the empirical mean up for margin. This is a
 * point-in-time estimate from 5 (truncated, hence lower-bound) production samples, not a proven
 * ceiling — revisit if production firings keep starving at this rate.
 */
const INCOMPLETE_HANDLING_TOKENS_PER_CANDIDATE = 12_000;

/**
 * Base overhead for this pass's budget scaler — deliberately set equal to
 * `VERDICT_EMISSION_RESERVE_TOKENS`, not an independent guess. Before this fix, the scaler's own
 * base (2,500) and the overflow ceiling's reserve (5,000, in `affordableCandidateCeiling`) were
 * two DIFFERENT numbers computed independently — so even a `budget()` "sized for n candidates"
 * would only ever come out `affordableCandidateCeiling` as n-1 or worse, deferring one MORE
 * candidate than the scaler itself claimed to fund (see PR #822's own dogfood: a 15-candidate,
 * 16,000-token budget still only afforded 1). Reusing the reserve as the base makes the scaler
 * the exact algebraic inverse of the ceiling: `budget(n) = RESERVE + RATE*n` <=>
 * `affordableCandidateCeiling(budget(n), RATE) === n` (whenever budget isn't clamped) — cap and
 * budget now agree by construction, per PR body's arithmetic.
 */
const BASE_OVERHEAD_TOKENS = VERDICT_EMISSION_RESERVE_TOKENS;
/**
 * Raised from 35,000 (see PR body): at the new 12,000/candidate rate, 35,000 only affords 2-3
 * candidates before real cost overruns it (still below every observed starved-run spend). 65,000
 * affords 5 fully-investigated candidates before rank-and-cap (#822) honestly defers the rest —
 * a deliberate cost/completeness trade-off, not an attempt to fund every production firing's full
 * worklist (some see 15; funding all 15 at this rate would cost ~185,000 tokens, disproportionate
 * to a second-order single-rule loop).
 */
const MAX_BUDGET = 65_000;

/** Mirrors variant-sweep-signals.ts's own MAX_ENTRIES cap — that module's compute()
 * function is itself uncapped (its cap is applied only by its own renderer, which
 * this unified pass does not use), so this pass re-applies the same cap locally. */
const VARIANT_SWEEP_CAP = 12;
/** Mirrors unread-field-signals.ts's own MAX_CANDIDATES cap, same reasoning. */
const UNREAD_FIELD_CAP = 10;
/** Combined worklist cap across all three shapes — bounds prompt size/budget even
 * though sibling-surface's own compute() already self-caps at 15 (MAX_TOTAL_ENTRIES). */
const MAX_TOTAL_CANDIDATES = 20;

/** Opt-IN env flag — this loop ships dark by default, same as the pilot. */
const INCOMPLETE_PASS_ENV = 'LIEN_INCOMPLETE_PASS';
/** Opt-OUT env flag for the future A/B's "loop only" arm. */
const INCOMPLETE_MAIN_ENV = 'LIEN_INCOMPLETE_MAIN';

export const INCOMPLETE_HANDLING_RULE_ID = 'incomplete-handling';

/** Plugin name this pass reports itself under in the delivery attestation. */
const INCOMPLETE_SKIP_PLUGIN = 'agent-review:incomplete-handling-loop';

/** Two findings on the same file within this many lines are the same location. */
const DEDUPE_LINE_PROXIMITY = 2;

const INCOMPLETE_INTRO =
  'This is an INCOMPLETE-HANDLING candidate loop — a dedicated second pass scoped ' +
  'to ONE rule, running only because deterministic scans already found at least ' +
  'one high-confidence candidate. Your ONLY job is to judge the ' +
  '<incomplete_handling_candidates> worklist below; do not report anything else ' +
  '(other bugs, style, doc drift — those are handled elsewhere). The worklist mixes ' +
  'THREE shapes, each labeled: `variant-sweep` (an added enum/union/const-object ' +
  "member whose consumer sites weren't updated), `sibling-surface` (a family/mirror " +
  'sibling file missing a matching change), and `unread-field` (an added field with ' +
  'no read site anywhere in the indexed codebase).';

const FP_GUARD =
  'FALSE-POSITIVE GUARD: some candidates may point at test-double, mock, or fixture ' +
  'data — inert scaffolding that mimics a production shape but is never exercised by ' +
  'real runtime code. Before verdicting a candidate `incomplete`, confirm the omission ' +
  'is in a REAL runtime consumer/sibling/field, not a test double or fixture standing ' +
  "in for one. If the candidate's own site (or the sibling/consumer you inspect) is " +
  'itself test/mock/fixture code, verdict `intentional` (a deliberate scaffolding gap) ' +
  'rather than `incomplete`.';

const INCOMPLETE_TOOLS_SECTION = `<tools>
You have these tools to investigate the codebase:
- read_file: Read file contents from the repo — REQUIRED for most candidates below, since none of the three signals attach a code snippet; you need the actual site's code to judge it.
- get_files_context: Get imports, exports, and call sites for a file — use to check whether an omission is handled via a different mechanism (a dispatch table, a wrapper) the signal's textual scan couldn't see.
- grep_codebase: Search the entire repository working tree for a text pattern (regex) — use ONLY to double-check a specific candidate the signal's own scan may have missed (e.g. dynamic/computed field access), not to re-discover candidates from scratch.
</tools>`;

// ---------------------------------------------------------------------------
// Loop eligibility gate
// ---------------------------------------------------------------------------

/**
 * Loop eligibility: at least one candidate from ANY of the three shapes.
 * Unlike the stale-duplicate pilot (whose unconditional `always: true`
 * trigger meant its raw signal block rendered on ~40/40 real PRs, forcing a
 * stricter same-file/high-confidence threshold), this rule's real-PR firing
 * rate is ALREADY selective: a 2026-07-16 census against this repo's last 40
 * merged PRs found sibling-surface firing on 9/40 (22.5%), variant-sweep and
 * unread-field firing on 0/40 each — so the union is still 9/40 (22.5%),
 * inside the same "genuinely selective" range the pilot's own threshold
 * targeted. No extra confidence tiering is needed on top of "any candidate
 * exists" (see the PR body's census re-run for the up-to-date numbers).
 */
function hasEligibleCandidate(candidates: IncompleteHandlingCandidate[]): boolean {
  return candidates.length > 0;
}

function envEnabled(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}

/** Whether the loop is opted in — config takes precedence, then the env flag. */
export function isIncompleteHandlingPassEnabled(config?: AgentConfig): boolean {
  if (config?.incompleteHandlingPass === true) return true;
  return envEnabled(process.env[INCOMPLETE_PASS_ENV]);
}

/**
 * Precisely why the incomplete-handling loop would not run right now, or
 * null if it should run. Mirrors `staleDuplicateSkipReason`'s pattern.
 */
export function incompleteHandlingSkipReason(
  context: ReviewContext,
  config?: AgentConfig,
): string | null {
  if (!isIncompleteHandlingPassEnabled(config)) {
    return (
      `disabled (opt-in; set config.incompleteHandlingPass or ${INCOMPLETE_PASS_ENV}=on ` +
      'to enable)'
    );
  }
  const candidates = computeIncompleteHandlingCandidates(context);
  if (!hasEligibleCandidate(candidates)) {
    return 'no variant-sweep, sibling-surface, or unread-field candidate found';
  }
  return null;
}

/** Whether to run the incomplete-handling loop. True iff `incompleteHandlingSkipReason` is null. */
export function shouldRunIncompleteHandlingPass(
  context: ReviewContext,
  config?: AgentConfig,
): boolean {
  return incompleteHandlingSkipReason(context, config) === null;
}

// ---------------------------------------------------------------------------
// Main-pass interaction override (second flag, mirrors the pilot)
// ---------------------------------------------------------------------------

/**
 * Whether the MAIN pass's incomplete-handling rule + its three signal blocks
 * should be suppressed — the future A/B's "loop only" arm. Default false: the
 * main pass keeps the rule and its signals regardless of whether the
 * dedicated loop is enabled, until the owner explicitly runs that arm.
 */
export function isIncompleteHandlingMainDisabled(): boolean {
  const value = process.env[INCOMPLETE_MAIN_ENV];
  return value?.trim().toLowerCase() === 'off' || envDisabled(value);
}

/**
 * Strip `incomplete-handling` out of the resolved rule set when the
 * main-pass override is on. Unlike stale-duplicate's `always: true` trigger
 * (which needed a NEW `isRuleActiveOrUnresolved` gate added to
 * system-prompt.ts, since its signal block rendered unconditionally before
 * any override existed), `incomplete-handling`'s three signal blocks are
 * ALREADY gated behind `isRuleActive(opts.rules, 'incomplete-handling')` in
 * system-prompt.ts today — so removing this rule from `rules.active` is
 * sufficient on its own to suppress `<variant_sweep_candidates>`,
 * `<sibling_surfaces>`, and `<unread_field_candidates>` together; no change
 * to system-prompt.ts's gating is needed for this override to work.
 */
export function applyIncompleteHandlingMainOverride(rules: ResolvedRules): ResolvedRules {
  if (!isIncompleteHandlingMainDisabled()) return rules;
  return {
    active: rules.active.filter(r => r.id !== INCOMPLETE_HANDLING_RULE_ID),
    skipped: [...rules.skipped, `${INCOMPLETE_HANDLING_RULE_ID} (${INCOMPLETE_MAIN_ENV}=off)`],
  };
}

// ---------------------------------------------------------------------------
// Unified candidate worklist
// ---------------------------------------------------------------------------

export type IncompleteHandlingShape = 'variant-sweep' | 'sibling-surface' | 'unread-field';

/** One candidate from any of the three signal families, carrying its own shape's evidence. */
export type IncompleteHandlingCandidate =
  | { shape: 'variant-sweep'; variant: VariantSweepContext }
  | { shape: 'sibling-surface'; sibling: SiblingSurfaceEntry }
  | { shape: 'unread-field'; unreadField: UnreadFieldCandidate };

/**
 * Build the unified worklist: variant-sweep candidates first (rarest,
 * most specific), then sibling-surface (this repo's dominant real-world
 * producer, per the census), then unread-field — a fixed, deterministic
 * order so candidate ids are stable across runs on the same PR. Each shape
 * is capped locally (variant/unread — sibling-surface's own `compute()`
 * already self-caps), then the combined list is capped at
 * `MAX_TOTAL_CANDIDATES` with no further per-shape priority beyond this
 * fixed ordering. Exposed for testing.
 */
export function computeIncompleteHandlingCandidates(
  context: ReviewContext,
): IncompleteHandlingCandidate[] {
  const variants = computeVariantSweepContexts(context)
    .slice(0, VARIANT_SWEEP_CAP)
    .map((variant): IncompleteHandlingCandidate => ({ shape: 'variant-sweep', variant }));
  const siblings = extractSiblingSurfaces(context).map(
    (sibling): IncompleteHandlingCandidate => ({ shape: 'sibling-surface', sibling }),
  );
  const unread = computeUnreadFieldCandidates(context)
    .slice(0, UNREAD_FIELD_CAP)
    .map((unreadField): IncompleteHandlingCandidate => ({ shape: 'unread-field', unreadField }));

  return [...variants, ...siblings, ...unread].slice(0, MAX_TOTAL_CANDIDATES);
}

function candidateIds(candidates: IncompleteHandlingCandidate[]): string[] {
  return candidates.map((_, i) => `candidate-${i + 1}`);
}

// ---------------------------------------------------------------------------
// Candidate-overflow handling (rank-and-cap with attested deferral)
// ---------------------------------------------------------------------------

/** Best-effort short label for a candidate, shape-specific — for the delivery attestation's
 *  `deferredCandidateIds`, not the pass's own `candidate-N` worklist ids. */
function incompleteHandlingLabel(c: IncompleteHandlingCandidate): string {
  if (c.shape === 'variant-sweep') return `${c.variant.typeName}.${c.variant.variant}`;
  if (c.shape === 'sibling-surface') return c.sibling.display;
  return `${c.unreadField.typeName}.${c.unreadField.field}`;
}

/** This run's actual worklist after rank-and-cap. Unlike the pilot's stale-literal candidates,
 *  NONE of this rule's three shapes attach an inline code snippet (module doc: "you need the
 *  actual site's code to judge it") — read_file/get_files_context is load-bearing for most
 *  candidates, so the realistic per-candidate cost is this pass's OWN
 *  `INCOMPLETE_HANDLING_TOKENS_PER_CANDIDATE` (empirically derived — see that constant's doc
 *  comment), the SAME rate `incompleteHandlingPassBudget` scales the allocation by, so the
 *  ceiling and the budget agree. `budget` defaults to unlimited so every existing call site that
 *  doesn't pass one is byte-identical to before this feature existed. Exposed for testing. */
export function computeIncompleteHandlingWorklist(
  context: ReviewContext,
  budget = Number.POSITIVE_INFINITY,
): { candidates: IncompleteHandlingCandidate[]; deferredCount: number; deferredIds: string[] } {
  const all = computeIncompleteHandlingCandidates(context);
  const ceiling = affordableCandidateCeiling(budget, INCOMPLETE_HANDLING_TOKENS_PER_CANDIDATE);
  const { kept, deferred } = capCandidatesToCeiling(all, ceiling);
  return {
    candidates: kept,
    deferredCount: deferred.length,
    deferredIds: deferredCandidateLabels(deferred, incompleteHandlingLabel),
  };
}

// ---------------------------------------------------------------------------
// Prompt construction — per-shape candidate rendering
// ---------------------------------------------------------------------------

function renderHandled(names: string[]): string {
  const MAX_LISTED = 6;
  const shown = names.slice(0, MAX_LISTED);
  const omitted = names.length - shown.length;
  return omitted > 0 ? `${shown.join(', ')}, +${omitted} more` : shown.join(', ');
}

function renderVariantCandidate(id: string, v: VariantSweepContext): string {
  const lines: string[] = [`<candidate id="${id}" shape="variant-sweep">`];
  lines.push(`Added variant: ${v.typeName}.${v.variant} (added in ${v.file})`);
  lines.push('Stale consumer site(s) not updated:');
  for (const c of v.consumers) {
    lines.push(`  - ${c.file}:${c.line} (handles: ${renderHandled(c.handledVariants)})`);
  }
  lines.push('</candidate>');
  return lines.join('\n');
}

function renderSiblingCandidate(id: string, s: SiblingSurfaceEntry): string {
  const siblingWord = s.isMirror ? 'mirror sibling' : 'sibling';
  const siblingsList = s.siblings.join(', ');
  const detail =
    s.direction === 'unmirrored-addition'
      ? `${s.display}${s.line ? ` (line ${s.line})` : ''} — added in ${s.file}, absent from ` +
        `untouched ${siblingWord}(s): ${siblingsList}`
      : `${s.display}(...) — shared by ${siblingWord}(s) ${siblingsList}, absent from ${s.file}`;
  return `<candidate id="${id}" shape="sibling-surface" direction="${s.direction}">\n${detail}\n</candidate>`;
}

function renderUnreadFieldCandidate(id: string, u: UnreadFieldCandidate): string {
  return (
    `<candidate id="${id}" shape="unread-field">\n` +
    `${u.typeName}.${u.field} (${u.kind}, added in ${u.file}:${u.line}) — no read site found ` +
    'anywhere in the indexed codebase\n</candidate>'
  );
}

function renderCandidate(id: string, c: IncompleteHandlingCandidate): string {
  if (c.shape === 'variant-sweep') return renderVariantCandidate(id, c.variant);
  if (c.shape === 'sibling-surface') return renderSiblingCandidate(id, c.sibling);
  return renderUnreadFieldCandidate(id, c.unreadField);
}

/**
 * Build the worklist — one entry per candidate id, interleaving all three
 * shapes in the order `computeIncompleteHandlingCandidates` produces them.
 */
function renderWorklist(candidates: IncompleteHandlingCandidate[]): string {
  const ids = candidateIds(candidates);
  const lines: string[] = ['<incomplete_handling_candidates>'];
  lines.push(
    'One verdict is REQUIRED per candidate id below (see <output_format>) — ' +
      `${ids.join(', ')}. Judge each candidate against its own shape's evidence; use ` +
      'read_file/get_files_context to inspect the referenced site(s) before deciding.',
  );
  candidates.forEach((c, i) => {
    lines.push('');
    lines.push(renderCandidate(ids[i], c));
  });
  lines.push('</incomplete_handling_candidates>');
  return lines.join('\n');
}

/** The per-candidate-verdict output contract — four verdicts (see module doc). */
function buildOutputFormat(ids: string[]): string {
  return `<output_format>
Output EXACTLY one entry per candidate id in the \`findings\` array — one for EVERY
id in ${ids.join(', ')}, no more, no fewer — in a \`\`\`json code fence:

{
  "findings": [
    {
      "candidateId": "candidate-1",
      "verdict": "incomplete | handled | intentional | unverifiable",
      "filepath": "relative/path.ts",
      "line": 42,
      "severity": "error | warning",
      "category": "logic_error",
      "message": "REQUIRED for every verdict. When incomplete: 1-2 sentences naming the omission and its consequence. When handled/intentional/unverifiable: 1 sentence saying why.",
      "suggestion": "The fix (incomplete only) — what to add so the omission is closed.",
      "evidence": "One line citing the candidate and what you inspected to confirm it."
    }
  ],
  "summary": {
    "riskLevel": "low | medium | high | critical",
    "overview": "One sentence.",
    "keyChanges": []
  }
}

EVERY entry requires candidateId, verdict, filepath, line, severity, category, and message —
even for handled/intentional/unverifiable verdicts (fill filepath/line from the
candidate's own site, severity "warning", category any short slug e.g. "logic_error", message
explaining the disposition). A missing category silently drops the ENTIRE entry, same as a
missing candidateId — both make this pass's result incomplete.
</output_format>`;
}

function buildSystemPrompt(ids: string[]): string {
  return `${INCOMPLETE_INTRO}

${FP_GUARD}

${INCOMPLETE_TOOLS_SECTION}

<strategy>
${INCOMPLETE_HANDLING.prompt}
</strategy>

<examples>
${INCOMPLETE_HANDLING.example}
</examples>

${buildOutputFormat(ids)}`;
}

/** Build the candidate-loop's initial message: PR header + worklist + a closing nudge. `budget`
 *  drives rank-and-cap overflow handling (see `computeIncompleteHandlingWorklist`) — defaults to
 *  unlimited so existing callers that don't pass one are unaffected. */
export function buildIncompleteHandlingPassInitialMessage(
  context: ReviewContext,
  budget = Number.POSITIVE_INFINITY,
): string {
  const { candidates, deferredCount } = computeIncompleteHandlingWorklist(context, budget);
  const sections: string[] = [];
  const header = renderPassPrHeader(context);
  if (header) sections.push(header);
  sections.push(renderWorklist(candidates));
  const deferralNote = renderDeferralNote(deferredCount);
  if (deferralNote) sections.push(deferralNote);
  sections.push('Judge every candidate above and output your verdicts as JSON.');
  return sections.join('\n\n');
}

/** The system + initial prompts for the incomplete-handling candidate loop. `budget` is this
 *  pass's own final allocated budget (see `ReviewPassSpec.buildPrompts`'s doc comment) — defaults
 *  to unlimited so existing callers unaware of overflow handling are byte-identical to before. */
export function buildIncompleteHandlingPassPrompts(
  context: ReviewContext,
  budget = Number.POSITIVE_INFINITY,
): {
  systemPrompt: string;
  initialMessage: string;
} {
  const { candidates } = computeIncompleteHandlingWorklist(context, budget);
  const ids = candidateIds(candidates);
  return {
    systemPrompt: buildSystemPrompt(ids),
    initialMessage: buildIncompleteHandlingPassInitialMessage(context, budget),
  };
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

/**
 * Budget scaled by this pass's own combined candidate count (per the
 * per-rule-loops design doc §2), clamped floor/ceiling — mirrors the
 * pilot's `staleDuplicatePassBudget`, but with this pass's OWN empirically-derived rate (see
 * `INCOMPLETE_HANDLING_TOKENS_PER_CANDIDATE`'s doc comment) instead of a flat
 * prompt-sizing constant. The floor is `EXTRA_PASS_MIN_BUDGET_TOKENS` (shared across all three
 * extra passes — see that constant's doc comment / PR #811); in practice it no longer binds here
 * (even a single candidate scales to 17,000, above the 11,000 floor) but stays as a defensive
 * lower bound. `MAX_BUDGET` (65,000) caps full funding at 5 candidates (see that constant's doc
 * comment) — a real-PR firing with more than that gets the rest honestly deferred via
 * `computeIncompleteHandlingWorklist`'s rank-and-cap, not silently starved.
 */
export function incompleteHandlingPassBudget(_baseBudget: number, context: ReviewContext): number {
  const candidateCount = computeIncompleteHandlingCandidates(context).length;
  const scaled =
    BASE_OVERHEAD_TOKENS +
    INCOMPLETE_HANDLING_TOKENS_PER_CANDIDATE * Math.min(candidateCount, MAX_TOTAL_CANDIDATES);
  return Math.min(Math.max(scaled, EXTRA_PASS_MIN_BUDGET_TOKENS), MAX_BUDGET);
}

// ---------------------------------------------------------------------------
// Post-processing (verdict reduction + honest completeness)
// ---------------------------------------------------------------------------

/** A verdict value the loop's output contract recognizes. */
type Verdict = 'incomplete' | 'handled' | 'intentional' | 'unverifiable';
const VALID_VERDICTS: ReadonlySet<string> = new Set<Verdict>([
  'incomplete',
  'handled',
  'intentional',
  'unverifiable',
]);

/** The raw per-candidate shape the model emits inside the standard `findings` array. */
interface RawVerdictFinding extends AgentFinding {
  candidateId?: string;
  verdict?: Verdict;
}

/** Strip the loop-only `candidateId`/`verdict` fields, keeping the standard finding shape. */
function toCleanFinding(f: RawVerdictFinding): AgentFinding {
  return {
    filepath: f.filepath,
    line: f.line,
    endLine: f.endLine,
    symbolName: f.symbolName,
    severity: f.severity,
    category: f.category,
    message: f.message,
    suggestion: f.suggestion,
    evidence: f.evidence,
  };
}

/**
 * True iff every expected candidate id appears in `raw` EXACTLY once, each
 * with a RECOGNIZED verdict — and `raw` contains no entry with a missing/
 * unknown candidateId or an unrecognized verdict. Same contract as the
 * pilot's `hasCompleteVerdictCoverage` (see that module's doc for why
 * candidateId-presence alone isn't enough): "one recognized verdict per
 * expected id", not merely "every id mentioned somewhere".
 */
function hasCompleteVerdictCoverage(ids: string[], raw: RawVerdictFinding[]): boolean {
  const expected = new Set(ids);
  const verdictCounts = new Map<string, number>();
  for (const { candidateId, verdict } of raw) {
    if (
      typeof candidateId !== 'string' ||
      !expected.has(candidateId) ||
      typeof verdict !== 'string' ||
      !VALID_VERDICTS.has(verdict)
    ) {
      return false;
    }
    verdictCounts.set(candidateId, (verdictCounts.get(candidateId) ?? 0) + 1);
  }
  return ids.every(id => verdictCounts.get(id) === 1);
}

/**
 * Reduce this pass's raw per-candidate verdict array down to real findings
 * (`verdict === 'incomplete'` AND `candidateId` names a real worklist entry
 * only, cleaned of the loop-only fields), and mark the result honestly
 * incomplete when the verdict array doesn't cleanly cover the worklist —
 * same honesty contract as the pilot's `postProcessStaleDuplicateResult`.
 * The candidateId check is required, not just the verdict value: a
 * hallucinated/out-of-worklist id (`hasCompleteVerdictCoverage` already
 * flags the RESULT incomplete for it) must not ALSO leak through as a real
 * finding just because it happens to carry `verdict: 'incomplete'` — a
 * phantom candidate is not a genuine one, regardless of the honesty flag
 * (CodeRabbit finding on this PR). When the underlying client result was
 * ALREADY incomplete for a real reason (budget/max_turns/error), that
 * reason is kept as-is; `incomplete_verdict` is only used when the model
 * otherwise returned a syntactically complete verdict.
 *
 * Coverage is checked against the RANK-AND-CAPPED worklist (from
 * `computeIncompleteHandlingWorklist(context, budget)`), not the full pre-cap
 * candidate set — a deferred candidate was never listed, so it is correctly
 * exempt from the honesty contract (candidate-overflow handling's point 3:
 * deferral is not incompleteness). `budget` must be the SAME value
 * `buildIncompleteHandlingPassPrompts` used — `review-pass.ts`'s
 * `runReviewPass` guarantees this by threading one computed budget through
 * both calls.
 */
export function postProcessIncompleteHandlingResult(
  result: AgentResult,
  context: ReviewContext,
  budget = Number.POSITIVE_INFINITY,
): AgentResult {
  const { candidates, deferredCount, deferredIds } = computeIncompleteHandlingWorklist(
    context,
    budget,
  );
  const ids = candidateIds(candidates);
  const expected = new Set(ids);
  const raw = result.findings as RawVerdictFinding[];
  const coverageIncomplete = !hasCompleteVerdictCoverage(ids, raw);
  const wasAlreadyIncomplete = result.incomplete;

  return {
    ...result,
    findings: raw
      .filter(
        f =>
          f.verdict === 'incomplete' &&
          typeof f.candidateId === 'string' &&
          expected.has(f.candidateId),
      )
      .map(toCleanFinding),
    incomplete: wasAlreadyIncomplete || coverageIncomplete,
    stopReason:
      !wasAlreadyIncomplete && coverageIncomplete ? 'incomplete_verdict' : result.stopReason,
    candidatesDeferred: deferredCount,
    deferredCandidateIds: deferredCount > 0 ? deferredIds : undefined,
  };
}

// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

function sameLocation(a: AgentFinding, b: AgentFinding): boolean {
  return a.filepath === b.filepath && Math.abs(a.line - b.line) <= DEDUPE_LINE_PROXIMITY;
}

/**
 * Fold the loop's findings (already reduced to `verdict === 'incomplete'`
 * only) into the main pass's. The LOOP finding wins on a same-location
 * collision — same "loop wins" direction as the pilot, and scoped the same
 * way: dropping is scoped to main-pass findings whose OWN `ruleId` is also
 * `incomplete-handling`, never an unrelated rule's finding that merely lands
 * within `DEDUPE_LINE_PROXIMITY` lines. Returns a new array; inputs are not
 * mutated.
 */
export function mergeIncompleteHandlingFindings(
  mainFindings: AgentFinding[],
  loopFindings: AgentFinding[],
): AgentFinding[] {
  const forced = loopFindings.map(f => ({ ...f, ruleId: INCOMPLETE_HANDLING_RULE_ID }));
  const survivingMain = mainFindings.filter(
    mf => mf.ruleId !== INCOMPLETE_HANDLING_RULE_ID || !forced.some(lf => sameLocation(mf, lf)),
  );
  return [...survivingMain, ...forced];
}

/**
 * Fold the loop's result-level state into the main pass's — only
 * incomplete/stopReason propagate, naming this pass via the generic
 * `incompleteFromPass` (see types.ts), same as the pilot.
 */
export function mergeIncompleteHandlingResultState(
  main: AgentResult,
  passResult: AgentResult | null,
): AgentResult {
  if (!passResult) return main;
  if (passResult.incomplete && !main.incomplete) {
    main.incomplete = true;
    main.stopReason = passResult.stopReason;
    main.incompleteFromPass = 'incomplete-handling';
  }
  return main;
}

// ---------------------------------------------------------------------------
// ReviewPassSpec (plugs the loop into the generalized executor)
// ---------------------------------------------------------------------------

/**
 * Incomplete-handling candidate loop bundled as a `ReviewPassSpec` (see
 * `review-pass.ts`). Every field here is one of this module's own pure
 * functions; the generic executor supplies the gate-check/run/
 * failure-isolation/reporting plumbing.
 */
export const INCOMPLETE_HANDLING_PASS_SPEC: ReviewPassSpec = {
  name: 'incomplete-handling-loop',
  skipPlugin: INCOMPLETE_SKIP_PLUGIN,
  gateReason: incompleteHandlingSkipReason,
  buildPrompts: buildIncompleteHandlingPassPrompts,
  budget: incompleteHandlingPassBudget,
  maxTurns: INCOMPLETE_PASS_MAX_TURNS,
  mergeFindings: mergeIncompleteHandlingFindings,
  mergeResultState: mergeIncompleteHandlingResultState,
  postProcessResult: postProcessIncompleteHandlingResult,
};
