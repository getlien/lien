/**
 * Dedicated docs-drift candidate-loop pass (per-rule-loops design doc §2/§3,
 * `.wip/docs-drift-design.md`). The fifth candidate loop, structurally
 * mirroring the fourth (`removed-exports-pass.ts`) — same six-piece
 * `ReviewPassSpec` shape, same per-candidate-ID-required verdict contract.
 *
 * ## New rule, dedicated-pass-only (no `BUILTIN_RULES` entry)
 *
 * Unlike every prior loop, docs-drift has NO shared-main-pass rule fragment
 * to backstop. doc-truth already covers the TOUCHED-doc drift shape ("the
 * diff itself just changed the described behavior and left the prose
 * describing the OLD behavior"); docs-drift covers the inverse — an UNTOUCHED
 * doc that silently rots after this PR removes/renames/deletes the thing it
 * describes. Reviewing every untouched doc on every PR is exactly the
 * output-list competition the pass architecture exists to kill (ADR-014), so
 * this rule has no main-pass presence to strip — it ships as the pass and
 * only the pass (design §2).
 *
 * ## Reuses an existing signal, builds no new one
 *
 * `docs-drift-signals.ts`'s `computeDocsDriftCandidates` already computes
 * exactly the shape this loop needs: untouched doc/config lines that still
 * word-boundary-reference a symbol this PR's diff removed
 * (`removed-export-signals.ts`), an identifier it mechanically renamed
 * (`rename-sweep-signals.ts`), or a file/directory it fully deleted (that
 * module's own `isFullFileDeletion`) — already tiered (behavioral-claim vs
 * structural-mention) and suppressed on fenced code, changelog/changeset
 * entries, link targets, and past-tense/historical prose. This loop imports
 * that function rather than recomputing any of it.
 *
 * ## Verdict vocabulary: `drifted | historical | intentional | unverifiable`
 *
 * - `drifted` — the untouched doc presents the removed/renamed/deleted
 *   referand as current; a reader is misled. Converts to a finding.
 * - `historical` — the reference is a correct past-tense / changelog /
 *   migration / "retired" note. The primary FP class this loop's deterministic
 *   suppression already filters HARD on, but a model call still sees prose
 *   the deterministic guard didn't quite match — silent.
 * - `intentional` — the referand wasn't semantically removed (only its
 *   export dropped while the definition stays for internal use), or the doc
 *   names a different same-named thing — silent.
 * - `unverifiable` — investigation inconclusive (budget cut, or the doc's
 *   subject is outside the indexed corpus) — silent.
 * Only `drifted` becomes a finding; the other three are silent dispositions
 * the honesty contract still requires exactly one of, per candidate.
 *
 * ## Toolset: read_file + grep_codebase (the removed-exports set)
 *
 * Both sides of a candidate are already inline (the doc excerpt + position
 * tier, and — when re-derivable from the diff — the removal/rename/deletion
 * hunk), so judging a candidate is a COMPARISON, not an investigation:
 * `read_file` confirms the doc line isn't inside a historical section the
 * excerpt's short window clipped; `grep_codebase` confirms the referand is
 * truly gone repo-wide, not re-added under an alias the diff-only scan
 * missed. No broader toolset is needed.
 *
 * ## Dedupe: own-ruleId collision, PLUS a doc-truth cross-dedup
 *
 * docs-drift has no symbol/export identity the way removed-exports does (a
 * doc line, not a code declaration), so this loop's own-collision check is
 * location-only (mirrors the pilot/second-loop's proximity dedupe, minus the
 * identity match). It ALSO drops a candidate finding that collides in
 * location with an EXISTING `doc-truth`-ruleId finding — doc-truth wins,
 * since it saw the touched hunk directly (design §2's "both-fire case":
 * docs-drift's own untouched-file filter already makes the two disjoint on
 * the doc-FILE axis by construction; this is only a belt-and-suspenders
 * backstop for a location collision that construction alone didn't catch).
 */

import type { ReviewContext } from '../../plugin-types.js';

import type { AgentConfig, AgentFinding, AgentResult } from './types.js';
import {
  computeDocsDriftCandidates,
  isFullFileDeletion,
  type DocsDriftCandidate,
} from '../../docs-drift-signals.js';
import {
  renderPassPrHeader,
  EXTRA_PASS_MIN_BUDGET_TOKENS,
  OBSERVED_TOKENS_PER_TURN,
  affordableCandidateCeiling,
  capCandidatesToCeiling,
  deferredCandidateLabels,
  renderDeferralNote,
  type ReviewPassSpec,
} from './review-pass.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Turn cap for the candidate-loop pass — same as removed-exports (a confirm-historical read may
 *  be needed, per design §3). */
export const DOCS_DRIFT_PASS_MAX_TURNS = 8;

const DOCS_DRIFT_BASE_OVERHEAD_TOKENS = 2_000;
const DOCS_DRIFT_PER_CANDIDATE_TOKENS = 800;
const DOCS_DRIFT_MAX_BUDGET = 30_000;
/** Mirrors `docs-drift-signals.ts`'s own `MAX_CANDIDATES` — `computeDocsDriftCandidates` is
 *  already capped there, so this is only used for this pass's own budget-scaling formula, not a
 *  re-slice (see `computeDocsDriftPassCandidates`). */
const MAX_CANDIDATES = 15;

/** Opt-IN env flag — this loop ships dark by default, same as its siblings. */
const DOCS_DRIFT_PASS_ENV = 'LIEN_DOCS_DRIFT_PASS';

export const DOCS_DRIFT_RULE_ID = 'docs-drift';

/** Plugin name this pass reports itself under in the delivery attestation. */
const DOCS_DRIFT_SKIP_PLUGIN = 'agent-review:docs-drift-loop';

/** Two findings on the same file within this many lines are the same location. */
const DEDUPE_LINE_PROXIMITY = 2;

/** The doc-truth loop's own ruleId (see `doc-truth-pass.ts` — not exported as a constant there,
 *  so this is the same literal that module's own merge forces onto its findings). doc-truth wins
 *  a same-location collision, since it saw the touched hunk directly (module doc's "Dedupe"). */
const DOC_TRUTH_RULE_ID = 'doc-truth';

const DOCS_DRIFT_INTRO =
  'This is a DOCS-DRIFT candidate loop — a dedicated pass scoped to untouched documentation ' +
  'that still references code this PR REMOVED, RENAMED, or DELETED, running only because a ' +
  'deterministic corpus sweep already found at least one such surviving reference. Your ONLY ' +
  'job is to judge the <docs_drift> worklist below; do not report anything else (a doc this PR ' +
  "itself TOUCHED is doc-truth's job, and any other bug is out of scope for this pass).";

const DOCS_DRIFT_TOOLS_SECTION = `<tools>
You have these tools to investigate the codebase:
- read_file: Read file contents from the repo — use to check a candidate's doc line isn't part of a historical/changelog section the excerpt's short window clipped (e.g. a "## Migration notes" heading just above it).
- grep_codebase: Search the entire repository working tree for a text pattern (regex) — use ONLY to confirm a referand is genuinely gone repo-wide, not re-added under a different name/alias the diff-only scan couldn't see. Do NOT re-grep the candidates already listed below; that discovery is already done.
</tools>`;

/**
 * Guards against the two FP classes design §3 names explicitly. Baked in from day one, per the
 * removed-exports/incomplete-handling precedent of baking the FP guard in rather than discovering
 * it post-hoc.
 */
const VERDICT_GUIDANCE = `<verdict_guidance>
Two classes of surviving doc reference are usually NOT real drift — do not verdict a candidate
"drifted" on these alone:
1. A reference in a changelog, migration guide, or past-tense "was removed/retired/formerly" note.
   That doc is CORRECTLY describing history, not claiming the referand is current — verdict
   "historical". (The deterministic scan already suppresses most of these before they ever reach
   you; a candidate here means the suppression regex didn't quite match this prose's phrasing —
   look for the same historical shape by eye.)
2. A referand whose DEFINITION survives (only its export was dropped while the declaration stays
   for internal use, or the doc names a different same-named thing) — verdict "intentional": the
   referand isn't semantically gone, only its removed/renamed/deleted SHAPE looked that way to the
   deterministic scan.
A "drifted" verdict REQUIRES BOTH: the referand is genuinely gone (use grep_codebase if in doubt)
AND the doc presents it as current, not past.
</verdict_guidance>`;

const DOCS_DRIFT_STRATEGY = `### Docs Drift — untouched-doc blast radius
For each candidate in the <docs_drift> worklist below:
1. Compare the DOC side (the untouched excerpt + its position tier — a falsifiable behavioral
   claim, or a structural heading/bullet) against the CODE side (the removal/rename/deletion hunk,
   shown when re-derivable from the diff) — the doc line was accurate when the referand was still
   current; your job is to judge whether it still reads that way now that it's gone.
2. Use read_file on the doc file when the excerpt alone doesn't settle whether the surrounding
   section is historical (see <verdict_guidance>).
3. Use grep_codebase only to confirm the referand is truly gone repo-wide when in doubt — not to
   re-discover candidates already listed.
4. Verdict "drifted" ONLY if the doc presents the referand as CURRENT.`;

/** A docs-drift-shaped example — illustrates the four-value vocabulary's two silent classes
 *  alongside the one that converts to a finding. */
const DOCS_DRIFT_EXAMPLE = `### Good finding — untouched doc presents a removed symbol as current:
{
  "filepath": "docs/architecture/api.md",
  "line": 40,
  "severity": "warning",
  "category": "docs_drift",
  "ruleId": "docs-drift",
  "message": "docs/architecture/api.md:40 still describes fetchUser as the way to load a user, but fetchUser was removed from src/api.ts by this PR. A reader following this doc will call a function that no longer exists.",
  "suggestion": "Update or remove this doc's reference to fetchUser.",
  "evidence": "docs_drift candidate; fetchUser removed in src/api.ts, no re-export found repo-wide"
}

### Good finding — verdict is NOT drifted, the doc is a correct historical note:
A candidate whose doc line reads "fetchUser was removed in v2 in favor of getUser" should verdict
"historical" — do not report it as a finding, even though the removed symbol is named.`;

// ---------------------------------------------------------------------------
// Loop eligibility gate
// ---------------------------------------------------------------------------

function envEnabled(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}

/** Whether the loop is opted in — config takes precedence, then the env flag. */
export function isDocsDriftPassEnabled(config?: AgentConfig): boolean {
  if (config?.docsDriftPass === true) return true;
  return envEnabled(process.env[DOCS_DRIFT_PASS_ENV]);
}

/**
 * Precisely why the docs-drift loop would not run right now, or null if it should run. Mirrors
 * `removedExportsSkipReason` — signal-only gating (design §1e): the trigger is "a tiered candidate
 * exists", not a keyword/filePattern.
 */
export function docsDriftSkipReason(context: ReviewContext, config?: AgentConfig): string | null {
  if (!isDocsDriftPassEnabled(config)) {
    return `disabled (opt-in; set config.docsDriftPass or ${DOCS_DRIFT_PASS_ENV}=on to enable)`;
  }
  if (computeDocsDriftCandidates(context).length === 0) {
    return 'no untouched-doc reference to a removed/renamed/deleted referand in this PR';
  }
  return null;
}

/** Whether to run the docs-drift loop. True iff `docsDriftSkipReason` is null. */
export function shouldRunDocsDriftPass(context: ReviewContext, config?: AgentConfig): boolean {
  return docsDriftSkipReason(context, config) === null;
}

// ---------------------------------------------------------------------------
// Candidate worklist (already capped by the shared signal)
// ---------------------------------------------------------------------------

/**
 * The docs-drift candidate list this loop judges — `computeDocsDriftCandidates` already sorts
 * (Tier-1 first, then referand, then doc file:line) and caps at 15, so this is a direct pass-
 * through. Exposed for testing.
 */
export function computeDocsDriftPassCandidates(context: ReviewContext): DocsDriftCandidate[] {
  return computeDocsDriftCandidates(context);
}

function candidateIds(candidates: DocsDriftCandidate[]): string[] {
  return candidates.map((_, i) => `candidate-${i + 1}`);
}

// ---------------------------------------------------------------------------
// Candidate-overflow handling (rank-and-cap with attested deferral)
// ---------------------------------------------------------------------------

/** Best-effort short label for a candidate — for the delivery attestation's `deferredCandidateIds`,
 *  not the pass's own `candidate-N` worklist ids. */
function docsDriftLabel(c: DocsDriftCandidate): string {
  return c.referand;
}

/** This run's actual worklist after rank-and-cap. Each candidate needs at least a confirm-
 *  historical read to judge (module doc: comparison, not open investigation), but a doc/code side
 *  is already inline — still realistically a tool round-trip when in doubt, so this uses
 *  `OBSERVED_TOKENS_PER_TURN` like removed-exports, not this pass's own prompt-sizing constant.
 *  `budget` defaults to unlimited so every existing call site that doesn't pass one is byte-
 *  identical to before this feature existed. Exposed for testing. */
export function computeDocsDriftWorklist(
  context: ReviewContext,
  budget = Number.POSITIVE_INFINITY,
): { candidates: DocsDriftCandidate[]; deferredCount: number; deferredIds: string[] } {
  const all = computeDocsDriftPassCandidates(context);
  const ceiling = affordableCandidateCeiling(budget, OBSERVED_TOKENS_PER_TURN);
  const { kept, deferred } = capCandidatesToCeiling(all, ceiling);
  return {
    candidates: kept,
    deferredCount: deferred.length,
    deferredIds: deferredCandidateLabels(deferred, docsDriftLabel),
  };
}

// ---------------------------------------------------------------------------
// Code-side hunk re-derivation
// ---------------------------------------------------------------------------

const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(?:\d+)(?:,\d+)? @@/;

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordBoundaryRe(token: string): RegExp {
  return new RegExp(`\\b${escapeForRegex(token)}\\b`);
}

/** Split a unified-diff patch into its individual hunks (header + body, verbatim). */
function splitPatchHunks(patch: string): string[] {
  const hunks: string[] = [];
  let current: string[] = [];
  for (const raw of patch.split('\n')) {
    if (HUNK_HEADER_RE.test(raw)) {
      if (current.length > 0) hunks.push(current.join('\n'));
      current = [raw];
    } else if (current.length > 0) {
      current.push(raw);
    }
  }
  if (current.length > 0) hunks.push(current.join('\n'));
  return hunks;
}

/** True iff `hunk`'s REMOVED (`-`) lines mention `token` (word-boundary). */
function hunkRemovesToken(hunk: string, re: RegExp): boolean {
  return hunk.split('\n').some(line => line.startsWith('-') && re.test(line));
}

/** Find the hunk (within one patch) whose REMOVED lines mention `token` — mirrors
 *  `removed-exports-pass.ts`'s `findRemovalHunk`, generalized to any token (a removed-export
 *  symbol or a renamed identifier's old name). */
function findTokenRemovalHunk(patch: string, token: string): string | undefined {
  const re = wordBoundaryRe(token);
  return splitPatchHunks(patch).find(hunk => hunkRemovesToken(hunk, re));
}

/** The code-side evidence for a candidate: which file, and which hunk/patch text. */
interface ReferandHunk {
  file: string;
  hunk: string;
}

/** A deleted-path candidate's own deletion patch — the first patch that IS a full-file deletion
 *  whose file matches (or nests under) the referand path. */
function findDeletedPathHunk(
  patches: Map<string, string>,
  referand: string,
): ReferandHunk | undefined {
  const entry = [...patches].find(
    ([file, patch]) =>
      isFullFileDeletion(patch) && (file === referand || file.startsWith(`${referand}/`)),
  );
  return entry ? { file: entry[0], hunk: entry[1] } : undefined;
}

/** A removed-export/renamed-identifier candidate's removal hunk — the first hunk, across every
 *  patch, whose removed lines mention the referand token. */
function findTokenHunkAcrossPatches(
  patches: Map<string, string>,
  referand: string,
): ReferandHunk | undefined {
  for (const [file, patch] of patches) {
    const hunk = findTokenRemovalHunk(patch, referand);
    if (hunk) return { file, hunk };
  }
  return undefined;
}

/**
 * Locate the code-side hunk that proves a candidate's referand is gone — re-derived from the PR's
 * patches (`DocsDriftCandidate` deliberately doesn't carry this; see that type's own doc comment).
 * Returns undefined when no matching hunk is found (an exotic shape the deterministic re-derivation
 * can't recover — the candidate is still judged on its doc-side excerpt alone).
 */
function findReferandHunk(
  patches: Map<string, string> | undefined,
  candidate: DocsDriftCandidate,
): ReferandHunk | undefined {
  if (!patches) return undefined;
  return candidate.referandKind === 'deleted-path'
    ? findDeletedPathHunk(patches, candidate.referand)
    : findTokenHunkAcrossPatches(patches, candidate.referand);
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

/** Render one candidate's evidence block: doc-side excerpt + tier, code-side removal hunk. */
function renderCandidate(
  id: string,
  c: DocsDriftCandidate,
  patches: Map<string, string> | undefined,
): string {
  const lines: string[] = [`<candidate id="${id}" referand=${JSON.stringify(c.referand)}>`];
  lines.push(`Kind: ${c.referandKind}`);
  lines.push(`Untouched doc: ${c.docFile}:${c.docLine} (${c.positionTier})`);
  lines.push('```');
  lines.push(c.excerpt.replace(/```/g, "'''")); // defang so a doc excerpt can't break this fence
  lines.push('```');

  const ref = findReferandHunk(patches, c);
  if (ref) {
    lines.push(`Code side — ${ref.file}:`);
    lines.push('```diff');
    lines.push(ref.hunk);
    lines.push('```');
  }
  lines.push('</candidate>');
  return lines.join('\n');
}

/** Build the `<docs_drift>` worklist. */
function renderWorklist(context: ReviewContext, candidates: DocsDriftCandidate[]): string {
  const patches = context.pr?.patches;
  const ids = candidateIds(candidates);
  const lines: string[] = ['<docs_drift>'];
  lines.push(
    'One verdict is REQUIRED per candidate id below (see <output_format>) — ' +
      `${ids.join(', ')}. Each candidate is an UNTOUCHED doc/config line that still references a ` +
      'symbol/path this PR removed, renamed, or deleted, already tiered and past every ' +
      'suppression check.',
  );
  candidates.forEach((c, i) => {
    lines.push('');
    lines.push(renderCandidate(ids[i], c, patches));
  });
  lines.push('</docs_drift>');
  return lines.join('\n');
}

/** The per-candidate-verdict output contract (see module doc for the four values). */
function buildOutputFormat(ids: string[]): string {
  return `<output_format>
Output EXACTLY one entry per candidate id in the \`findings\` array — one for EVERY
id in ${ids.join(', ')}, no more, no fewer — in a \`\`\`json code fence:

{
  "findings": [
    {
      "candidateId": "candidate-1",
      "verdict": "drifted | historical | intentional | unverifiable",
      "filepath": "docs/path/to/file.md",
      "line": 42,
      "severity": "error | warning",
      "category": "docs_drift",
      "message": "REQUIRED for every verdict. When drifted: 1-2 sentences naming the removed/renamed/deleted referand and how the doc presents it as current. When historical/intentional/unverifiable: 1 sentence saying why.",
      "suggestion": "The fix (drifted only) — update or remove the stale reference.",
      "evidence": "One line citing the candidate and what you inspected to confirm it."
    }
  ],
  "summary": {
    "riskLevel": "low | medium | high | critical",
    "overview": "One sentence.",
    "keyChanges": []
  }
}

EVERY entry requires candidateId, verdict, filepath, line, severity, category, and
message — even for historical/intentional/unverifiable verdicts (fill filepath from
the candidate's docFile, line from its docLine, severity "warning", category any
short slug e.g. "docs_drift", message explaining the disposition). A missing category
silently drops the ENTIRE entry, same as a missing candidateId — both make this
pass's result incomplete.
</output_format>`;
}

function buildSystemPrompt(ids: string[]): string {
  return `${DOCS_DRIFT_INTRO}

${DOCS_DRIFT_TOOLS_SECTION}

<strategy>
${DOCS_DRIFT_STRATEGY}
</strategy>

${VERDICT_GUIDANCE}

<examples>
${DOCS_DRIFT_EXAMPLE}
</examples>

${buildOutputFormat(ids)}`;
}

/** Build the candidate-loop's initial message: PR header + worklist + a closing nudge. `budget`
 *  drives rank-and-cap overflow handling (see `computeDocsDriftWorklist`) — defaults to unlimited
 *  so existing callers that don't pass one are unaffected. */
export function buildDocsDriftPassInitialMessage(
  context: ReviewContext,
  budget = Number.POSITIVE_INFINITY,
): string {
  const { candidates, deferredCount } = computeDocsDriftWorklist(context, budget);
  const sections: string[] = [];
  const header = renderPassPrHeader(context);
  if (header) sections.push(header);
  sections.push(renderWorklist(context, candidates));
  const deferralNote = renderDeferralNote(deferredCount);
  if (deferralNote) sections.push(deferralNote);
  sections.push('Judge every candidate above and output your verdicts as JSON.');
  return sections.join('\n\n');
}

/** The system + initial prompts for the docs-drift candidate loop. `budget` is this pass's own
 *  final allocated budget (see `ReviewPassSpec.buildPrompts`'s doc comment) — defaults to unlimited
 *  so existing callers unaware of overflow handling are byte-identical to before. */
export function buildDocsDriftPassPrompts(
  context: ReviewContext,
  budget = Number.POSITIVE_INFINITY,
): {
  systemPrompt: string;
  initialMessage: string;
} {
  const { candidates } = computeDocsDriftWorklist(context, budget);
  const ids = candidateIds(candidates);
  return {
    systemPrompt: buildSystemPrompt(ids),
    initialMessage: buildDocsDriftPassInitialMessage(context, budget),
  };
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

/**
 * Budget scaled by this pass's own candidate count, clamped floor/ceiling — mirrors
 * `removedExportsPassBudget`'s formula shape. Floor is `EXTRA_PASS_MIN_BUDGET_TOKENS` (shared
 * across every extra pass): a 1-2 candidate run (the common real-PR case, per the census) gets the
 * same one-real-round-trip floor every other pass gets.
 */
export function docsDriftPassBudget(_baseBudget: number, context: ReviewContext): number {
  const candidateCount = computeDocsDriftPassCandidates(context).length;
  const scaled =
    DOCS_DRIFT_BASE_OVERHEAD_TOKENS +
    DOCS_DRIFT_PER_CANDIDATE_TOKENS * Math.min(candidateCount, MAX_CANDIDATES);
  return Math.min(Math.max(scaled, EXTRA_PASS_MIN_BUDGET_TOKENS), DOCS_DRIFT_MAX_BUDGET);
}

// ---------------------------------------------------------------------------
// Post-processing (verdict reduction + honest completeness)
// ---------------------------------------------------------------------------

/** A verdict value the loop's output contract recognizes. */
type Verdict = 'drifted' | 'historical' | 'intentional' | 'unverifiable';
const VALID_VERDICTS: ReadonlySet<string> = new Set<Verdict>([
  'drifted',
  'historical',
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
 * True iff every expected candidate id appears in `raw` EXACTLY once, each with a RECOGNIZED
 * verdict — and `raw` contains no entry with a missing/unknown candidateId or an unrecognized
 * verdict. Same contract as the sibling loops' `hasCompleteVerdictCoverage`.
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
 * Reduce this pass's raw per-candidate verdict array down to real findings (`verdict ===
 * 'drifted'` AND `candidateId` names a real worklist entry only, cleaned of the loop-only fields),
 * and mark the result honestly incomplete when the verdict array doesn't cleanly cover the
 * worklist — same honesty contract as every sibling loop. The candidateId check guards against the
 * hallucinated-id loophole a code reviewer caught in PR #804: a phantom candidate id must not leak
 * through as a real finding just because it carries `verdict: 'drifted'`.
 *
 * Coverage is checked against the RANK-AND-CAPPED worklist (from `computeDocsDriftWorklist(context,
 * budget)`), not the full pre-cap candidate set — a deferred candidate was never listed, so it is
 * correctly exempt from the honesty contract. `budget` must be the SAME value
 * `buildDocsDriftPassPrompts` used — `review-pass.ts`'s `runReviewPass` guarantees this by
 * threading one computed budget through both calls.
 */
export function postProcessDocsDriftResult(
  result: AgentResult,
  context: ReviewContext,
  budget = Number.POSITIVE_INFINITY,
): AgentResult {
  const { candidates, deferredCount, deferredIds } = computeDocsDriftWorklist(context, budget);
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
          f.verdict === 'drifted' &&
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

/** Two findings on the same file within `DEDUPE_LINE_PROXIMITY` lines are the same location. */
function sameLocation(a: AgentFinding, b: AgentFinding): boolean {
  return a.filepath === b.filepath && Math.abs(a.line - b.line) <= DEDUPE_LINE_PROXIMITY;
}

/** True when `finding` collides in location with an EXISTING `doc-truth`-ruleId finding in
 *  `mainFindings` — doc-truth wins (module doc's "Dedupe": it saw the touched hunk directly). */
function collidesWithDocTruth(finding: AgentFinding, mainFindings: AgentFinding[]): boolean {
  return mainFindings.some(mf => mf.ruleId === DOC_TRUTH_RULE_ID && sameLocation(mf, finding));
}

/**
 * Fold the loop's findings (already reduced to `verdict === 'drifted'` only) into the main pass's.
 * The LOOP finding wins on a same-location collision scoped to `docs-drift`-ruleId main findings
 * (mirrors every sibling loop) — though docs-drift has no main-pass presence to collide with in
 * practice, this keeps the same shape for consistency and future-proofing. A candidate that
 * collides in location with an EXISTING `doc-truth` finding is dropped instead — doc-truth wins
 * that one (see `collidesWithDocTruth`). Returns a new array; inputs are not mutated.
 */
export function mergeDocsDriftFindings(
  mainFindings: AgentFinding[],
  loopFindings: AgentFinding[],
): AgentFinding[] {
  const forced = loopFindings
    .map(f => ({ ...f, ruleId: DOCS_DRIFT_RULE_ID }))
    .filter(f => !collidesWithDocTruth(f, mainFindings));
  const survivingMain = mainFindings.filter(
    mf => mf.ruleId !== DOCS_DRIFT_RULE_ID || !forced.some(lf => sameLocation(mf, lf)),
  );
  return [...survivingMain, ...forced];
}

/**
 * Fold the loop's result-level state into the main pass's — only incomplete/stopReason propagate,
 * naming this pass via the generic `incompleteFromPass` (see types.ts), same as every sibling loop.
 */
export function mergeDocsDriftResultState(
  main: AgentResult,
  passResult: AgentResult | null,
): AgentResult {
  if (!passResult) return main;
  if (passResult.incomplete && !main.incomplete) {
    main.incomplete = true;
    main.stopReason = passResult.stopReason;
    main.incompleteFromPass = 'docs-drift';
  }
  return main;
}

// ---------------------------------------------------------------------------
// ReviewPassSpec (plugs the loop into the generalized executor)
// ---------------------------------------------------------------------------

/**
 * Docs-drift candidate loop bundled as a `ReviewPassSpec` (see `review-pass.ts`). Every field here
 * is one of this module's own pure functions; the generic executor supplies the gate-check/run/
 * failure-isolation/reporting plumbing.
 */
export const DOCS_DRIFT_PASS_SPEC: ReviewPassSpec = {
  name: 'docs-drift-loop',
  skipPlugin: DOCS_DRIFT_SKIP_PLUGIN,
  gateReason: docsDriftSkipReason,
  buildPrompts: buildDocsDriftPassPrompts,
  budget: docsDriftPassBudget,
  maxTurns: DOCS_DRIFT_PASS_MAX_TURNS,
  mergeFindings: mergeDocsDriftFindings,
  mergeResultState: mergeDocsDriftResultState,
  postProcessResult: postProcessDocsDriftResult,
};
