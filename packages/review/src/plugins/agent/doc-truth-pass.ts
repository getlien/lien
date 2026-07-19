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
 *
 * ## v2 — per-claim verdict contract (flag-gated, default OFF)
 *
 * pr658's Finding A (the `schema.ts` `embeddings.enabled` doc comment) is the
 * motivating case: doc-truth's open findings list lets a real contradiction
 * lose the competition for a scarce findings slot even inside this ALREADY
 * dedicated, single-rule pass (measured ~1/3 engagement — see that fixture's
 * "OWNER RE-SCOPE DECISION" header). `stale-duplicate-pass.ts`'s candidate
 * loop proved the fix for a narrower shape: require one verdict per worklist
 * id instead of an open list an entry can silently be omitted from.
 *
 * Set `LIEN_DOC_TRUTH_V2=on` (see `isDocTruthV2Enabled`) to require exactly
 * that here: every `<doc_claims>` entry and every `<rename_sweep>` item gets
 * a stable `claim-N` id (`buildClaimWorklist`), and the model MUST emit one
 * verdict (`accurate` | `contradicted` | `unverifiable`) per id, carried
 * inside the standard `findings` array tagged with `claimId`/`verdict` — the
 * same "verdict inside the ordinary findings key" shape stale-duplicate uses,
 * so the shared client's parse/validate pipeline needs no changes. Unlike
 * that candidate loop, this pass's contract stays OPEN beyond the worklist:
 * an extra finding for a claim the model spotted itself (no `claimId`) is
 * still legal and passes straight through — the rule text's existing "also
 * skim the touched hunks for any [claim] not listed" allowance is unchanged.
 * `postProcessDocTruthResult` reduces ONLY `contradicted` verdicts to real
 * findings — `accurate` AND `unverifiable` are both dropped (mirroring v1's
 * "stay silent unless you have proof" instruction, and matching every
 * sibling candidate-loop pass: `stale-duplicate-pass.ts` keeps only `stale`,
 * `removed-exports-pass.ts` keeps only `breaking`, `incomplete-handling-
 * pass.ts` keeps only `incomplete` — none of them promote their own
 * "couldn't verify" verdict either). A thin-evidence claim honestly verdicted
 * `unverifiable` is real signal (see `hasCompleteVerdictCoverage` below) but
 * is not a reader-facing finding: "I couldn't check" is not the same
 * deliverable as "the code contradicts this," and treating them the same
 * turned a precision-guard fixture with thin evidence into a false positive
 * (accurate-doc, 3/3 — see this change's PR body). The result marks
 * `incomplete_verdict` when any listed id's verdict is missing, invalid,
 * duplicated, or unrecognized (CodeRabbit-hardened honesty rigor — see
 * `stale-duplicate-pass.ts`'s `hasCompleteVerdictCoverage` doc comment) —
 * that check reads the RAW per-claim verdict list, so an `unverifiable`
 * verdict still counts as honest coverage even though it never becomes a
 * finding.
 *
 * When the flag is off, every v2 function is unreachable and
 * `buildDocTruthPassPrompts`/`postProcessDocTruthResult` return exactly what
 * they always did — this is an ADDITIVE contract, not a rewrite (see the
 * byte-diff proof in this change's PR body).
 */

import type { ReviewContext } from '../../plugin-types.js';
import { renderGuidanceSurfaceSection } from '../../guidance-surface-signals.js';
import {
  extractDocClaims,
  attachEvidence,
  renderDocClaimsSection,
  type DocClaim,
} from '../../doc-claims-signals.js';
import {
  computeRenameSweepSignals,
  renderRenameSweepSection,
  type RenameSweepSignal,
} from '../../rename-sweep-signals.js';

import type { AgentConfig, AgentFinding, AgentResult, ResolvedRules } from './types.js';
import { DOC_TRUTH } from './rules.js';
import { buildSystemPrompt } from './system-prompt.js';
import { envDisabled } from './agent-client-shared.js';
import {
  renderPassPrHeader,
  EXTRA_PASS_MIN_BUDGET_TOKENS,
  affordableCandidateCeiling,
  MAX_DEFERRED_LABELS,
  renderDeferralNote,
  type ReviewPassSpec,
} from './review-pass.js';

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
 * doc-claim signals rather than the full diff + all signals — PROVIDED the
 * base itself is normal-mode-sized (`scaleAgentBudget`'s ≥60K floor, where
 * 40% is ≥24K). This fraction was never re-validated against summary-only
 * mode's deliberately tiny 6,000-20,000 base (added by #572): 40% of a
 * 6,054 base is 2,422 tokens — smaller than a single Kimi reasoning+tool
 * turn (PR #811 measured 5,526-6,564/turn), so the pass hard-stopped before
 * its first tool call ever dispatched. `docTruthPassBudget` now clamps this
 * fraction to `EXTRA_PASS_MIN_BUDGET_TOKENS` so a tiny base can no longer
 * starve it below one real round-trip.
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
  pushIfPresent(sections, renderPassPrHeader(context));
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
 *
 * When `isDocTruthV2Enabled()` is true, the per-claim verdict contract (see
 * this module's doc comment) is layered on top: the system prompt gets an
 * appended override section requiring one verdict per worklist id, and the
 * initial message's `<doc_claims>`/`<rename_sweep>` blocks are rebuilt with
 * ids attached (`buildDocTruthPassInitialMessageV2`). With the flag off this
 * function's return value is UNCHANGED from before v2 existed — same two
 * function calls, nothing appended.
 *
 * `budget` is this pass's own final allocated budget (see
 * `ReviewPassSpec.buildPrompts`'s doc comment) — under v2, it drives
 * rank-and-cap candidate-overflow handling (`capClaimWorklistToCeiling`):
 * the Finding-A calibrate's ~51-claim worklist is the motivating case this
 * closes. Defaults to unlimited so every existing call site that doesn't
 * pass one (tests, and the v1 path, which has no id-based worklist to cap)
 * is byte-identical to before this feature existed.
 */
export function buildDocTruthPassPrompts(
  context: ReviewContext,
  budget = Number.POSITIVE_INFINITY,
): {
  systemPrompt: string;
  initialMessage: string;
} {
  const systemPrompt = buildSystemPrompt(DOC_TRUTH_ONLY_RULES);
  if (!isDocTruthV2Enabled()) {
    return { systemPrompt, initialMessage: buildDocTruthPassInitialMessage(context) };
  }
  const full = buildClaimWorklist(context);
  const ceiling = affordableCandidateCeiling(budget, DOC_TRUTH_TOKENS_PER_CLAIM);
  const { worklist, deferredCount } = capClaimWorklistToCeiling(full, ceiling);
  return {
    systemPrompt: `${systemPrompt}\n\n${buildV2OutputContractOverride(allClaimIds(worklist))}`,
    initialMessage: buildDocTruthPassInitialMessageV2(context, worklist, deferredCount),
  };
}

// ---------------------------------------------------------------------------
// v2 — per-claim verdict contract (flag-gated; see module doc comment)
// ---------------------------------------------------------------------------

/** Env opt-in for the v2 per-claim-verdict contract. Default OFF (unset/anything else). */
const DOC_TRUTH_V2_ENV = 'LIEN_DOC_TRUTH_V2';

function envEnabled(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}

/** Whether the v2 per-claim-verdict contract is active. Env-only opt-in (no config field — a
 *  pilot flag, mirroring stale-duplicate-pass.ts's env-first pattern before it grew a config field). */
export function isDocTruthV2Enabled(): boolean {
  return envEnabled(process.env[DOC_TRUTH_V2_ENV]);
}

/** Cap on doc claims assigned an id — mirrors doc-claims-signals.ts's own MAX_CLAIMS render cap. */
const DOC_TRUTH_V2_MAX_CLAIMS = 20;

/** One rename-sweep mapping's prose-touched/survivor items, each paired with its assigned id
 *  (same order as `RenameSweepSignal.proseTouched`/`.survivors` — see `buildClaimWorklist`). */
interface RenameSignalWithIds {
  signal: RenameSweepSignal;
  proseIds: string[];
  survivorIds: string[];
}

/** The full id-tagged claim worklist for one PR: every doc claim and rename-sweep item that
 *  gets a stable `claim-N` id under the v2 contract. Ids are assigned in a single sequential
 *  namespace (doc claims first, then rename-sweep items signal by signal, prose before
 *  survivors) so `allClaimIds` and the render functions agree on the same order deterministically. */
interface ClaimWorklist {
  docClaims: DocClaim[];
  /** Parallel to `docClaims` — `docClaimIds[i]` is `docClaims[i]`'s id. */
  docClaimIds: string[];
  renameSignals: RenameSignalWithIds[];
  /** Doc claims beyond DOC_TRUTH_V2_MAX_CLAIMS that got no id (0 when none). */
  overflowClaims: number;
}

/** Build the id-tagged worklist from the review context. Pure and deterministic — the same
 *  compute functions the v1 render path uses (`extractDocClaims`/`attachEvidence`/
 *  `computeRenameSweepSignals`), just with ids assigned alongside. Exposed for testing. */
export function buildClaimWorklist(context: ReviewContext): ClaimWorklist {
  const patches = context.pr?.patches;
  const allClaims = patches ? attachEvidence(extractDocClaims(patches), context) : [];
  const docClaims = allClaims.slice(0, DOC_TRUTH_V2_MAX_CLAIMS);

  let n = 0;
  const docClaimIds = docClaims.map(() => `claim-${++n}`);

  const renameSignals: RenameSignalWithIds[] = computeRenameSweepSignals(context).map(signal => ({
    signal,
    proseIds: signal.proseTouched.map(() => `claim-${++n}`),
    survivorIds: signal.survivors.map(() => `claim-${++n}`),
  }));

  return {
    docClaims,
    docClaimIds,
    renameSignals,
    overflowClaims: Math.max(0, allClaims.length - DOC_TRUTH_V2_MAX_CLAIMS),
  };
}

/** Every id in a worklist, in worklist order — the expected-id set `postProcessDocTruthResult`
 *  checks verdict coverage against, and what the prompt's contract text enumerates. */
export function allClaimIds(worklist: ClaimWorklist): string[] {
  return [
    ...worklist.docClaimIds,
    ...worklist.renameSignals.flatMap(s => [...s.proseIds, ...s.survivorIds]),
  ];
}

// ---------------------------------------------------------------------------
// Candidate-overflow handling (rank-and-cap with attested deferral)
// ---------------------------------------------------------------------------

/**
 * Realistic per-claim cost for the ceiling formula (see
 * `affordableCandidateCeiling`). A claim entry carries a pre-fetched evidence
 * excerpt (or a short "no evidence located" note), so judging it is a
 * COMPARISON, not an investigation — the rule's own budget-discipline
 * instruction explicitly forbids re-reading via tools when evidence is
 * attached (`DOC_PASS_INTRO`: "do NOT re-read that file with tools; spend
 * tool calls ONLY on claims with no attached evidence"). Same order of
 * magnitude as stale-duplicate's own evidence-inline PER_CANDIDATE_TOKENS
 * (800) — a little lighter, since a doc claim's excerpt is typically shorter
 * than stale-duplicate's full diff hunk plus multiple surviving-site
 * snippets.
 */
export const DOC_TRUTH_TOKENS_PER_CLAIM = 500;

/** A short, human-readable label for one dropped worklist item — for the delivery attestation's
 *  `deferredCandidateIds`, not the pass's own `claim-N` ids. */
function truncateForLabel(text: string): string {
  const MAX_LABEL_CHARS = 80;
  const trimmed = text.trim();
  return trimmed.length > MAX_LABEL_CHARS ? `${trimmed.slice(0, MAX_LABEL_CHARS - 1)}…` : trimmed;
}

/** The result of rank-and-capping a `ClaimWorklist` to an affordable ceiling. */
export interface ClaimWorklistOverflow {
  /** The capped worklist — safe to render with the EXISTING v2 render functions unchanged. */
  worklist: ClaimWorklist;
  /** How many listed ids were excluded by the cap (0 when the full worklist fit). */
  deferredCount: number;
  /** Best-effort human-readable labels for the deferred items (capped short list). */
  deferredIds: string[];
}

/** A running "how many more ids can we afford" counter plus the deferred-label collector both
 *  `capDocClaims`/`capRenameSignal` share — extracted so `capClaimWorklistToCeiling` itself stays
 *  a short orchestrator (lien delta: Halstead effort budget). */
interface CapBudget {
  remaining: number;
  pushDeferred: (label: string) => void;
}

/** Cap `full.docClaims`/`docClaimIds` to what `budget.remaining` affords, decrementing it and
 *  recording every dropped claim's text as a deferred label. */
function capDocClaims(
  full: ClaimWorklist,
  budget: CapBudget,
): Pick<ClaimWorklist, 'docClaims' | 'docClaimIds'> {
  const keepCount = Math.min(full.docClaims.length, budget.remaining);
  budget.remaining -= keepCount;
  full.docClaims.slice(keepCount).forEach(c => budget.pushDeferred(c.claimText));
  return {
    docClaims: full.docClaims.slice(0, keepCount),
    docClaimIds: full.docClaimIds.slice(0, keepCount),
  };
}

/** Cap one rename-sweep signal's prose/survivor items to what `budget.remaining` affords
 *  (prose before survivors, matching `allClaimIds`' own order), decrementing it and recording
 *  every dropped item's text as a deferred label. Returns null when nothing of this signal
 *  fits — the whole mapping is deferred, nothing to render. */
function capRenameSignal(s: RenameSignalWithIds, budget: CapBudget): RenameSignalWithIds | null {
  const proseKeep = Math.min(s.proseIds.length, budget.remaining);
  budget.remaining -= proseKeep;
  const survivorKeep = Math.min(s.survivorIds.length, budget.remaining);
  budget.remaining -= survivorKeep;

  s.signal.proseTouched.slice(proseKeep).forEach(p => budget.pushDeferred(p.sentence));
  s.signal.survivors.slice(survivorKeep).forEach(v => budget.pushDeferred(v.snippet));

  if (proseKeep === 0 && survivorKeep === 0) return null;
  return {
    signal: {
      ...s.signal,
      proseTouched: s.signal.proseTouched.slice(0, proseKeep),
      survivors: s.signal.survivors.slice(0, survivorKeep),
    },
    proseIds: s.proseIds.slice(0, proseKeep),
    survivorIds: s.survivorIds.slice(0, survivorKeep),
  };
}

/**
 * Trim a `ClaimWorklist` down to at most `ceiling` total ids, preserving the
 * EXISTING order `allClaimIds` already walks (doc claims first in their own
 * extraction order, then each rename mapping's prose-touched lines then
 * survivors, mappings in `computeRenameSweepSignals`'s own most-repeated-first
 * order) — nothing is re-ranked, only truncated, per candidate-overflow
 * handling's "reuse each signal's own order; don't invent new scoring".
 *
 * Scoped to the ceiling this run's BUDGET affords — the pre-existing local
 * caps each signal already applies (`DOC_TRUTH_V2_MAX_CLAIMS`, rename-sweep's
 * own `MAX_PROSE_LINES`/`MAX_SURVIVORS`/`MAX_MAPPINGS`) are untouched and are
 * a separate, already-silent truncation this function does not attempt to
 * fix — see the PR body for that scoping call. Returns the ORIGINAL worklist
 * object unchanged when `ceiling` already covers every id (the common case),
 * so a well-resourced run is byte-identical to before this feature existed.
 */
export function capClaimWorklistToCeiling(
  full: ClaimWorklist,
  ceiling: number,
): ClaimWorklistOverflow {
  const totalIds = allClaimIds(full).length;
  if (totalIds <= ceiling) {
    return { worklist: full, deferredCount: 0, deferredIds: [] };
  }

  const deferredIds: string[] = [];
  const budget: CapBudget = {
    remaining: Math.max(0, ceiling),
    pushDeferred: label => {
      if (deferredIds.length < MAX_DEFERRED_LABELS) deferredIds.push(truncateForLabel(label));
    },
  };

  const cappedDocClaims = capDocClaims(full, budget);
  const keptSignals = full.renameSignals
    .map(s => capRenameSignal(s, budget))
    .filter((s): s is RenameSignalWithIds => s !== null);

  return {
    worklist: {
      ...cappedDocClaims,
      renameSignals: keptSignals,
      overflowClaims:
        full.overflowClaims + (full.docClaims.length - cappedDocClaims.docClaims.length),
    },
    deferredCount: totalIds - ceiling,
    deferredIds,
  };
}

/** Render one doc-claim entry with its id — same shape as doc-claims-signals.ts's
 *  `renderClaimEntry`, minus that function's per-entry budget truncation (this worklist is
 *  already capped at DOC_TRUTH_V2_MAX_CLAIMS entries, so the overflow note carries the same
 *  role a byte-budget cutoff would). */
function renderDocClaimEntryWithId(id: string, claim: DocClaim): string {
  const header = `- [${id}] ${claim.file}: "${claim.claimText}"`;
  if (!claim.evidence) {
    return `${header}\n  (evidence: none located — find the described code yourself via get_files_context on the named symbols/files)`;
  }
  if (claim.evidence.citedPathMissing) {
    return (
      `${header}\n  (evidence: the cited file "${claim.evidence.file}" was not found in the ` +
      'index or PR diff — the citation itself may be stale)'
    );
  }
  const { file, startLine, excerpt, fromDoc, fromDiff } = claim.evidence;
  const label = fromDiff ? 'evidence (PR diff)' : fromDoc ? 'evidence (sibling doc)' : 'evidence';
  return `${header}\n  ${label} — ${file}:${startLine}:\n  \`\`\`\n${excerpt}\n  \`\`\``;
}

const DOC_CLAIMS_V2_HEADER =
  'Pre-computed, same claims as <doc_claims> would normally carry, each tagged with a stable ' +
  '[claim-N] id. Per the PER-CLAIM VERDICT CONTRACT below, one verdict is REQUIRED for every id ' +
  'here (and in <rename_sweep>, if present) — this is your primary claim inventory, not an ' +
  'optional worklist. The scan can still miss claims and can list merely-descriptive prose, so ' +
  'also skim the touched hunks for any claim not listed — report those as ordinary additional ' +
  'findings (no id needed). Most entries carry an `evidence` excerpt: COMPARE the claim against ' +
  'it (confirm the excerpt IS the described code first); for a no-evidence entry, locate the code ' +
  'yourself via get_files_context on the named symbols.';

/** Render the `<doc_claims>` block with ids — the v2 counterpart of
 *  `renderDocClaimsSection`. Returns '' when there are no doc claims at all. */
function renderDocClaimsV2(worklist: ClaimWorklist): string {
  if (worklist.docClaims.length === 0 && worklist.overflowClaims === 0) return '';
  const lines = ['<doc_claims>', DOC_CLAIMS_V2_HEADER];
  worklist.docClaims.forEach((claim, i) =>
    lines.push(renderDocClaimEntryWithId(worklist.docClaimIds[i], claim)),
  );
  if (worklist.overflowClaims > 0) {
    lines.push(
      `- [+${worklist.overflowClaims} more claim(s) omitted — no id assigned; skim the touched ` +
        'doc hunks for any not listed]',
    );
  }
  lines.push('</doc_claims>');
  return lines.join('\n');
}

const RENAME_SWEEP_V2_LEAD =
  'Pre-computed by a deterministic diff scan. This PR applies one or more MECHANICAL identifier ' +
  'renames across many files; each prose-touched line and surviving old-name reference below is ' +
  'tagged with a stable [claim-N] id and, per the PER-CLAIM VERDICT CONTRACT, needs exactly one ' +
  'verdict. A prose-touched line asks "is the claim this sentence makes still TRUE of the new ' +
  'name" (contradicted if the rename made it stale); a survivor asks "should this old-name ' +
  'reference have been renamed too" (contradicted if the rename is incomplete).';

/** Render the `<rename_sweep>` block with ids — the v2 counterpart of
 *  `renderRenameSweepSection`. Returns '' when no rename sweep was detected. */
function renderRenameSweepV2(worklist: ClaimWorklist): string {
  if (worklist.renameSignals.length === 0) return '';
  const lines = ['<rename_sweep>', RENAME_SWEEP_V2_LEAD];
  for (const { signal, proseIds, survivorIds } of worklist.renameSignals) {
    lines.push('');
    lines.push(
      `- Mapping \`${signal.mapping.from}\` → \`${signal.mapping.to}\` ` +
        `(${signal.mapping.occurrenceCount} occurrences across ${signal.mapping.fileCount} files):`,
    );
    signal.proseTouched.forEach((p, i) => {
      lines.push(`  - [${proseIds[i]}] ${p.file}:${p.line} (${p.kind})  \`${p.sentence}\``);
    });
    signal.survivors.forEach((v, i) => {
      const tag = v.repoWide ? ' (untouched file)' : '';
      lines.push(`  - [${survivorIds[i]}] ${v.file}:${v.line}${tag}  \`${v.snippet}\` (survivor)`);
    });
  }
  lines.push('</rename_sweep>');
  return lines.join('\n');
}

const DOC_TRUTH_V2_CONTRACT_NOTE =
  'PER-CLAIM VERDICT CONTRACT (v2): every entry below carries a stable id in [brackets], e.g. ' +
  '"claim-3". You MUST emit exactly one verdict per listed id — mandatory, not optional; do not ' +
  'silently skip an id, including one you judge "accurate". See <output_format> for the exact ' +
  'shape. You may ALSO still report additional findings for a claim you spot yourself that is ' +
  'not in the worklist — those need no id and are evaluated as ordinary findings.';

/** Build the v2 initial message: same shape as `buildDocTruthPassInitialMessage`, but the
 *  doc-claims/rename-sweep blocks carry ids and a contract note is inserted after the intro.
 *  `deferredCount` (0 by default) renders a candidate-overflow note when `worklist` was
 *  rank-and-capped (see `capClaimWorklistToCeiling`) — omitted when nothing was deferred, so
 *  every existing call site is byte-identical to before this feature existed. */
export function buildDocTruthPassInitialMessageV2(
  context: ReviewContext,
  worklist: ClaimWorklist,
  deferredCount = 0,
): string {
  const sections: string[] = [];
  pushIfPresent(sections, renderPassPrHeader(context));
  sections.push(DOC_PASS_INTRO);
  sections.push(DOC_TRUTH_V2_CONTRACT_NOTE);
  pushIfPresent(sections, renderDocClaimsV2(worklist));
  pushIfPresent(sections, renderRenameSweepV2(worklist));
  pushIfPresent(sections, renderGuidanceSurfaceSection(context));
  pushIfPresent(sections, renderDeferralNote(deferredCount));
  sections.push(
    'Judge every listed id and emit its required verdict, then output findings as JSON. If ' +
      'every claim is accurate, every verdict is still required — just each with verdict ' +
      '"accurate" and no additional finding.',
  );
  return sections.join('\n\n');
}

/** The v2 output-contract override, appended after the standard <output_format> section (see
 *  `buildDocTruthPassPrompts`) — models read a prompt as one continuous document, so the LAST
 *  instruction on output shape wins; this supersedes the standard open-list framing for THIS
 *  pass only, without needing to rebuild `buildSystemPrompt`'s tools/rules/examples sections
 *  (unlike stale-duplicate-pass.ts's from-scratch system prompt, which exists because that pass
 *  ALSO hard-cuts the tool list — this pass keeps the full doc-truth tool access). */
function buildV2OutputContractOverride(ids: string[]): string {
  return `<output_format_v2_override>
SUPERSEDES the <output_format> section above for THIS run. The \`findings\` array carries BOTH
the mandatory per-claim verdicts AND any extra findings you spot beyond the worklist:

{
  "findings": [
    {
      "claimId": "claim-1",
      "verdict": "accurate | contradicted | unverifiable",
      "filepath": "relative/path.ts",
      "line": 42,
      "severity": "error | warning",
      "category": "bug",
      "message": "REQUIRED for every verdict. When contradicted: quote the claim and cite the falsifying fact (1-2 sentences). When accurate/unverifiable: 1 sentence saying why.",
      "suggestion": "The fix (contradicted only).",
      "evidence": "One line citing the falsifying code fact (contradicted only)."
    }
  ],
  "summary": { "riskLevel": "low | medium | high | critical", "overview": "One sentence.", "keyChanges": [] }
}

EXACTLY one verdict entry is REQUIRED per id in ${ids.length > 0 ? ids.join(', ') : '(none — no worklist ids this run)'} —
no more, no fewer per id. An extra finding for a claim NOT in the worklist is legal and unlimited
— omit \`claimId\`/\`verdict\` on those; they need no verdict and are evaluated as ordinary
findings. EVERY verdict entry requires claimId, verdict, filepath, line, severity, category, and
message — even for accurate/unverifiable (use the claim's own file for filepath; best-effort
line; severity "warning" unless contradicted, where the usual bug-severity judgment applies;
category any short slug, e.g. "bug"). A missing category silently drops the ENTIRE entry, same as
a missing claimId/verdict. A missing, duplicated, or unrecognized claimId, or a missing/invalid
verdict or category on a claimed entry, makes this pass's result incomplete.
</output_format_v2_override>`;
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

/**
 * The doc pass's token budget: a fraction of the main pass's base budget,
 * floored at `EXTRA_PASS_MIN_BUDGET_TOKENS` so a tiny base (summary-only
 * mode) can't shrink it below one real tool round-trip (see PR #811 /
 * `DOC_PASS_BUDGET_FRACTION`'s doc comment).
 */
export function docTruthPassBudget(baseBudget: number): number {
  return Math.max(Math.round(baseBudget * DOC_PASS_BUDGET_FRACTION), EXTRA_PASS_MIN_BUDGET_TOKENS);
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
// v2 post-processing — verdict reduction + honest completeness
// ---------------------------------------------------------------------------

/** A verdict value the v2 output contract recognizes. */
type DocTruthVerdict = 'accurate' | 'contradicted' | 'unverifiable';
const VALID_DOC_TRUTH_VERDICTS: ReadonlySet<string> = new Set<DocTruthVerdict>([
  'accurate',
  'contradicted',
  'unverifiable',
]);

/** The raw per-claim shape the model MAY emit inside the standard `findings` array under v2 —
 *  `claimId`/`verdict` are both optional because an ad hoc finding beyond the worklist (the
 *  rule's existing "claim not listed" allowance) carries neither. */
interface RawDocClaimVerdict extends AgentFinding {
  claimId?: string;
  verdict?: DocTruthVerdict;
}

/** Strip the v2-only `claimId`/`verdict` fields, keeping the standard finding shape — mirrors
 *  `stale-duplicate-pass.ts`'s `toCleanFinding`. */
function toCleanDocTruthFinding(f: RawDocClaimVerdict): AgentFinding {
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
 * True iff every id in `ids` has EXACTLY ONE recognized verdict among the entries that claim
 * it, and no entry claims an id with an invalid/unknown id or an invalid/missing verdict.
 * Entries with NO `claimId` at all are ad hoc findings (the rule's "claim not listed"
 * allowance) and are exempt from this check entirely — the one deliberate difference from
 * `stale-duplicate-pass.ts`'s `hasCompleteVerdictCoverage`, whose candidate loop has no such
 * open-ended allowance and so requires every entry to carry a valid candidateId/verdict pair.
 * A missing, duplicated, or unrecognized claimId — or a missing/invalid verdict on an entry
 * that DOES carry a claimId — still fails the whole check, same honesty rigor as that sibling
 * function (a malformed claimed entry must never quietly count as "covered").
 */
function hasCompleteVerdictCoverage(ids: string[], raw: RawDocClaimVerdict[]): boolean {
  const expected = new Set(ids);
  const verdictCounts = new Map<string, number>();
  for (const { claimId, verdict } of raw) {
    if (claimId === undefined) continue; // ad hoc finding beyond the worklist — exempt
    if (
      typeof claimId !== 'string' ||
      !expected.has(claimId) ||
      typeof verdict !== 'string' ||
      !VALID_DOC_TRUTH_VERDICTS.has(verdict)
    ) {
      return false;
    }
    verdictCounts.set(claimId, (verdictCounts.get(claimId) ?? 0) + 1);
  }
  return ids.every(id => verdictCounts.get(id) === 1);
}

/**
 * Reduce the raw v2 findings array to real findings: every ad hoc finding (no `claimId`) passes
 * through unchanged, and every claimed entry is kept ONLY when its verdict is `contradicted`
 * (cleaned of the v2-only fields) — mirroring v1's rule text (stay silent unless you have proof
 * of a contradiction) and the exact inclusion-list pattern every sibling candidate-loop pass
 * uses: `stale-duplicate-pass.ts` keeps `verdict === 'stale'` only, `removed-exports-pass.ts`
 * keeps `'breaking'` only, `incomplete-handling-pass.ts` keeps `'incomplete'` only. Both
 * `accurate` and `unverifiable` are dropped rather than guess-promoted: `accurate` because the
 * claim checked out, `unverifiable` because "I couldn't check" is not proof of a contradiction —
 * promoting it made a thin-evidence claim look like a real finding (see the `accurate-doc`
 * precision-guard fixture, which this reduction previously false-fired on 3/3). Coverage
 * honesty is unaffected: `hasCompleteVerdictCoverage` (below) reads the RAW, pre-reduction list,
 * so a claim honestly verdicted `unverifiable` still counts as covered even though it never
 * surfaces here.
 */
function reduceDocTruthV2Findings(raw: RawDocClaimVerdict[]): AgentFinding[] {
  return raw
    .filter(f => f.claimId === undefined || f.verdict === 'contradicted')
    .map(f => (f.claimId !== undefined ? toCleanDocTruthFinding(f) : f));
}

/**
 * Post-process a doc-truth pass result under the v2 contract: reduce verdicts to real findings
 * and mark the result honestly `incomplete_verdict` when coverage is incomplete (see
 * `hasCompleteVerdictCoverage`). Identity (returns `result` unchanged, same reference) when the
 * flag is off — this is what makes `DOC_TRUTH_PASS_SPEC.postProcessResult` safe to wire in
 * unconditionally without touching v1 behavior. When the client result was ALREADY incomplete
 * for a real reason (budget/max_turns/error), that reason is kept as-is, same precedent as
 * `stale-duplicate-pass.ts`'s `postProcessStaleDuplicateResult`.
 *
 * Coverage is checked against the RANK-AND-CAPPED worklist
 * (`capClaimWorklistToCeiling(buildClaimWorklist(context), ceiling)`), not the
 * full pre-cap worklist — a deferred claim was never listed, so it is
 * correctly exempt from the honesty contract (candidate-overflow handling's
 * point 3: deferral is not incompleteness). `budget` must be the SAME value
 * `buildDocTruthPassPrompts` used — `review-pass.ts`'s `runReviewPass`
 * guarantees this by threading one computed budget through both calls.
 */
export function postProcessDocTruthResult(
  result: AgentResult,
  context: ReviewContext,
  budget = Number.POSITIVE_INFINITY,
): AgentResult {
  if (!isDocTruthV2Enabled()) return result;

  const full = buildClaimWorklist(context);
  const ceiling = affordableCandidateCeiling(budget, DOC_TRUTH_TOKENS_PER_CLAIM);
  const { worklist, deferredCount, deferredIds } = capClaimWorklistToCeiling(full, ceiling);
  const ids = allClaimIds(worklist);
  const raw = result.findings as RawDocClaimVerdict[];
  const coverageIncomplete = !hasCompleteVerdictCoverage(ids, raw);
  const wasAlreadyIncomplete = result.incomplete;

  return {
    ...result,
    findings: reduceDocTruthV2Findings(raw),
    incomplete: wasAlreadyIncomplete || coverageIncomplete,
    stopReason:
      !wasAlreadyIncomplete && coverageIncomplete ? 'incomplete_verdict' : result.stopReason,
    candidatesDeferred: deferredCount,
    deferredCandidateIds: deferredCount > 0 ? deferredIds : undefined,
  };
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
 * `appendDocTruthTurns`). `postProcessResult` is always wired in — it's an
 * identity no-op when `LIEN_DOC_TRUTH_V2` is off (see
 * `postProcessDocTruthResult`), so this addition doesn't change v1 behavior.
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
  postProcessResult: postProcessDocTruthResult,
};
