/**
 * Dedicated stale-duplicate candidate-loop PILOT (per-rule-loops design doc
 * §4, `.wip/per-rule-loops-design.md` in the design session's worktree).
 *
 * `stale-literal-signals.ts` already pre-computes a `<stale_literal_candidates>`
 * block for the MAIN pass, unconditionally (the rule's trigger is
 * `always: true`) — a 2026-07-16 real-PR census found that block renders on
 * 40/40 recent PRs even after PR #800's precision tightening (the 8-slot cap
 * simply refills from a large candidate pool). That's fine for the main
 * pass (same LLM call either way), but wrong for a DEDICATED second pass:
 * paying for an extra request on every PR would erase the "own budget, no
 * competition" benefit this architecture exists for. This module adds a
 * STRICTER loop-eligibility gate (`hasEligibleCandidate`, chosen threshold
 * documented there) so the loop only fires on a genuinely selective subset —
 * see the PR body's census table for the measured rate and the alternative
 * thresholds considered.
 *
 * Ships DARK: `staleDuplicateSkipReason` refuses to run unless explicitly
 * opted in (`config.staleDuplicatePass` or `LIEN_STALE_DUP_PASS=on`) — this
 * module changes no default production behavior. A second flag,
 * `LIEN_STALE_DUP_MAIN`, lets a future A/B arm remove the main pass's
 * stale-duplicate rule + signal block once the loop is proven (also
 * default-unchanged).
 *
 * Follows `doc-truth-pass.ts`'s six-piece shape (gate / prompt / budget /
 * merge findings / merge result state / `ReviewPassSpec` bundle), with two
 * deliberate departures the design doc calls out for a candidate loop
 * specifically:
 *  - Trimmed tools (`read_file` + `grep_codebase` only, not the full 6-tool
 *    `TOOLS_SECTION`) — hard-cut, not just prompt-discouraged.
 *  - A per-candidate-ID-required output contract instead of an open findings
 *    list (the pr658 Finding-A lesson: a long open worklist can still be
 *    under-reported even inside a dedicated, single-rule pass). The verdict
 *    array is still carried inside the standard `findings` JSON key (so the
 *    shared client's existing parse/validate pipeline needs no changes) —
 *    each entry is REQUIRED to carry `candidateId` + `verdict` alongside the
 *    ordinary finding fields; `postProcessStaleDuplicateResult` reduces that
 *    to real findings and marks the result honestly incomplete when any
 *    candidate id never got a verdict (the honesty semantics #795's
 *    verdict-recovery work established: a gap is surfaced, never silent).
 */

import type { ReviewContext } from '../../plugin-types.js';

import type { AgentConfig, AgentFinding, AgentResult, ResolvedRules } from './types.js';
import { STALE_DUPLICATE } from './rules.js';
import { envDisabled } from './agent-client-shared.js';
import {
  computeStaleLiteralCandidates,
  type StaleLiteralCandidate,
} from '../../stale-literal-signals.js';
import { renderPassPrHeader, type ReviewPassSpec } from './review-pass.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Turn cap for the candidate-loop pass. Evidence is pre-fetched per candidate
 * (literal, changed-site hunk, every surviving occurrence's snippet), and
 * tools are hard-cut to read_file/grep_codebase — judging the worklist
 * rarely needs more than a couple of tool calls before the verdict turn. */
export const STALE_DUP_PASS_MAX_TURNS = 6;

const STALE_DUP_BASE_OVERHEAD_TOKENS = 2_000;
const STALE_DUP_PER_CANDIDATE_TOKENS = 800;
const STALE_DUP_MIN_BUDGET = 4_000;
const STALE_DUP_MAX_BUDGET = 30_000;
/** Mirrors stale-literal-signals.ts's own MAX_CANDIDATES cap. */
const STALE_DUP_SIGNAL_MAX_CANDIDATES = 8;

/** Opt-IN env flag — this pilot is dark by default (see module doc). */
const STALE_DUP_PASS_ENV = 'LIEN_STALE_DUP_PASS';
/** Opt-OUT env flag for the future A/B's "loop only" arm (see module doc). */
const STALE_DUP_MAIN_ENV = 'LIEN_STALE_DUP_MAIN';

export const STALE_DUP_RULE_ID = 'stale-duplicate';

/** Plugin name this pass reports itself under in the delivery attestation. */
const STALE_DUP_SKIP_PLUGIN = 'agent-review:stale-duplicate-loop';

/** Two findings on the same file within this many lines are the same location. */
const DEDUPE_LINE_PROXIMITY = 2;

const STALE_DUP_INTRO =
  'This is a STALE-DUPLICATE-LITERAL candidate loop — a dedicated second pass ' +
  'scoped to ONE rule, running only because a deterministic scan already found ' +
  'at least one high-confidence candidate. Your ONLY job is to judge the ' +
  '<stale_literal_candidates> worklist below; do not report anything else ' +
  '(other bugs, style, doc drift — those are handled elsewhere).';

const STALE_DUP_TOOLS_SECTION = `<tools>
You have these tools to investigate the codebase:
- read_file: Read file contents from the repo — use when a candidate's snippet doesn't give enough context to judge it (e.g. needs the surrounding function body).
- grep_codebase: Search the entire repository working tree for a text pattern (regex) — use ONLY for a shape the worklist doesn't cover (the rule text's closing paragraph). Do NOT re-grep for literals the worklist already lists; that discovery work is already done.
</tools>`;

/**
 * Guards against the one measured false-positive class in this loop: a
 * confirmed FP probe on a real captured PR had this pass verdict "stale" on
 * a test-helper mock that hardcoded a production rule's display `name` and
 * `category` strings purely to build a fake object, reasoning about a
 * hypothetical FUTURE rename desyncing the mock — even though nothing at
 * runtime reads those strings today (rule gating is by id, never by name/
 * category). The loop's prompt had no guidance telling it that inert
 * test-double duplication and behavior-driving duplication are different
 * things; this section adds exactly that.
 */
const STALE_DUP_VERDICT_GUIDANCE = `<verdict_guidance>
Before verdicting a candidate "stale", check whether the surviving literal
actually drives runtime behavior. A literal is a real stale-duplicate risk
when the surviving site is production code that READS it to make a decision
— a config value, a dispatch key, a threshold, or a user-facing string the
changed site also drives — so a future edit to the changed site silently
desyncs real behavior. A literal is NOT stale when the surviving site is a
test double: a mock, stub, or fixture builder that hardcodes a name/category/
id string purely to construct a fake object for test readability. Nothing at
runtime consumes that copy, so drift between it and the production literal
has zero behavioral consequence — verdict it "intentional-reuse", not
"stale", even if renaming the production literal would someday leave the
mock referencing a stale name. The one exception: if the surviving site is a
test ASSERTION that exercises the CHANGED behavior itself and would keep
passing against the pre-change (now-stale) expected value, that is a real
bug — a test silently validating stale behavior — and should still be
verdicted "stale".
</verdict_guidance>`;

// ---------------------------------------------------------------------------
// Loop eligibility gate
// ---------------------------------------------------------------------------

/**
 * A production (non-comment/non-test/non-config) site, matching
 * `stale-literal-signals.ts`'s own private `productionSites` filter —
 * reimplemented inline here rather than exported from that module, since
 * it's a one-line predicate and exporting it would widen that module's
 * public surface for a single caller.
 */
function isProductionSite(s: StaleLiteralCandidate['staleSites'][number]): boolean {
  return !s.isComment && !s.isTest && !s.isConfig;
}

/**
 * Loop eligibility — STRICTER than whether the `<stale_literal_candidates>`
 * block renders in the main pass (that block renders on ~40/40 real PRs;
 * see the module doc comment and the PR body's census table). Chosen
 * threshold: at least one HIGH-confidence candidate with a production
 * survivor in the SAME FILE as the changed site — the canonical
 * "adapterContext.model on line 300, same file as the line-272 change"
 * shape. Measured at 14/40 (35.0%) of real PRs, inside the "genuinely
 * selective" 15–40% target range; the canonical true-positive fixture
 * (stale-duplicate/model-partial-update, PR #539) clears it.
 */
function hasEligibleCandidate(candidates: StaleLiteralCandidate[]): boolean {
  return candidates.some(
    c =>
      c.confidence === 'high' &&
      c.staleSites.some(s => isProductionSite(s) && s.file === c.changedSite.file),
  );
}

function envEnabled(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}

/** Whether the pilot is opted in — config takes precedence, then the env flag. */
export function isStaleDuplicatePassEnabled(config?: AgentConfig): boolean {
  if (config?.staleDuplicatePass === true) return true;
  return envEnabled(process.env[STALE_DUP_PASS_ENV]);
}

/**
 * Precisely why the stale-duplicate loop would not run right now, or null if
 * it should run. Mirrors `docTruthSkipReason`'s pattern: a caller reporting
 * the skip to the delivery attestation gets the REAL reason (pilot not
 * opted in vs. no eligible candidate), not a generic boolean.
 */
export function staleDuplicateSkipReason(
  context: ReviewContext,
  config?: AgentConfig,
): string | null {
  if (!isStaleDuplicatePassEnabled(config)) {
    return (
      `disabled (pilot opt-in; set config.staleDuplicatePass or ${STALE_DUP_PASS_ENV}=on ` +
      'to enable)'
    );
  }
  const candidates = computeStaleLiteralCandidates(context);
  if (!hasEligibleCandidate(candidates)) {
    return 'no high-confidence, same-file stale-literal candidate (loop eligibility threshold not met)';
  }
  return null;
}

/** Whether to run the stale-duplicate loop. True iff `staleDuplicateSkipReason` is null. */
export function shouldRunStaleDuplicatePass(context: ReviewContext, config?: AgentConfig): boolean {
  return staleDuplicateSkipReason(context, config) === null;
}

// ---------------------------------------------------------------------------
// Main-pass interaction override (v1 second flag — see module doc)
// ---------------------------------------------------------------------------

/**
 * Whether the MAIN pass's stale-duplicate rule + signal block should be
 * suppressed — the future A/B's "loop only, no shared-loop backstop" arm.
 * Default false (unchanged): per requirement 5 of the pilot brief, the main
 * pass keeps the rule and its signal block regardless of whether the
 * dedicated loop is enabled, until the owner explicitly runs that arm.
 */
export function isStaleDuplicateMainDisabled(): boolean {
  const value = process.env[STALE_DUP_MAIN_ENV];
  return value?.trim().toLowerCase() === 'off' || envDisabled(value);
}

/**
 * Strip `stale-duplicate` out of the resolved rule set when the main-pass
 * override is on. `system-prompt.ts`'s `isRuleActive` already gates the
 * `<stale_literal_candidates>` block on rule activity for every OTHER
 * signal-gated rule (error-swallowing, incomplete-handling, boundary-change)
 * — stale-duplicate's `always: true` trigger just never needed that gate
 * before. Routing this override through the SAME `isRuleActive` check means
 * one change removes both the rule's prompt fragment and its signal block
 * together, with no new gating mechanism to maintain.
 */
export function applyStaleDuplicateMainOverride(rules: ResolvedRules): ResolvedRules {
  if (!isStaleDuplicateMainDisabled()) return rules;
  return {
    active: rules.active.filter(r => r.id !== STALE_DUP_RULE_ID),
    skipped: [...rules.skipped, `${STALE_DUP_RULE_ID} (${STALE_DUP_MAIN_ENV}=off)`],
  };
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function candidateIds(candidates: StaleLiteralCandidate[]): string[] {
  return candidates.map((_, i) => `candidate-${i + 1}`);
}

const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Find the diff hunk (a `@@ ... @@` block and its lines) whose post-image
 * line range contains `line`, from one file's raw unified-diff patch text.
 * Returns undefined when the patch has no hunk covering that line (e.g. the
 * literal was recorded from a `-` removed line whose hunk's new-range still
 * covers neighbouring context — the common case — but a pathological diff
 * could in principle miss).
 */
function extractHunkContaining(patch: string | undefined, line: number): string | undefined {
  if (!patch) return undefined;
  let hunkStart = -1;
  let newLine = 0;
  let hunkLines: string[] = [];

  const flushIfMatch = (): string | undefined =>
    hunkStart !== -1 && hunkStart <= line && line <= newLine ? hunkLines.join('\n') : undefined;

  for (const raw of patch.split('\n')) {
    const header = raw.match(HUNK_HEADER_RE);
    if (header) {
      const match = flushIfMatch();
      if (match) return match;
      hunkStart = parseInt(header[1], 10);
      newLine = hunkStart - 1;
      hunkLines = [raw];
      continue;
    }
    if (hunkStart === -1) continue; // before the first hunk (file headers)
    hunkLines.push(raw);
    if (raw.startsWith('+') || raw.startsWith(' ')) newLine++;
  }
  return flushIfMatch();
}

/** Render one candidate's evidence block: literal, changed-site hunk, every surviving site. */
function renderCandidate(id: string, c: StaleLiteralCandidate, patch: string | undefined): string {
  const lines: string[] = [];
  lines.push(
    `<candidate id="${id}" literal=${JSON.stringify(c.literal)} confidence="${c.confidence}">`,
  );
  lines.push(`Changed site: ${c.changedSite.file}:${c.changedSite.line}`);
  const hunk = extractHunkContaining(patch, c.changedSite.line);
  if (hunk) {
    lines.push('```diff');
    lines.push(hunk);
    lines.push('```');
  }
  lines.push('Surviving site(s):');
  for (const s of c.staleSites) {
    const tags = [s.isComment && 'comment', s.isTest && 'test', s.isConfig && 'config']
      .filter(Boolean)
      .join(', ');
    lines.push(`  - ${s.file}:${s.line}${tags ? ` (${tags})` : ''}  \`${s.snippet}\``);
  }
  lines.push('</candidate>');
  return lines.join('\n');
}

/**
 * Build the worklist — one entry per candidate id. Uses the SAME
 * `<stale_literal_candidates>` tag name the shared `STALE_DUPLICATE.prompt`
 * text (reused verbatim as this pass's `<strategy>`, below) instructs the
 * model to look for — a real mismatch here (a different tag name than what
 * the rule text promises) is exactly the "prompt promises a signal it
 * doesn't inject" bug class the per-rule-loops design doc's §1 called out
 * for the rename-sweep/doc-truth precedent. Safe to reuse across the main
 * pass and this pass: they are separate, non-overlapping LLM calls, so the
 * shared tag name never collides within a single turn.
 */
function renderWorklist(context: ReviewContext, candidates: StaleLiteralCandidate[]): string {
  const patches = context.pr?.patches;
  const ids = candidateIds(candidates);
  const lines: string[] = [];
  lines.push('<stale_literal_candidates>');
  lines.push(
    'One verdict is REQUIRED per candidate id below (see <output_format>) — ' +
      `${ids.join(', ')}. Each candidate is a literal this PR changed at the CHANGED ` +
      'SITE but that still appears unchanged at the SURVIVING SITE(S); judge whether ' +
      'each surviving site should track the changed site.',
  );
  candidates.forEach((c, i) => {
    lines.push('');
    lines.push(renderCandidate(ids[i], c, patches?.get(c.changedSite.file)));
  });
  lines.push('</stale_literal_candidates>');
  return lines.join('\n');
}

/** The per-candidate-verdict output contract (see module doc for why this
 * stays inside the standard `findings` key rather than a separate one). */
function buildOutputFormat(ids: string[]): string {
  return `<output_format>
Output EXACTLY one entry per candidate id in the \`findings\` array — one for EVERY
id in ${ids.join(', ')}, no more, no fewer — in a \`\`\`json code fence:

{
  "findings": [
    {
      "candidateId": "candidate-1",
      "verdict": "stale | intentional-reuse | unverifiable",
      "filepath": "relative/path.ts",
      "line": 42,
      "severity": "error | warning",
      "category": "logic_error",
      "message": "REQUIRED for every verdict. When stale: 1-2 sentences naming both locations and the wrong behavior. When intentional-reuse or unverifiable: 1 sentence saying why.",
      "suggestion": "The fix (stale only) — hoist to a shared const, or apply the same change.",
      "evidence": "One line citing the candidate (stale only)."
    }
  ],
  "summary": {
    "riskLevel": "low | medium | high | critical",
    "overview": "One sentence.",
    "keyChanges": []
  }
}

EVERY entry requires candidateId, verdict, filepath, line, severity, and message —
even for intentional-reuse/unverifiable verdicts (fill filepath/line from the
candidate's changed site, severity "warning", message explaining the disposition).
A missing candidateId for any worklist entry makes this pass's result incomplete.
</output_format>`;
}

function buildSystemPrompt(ids: string[]): string {
  return `${STALE_DUP_INTRO}

${STALE_DUP_TOOLS_SECTION}

<strategy>
${STALE_DUPLICATE.prompt}
</strategy>

${STALE_DUP_VERDICT_GUIDANCE}

<examples>
${STALE_DUPLICATE.example}
</examples>

${buildOutputFormat(ids)}`;
}

/** Build the candidate-loop's initial message: PR header + worklist + a closing nudge. */
export function buildStaleDuplicatePassInitialMessage(context: ReviewContext): string {
  const candidates = computeStaleLiteralCandidates(context);
  const sections: string[] = [];
  const header = renderPassPrHeader(context);
  if (header) sections.push(header);
  sections.push(renderWorklist(context, candidates));
  sections.push('Judge every candidate above and output your verdicts as JSON.');
  return sections.join('\n\n');
}

/** The system + initial prompts for the stale-duplicate candidate loop. */
export function buildStaleDuplicatePassPrompts(context: ReviewContext): {
  systemPrompt: string;
  initialMessage: string;
} {
  const ids = candidateIds(computeStaleLiteralCandidates(context));
  return {
    systemPrompt: buildSystemPrompt(ids),
    initialMessage: buildStaleDuplicatePassInitialMessage(context),
  };
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

/**
 * Budget scaled by this pass's own candidate count (per the per-rule-loops
 * design doc §2), clamped floor/ceiling — mirrors `summary-only-pass.ts`'s
 * `scaleSummaryOnlyBudget` clamp pattern rather than doc-truth's flat
 * fraction: a 1-candidate loop shouldn't pay the same budget as an 8-
 * candidate one.
 */
export function staleDuplicatePassBudget(_baseBudget: number, context: ReviewContext): number {
  const candidateCount = computeStaleLiteralCandidates(context).length;
  const scaled =
    STALE_DUP_BASE_OVERHEAD_TOKENS +
    STALE_DUP_PER_CANDIDATE_TOKENS * Math.min(candidateCount, STALE_DUP_SIGNAL_MAX_CANDIDATES);
  return Math.min(Math.max(scaled, STALE_DUP_MIN_BUDGET), STALE_DUP_MAX_BUDGET);
}

// ---------------------------------------------------------------------------
// Post-processing (verdict reduction + honest completeness)
// ---------------------------------------------------------------------------

/** A verdict value the loop's output contract recognizes. */
type Verdict = 'stale' | 'intentional-reuse' | 'unverifiable';
const VALID_VERDICTS: ReadonlySet<string> = new Set<Verdict>([
  'stale',
  'intentional-reuse',
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
 * unknown candidateId or an unrecognized verdict. Checking candidateId
 * presence alone (an earlier version of this function) let a malformed
 * entry — a valid candidateId paired with a missing/garbage verdict — count
 * as "covered" while still failing `toCleanFinding`'s `verdict === 'stale'`
 * filter: it silently vanished from BOTH the coverage check and the
 * findings array, exactly the "quiet gap" this pass's honesty contract
 * exists to catch. A duplicate or unexpected-id entry is treated the same
 * way — the contract is "one recognized verdict per expected id", not
 * merely "every id mentioned somewhere".
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
 * Reduce this pass's raw per-candidate verdict array (still carried inside
 * `result.findings`, tagged with `candidateId`/`verdict` — see module doc)
 * down to real findings (`verdict === 'stale'` only, cleaned of the loop-
 * only fields), and mark the result honestly incomplete when the verdict
 * array doesn't cleanly cover the worklist (see `hasCompleteVerdictCoverage`)
 * — the pr658 Finding-A lesson made machine-checkable: a coverage gap is a
 * completeness failure the harness can assert on directly, not a semantic
 * judgment call. When the underlying client result was ALREADY incomplete
 * for a real reason (budget/max_turns/error), that reason is kept as-is
 * (more specific than the generic coverage-gap marker); `incomplete_verdict`
 * is only used when the model otherwise returned a syntactically complete
 * verdict.
 */
export function postProcessStaleDuplicateResult(
  result: AgentResult,
  context: ReviewContext,
): AgentResult {
  const ids = candidateIds(computeStaleLiteralCandidates(context));
  const raw = result.findings as RawVerdictFinding[];
  const coverageIncomplete = !hasCompleteVerdictCoverage(ids, raw);
  const wasAlreadyIncomplete = result.incomplete;

  return {
    ...result,
    findings: raw.filter(f => f.verdict === 'stale').map(toCleanFinding),
    incomplete: wasAlreadyIncomplete || coverageIncomplete,
    stopReason:
      !wasAlreadyIncomplete && coverageIncomplete ? 'incomplete_verdict' : result.stopReason,
  };
}

// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

function sameLocation(a: AgentFinding, b: AgentFinding): boolean {
  return a.filepath === b.filepath && Math.abs(a.line - b.line) <= DEDUPE_LINE_PROXIMITY;
}

/**
 * Fold the loop's findings (already reduced to `verdict === 'stale'` only by
 * `postProcessStaleDuplicateResult`) into the main pass's. Unlike doc-truth's
 * dedupe (main pass wins), requirement 5 of the pilot brief has the LOOP
 * finding win: when a loop finding and a main-pass finding collide on
 * location, the main-pass one is dropped — the loop finding carries the
 * per-candidate evidence the shared loop's freeform grep pass doesn't.
 *
 * Dropping is scoped to main-pass findings whose OWN `ruleId` is also
 * `stale-duplicate` — i.e. only the shared loop's freeform backstop copy of
 * the SAME rule, never an unrelated rule's finding that merely happens to
 * land within `DEDUPE_LINE_PROXIMITY` lines. Proximity-only matching (an
 * earlier version of this function) could silently drop a real finding from
 * a completely different rule (e.g. `error-swallowing`) just because it sat
 * near a stale-duplicate loop finding — a real correctness risk unique to
 * this "loop wins" direction (doc-truth's "main wins" convention never
 * risks discarding an unrelated finding, since the dropped side is always
 * doc-truth's own).
 *
 * Returns a new array; inputs are not mutated.
 */
export function mergeStaleDuplicateFindings(
  mainFindings: AgentFinding[],
  loopFindings: AgentFinding[],
): AgentFinding[] {
  const forced = loopFindings.map(f => ({ ...f, ruleId: STALE_DUP_RULE_ID }));
  const survivingMain = mainFindings.filter(
    mf => mf.ruleId !== STALE_DUP_RULE_ID || !forced.some(lf => sameLocation(mf, lf)),
  );
  return [...survivingMain, ...forced];
}

/**
 * Fold the loop's result-level state into the main pass's. Only
 * incomplete/stopReason propagate (unlike doc-truth's own risk-level lift,
 * which is specific to a documentation-contradicts-code semantic that
 * doesn't clearly apply here) — a still-incomplete loop marks the merged
 * result incomplete, naming this pass via the generic `incompleteFromPass`
 * (see types.ts) so `appendIncompleteNotice` (index.ts) doesn't imply the
 * whole review is partial.
 */
export function mergeStaleDuplicateResultState(
  main: AgentResult,
  passResult: AgentResult | null,
): AgentResult {
  if (!passResult) return main;
  if (passResult.incomplete && !main.incomplete) {
    main.incomplete = true;
    main.stopReason = passResult.stopReason;
    main.incompleteFromPass = 'stale-duplicate';
  }
  return main;
}

// ---------------------------------------------------------------------------
// ReviewPassSpec (plugs the loop into the generalized executor)
// ---------------------------------------------------------------------------

/**
 * Stale-duplicate candidate loop bundled as a `ReviewPassSpec` (see
 * `review-pass.ts`) — the pilot's plug-in point. Every field here is one of
 * this module's own pure functions; the generic executor supplies the
 * gate-check/run/failure-isolation/reporting plumbing.
 */
export const STALE_DUPLICATE_PASS_SPEC: ReviewPassSpec = {
  name: 'stale-duplicate-loop',
  skipPlugin: STALE_DUP_SKIP_PLUGIN,
  gateReason: staleDuplicateSkipReason,
  buildPrompts: buildStaleDuplicatePassPrompts,
  budget: staleDuplicatePassBudget,
  maxTurns: STALE_DUP_PASS_MAX_TURNS,
  mergeFindings: mergeStaleDuplicateFindings,
  mergeResultState: mergeStaleDuplicateResultState,
  postProcessResult: postProcessStaleDuplicateResult,
};
