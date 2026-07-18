/**
 * Dedicated removed-exports candidate-loop pass (ADR-014's gating matrix,
 * `docs/architecture/decisions/0014-per-rule-candidate-loop-passes.md` —
 * `structural-analysis` is marked **hybrid**: this pass covers the removed-
 * export sweep half; the broader "check if callers handle new behavior
 * correctly" caller-impact-of-changed-behavior half stays in the shared main
 * pass, unconditionally, forever — see "Why hybrid, not full graduation"
 * below). The fourth candidate loop, structurally mirroring the first two
 * (`stale-duplicate-pass.ts`, PR #803; `incomplete-handling-pass.ts`, PR
 * #804) — same six-piece `ReviewPassSpec` shape, same per-candidate-ID-
 * required verdict contract.
 *
 * ## Reuses an existing signal, builds no new one
 *
 * `removed-export-signals.ts` already computes exactly the shape this loop
 * needs: `computeRemovedExportContexts` extracts every public export a PR's
 * diff removes, minus any re-added elsewhere (a moved/renamed-file export is
 * not a removal — the rename-vs-remove disambiguation lives there, not
 * here), then finds every SURVIVING cross-file reference in the indexed head
 * corpus (the "dependents" proxy — see that module's own doc comment for why
 * a corpus text-scan stands in for a live `get_dependents` call in this
 * deterministic-signal context) and any `.changeset/*.md` entry that
 * mentions the symbol. That module already serves two callers — the MAIN
 * pass's `<removed_exports>` block (`structural-analysis`) and
 * `boundary-change`'s changeset-contradiction cross-check — so this loop
 * imports it rather than recomputing any of that (`computeRemovedExportContexts`
 * is not called from a re-implementation here).
 *
 * ## Why hybrid, not full graduation (no `LIEN_REMOVED_EXPORTS_MAIN` override)
 *
 * Both prior loops ship a second, independent opt-out env flag
 * (`LIEN_STALE_DUP_MAIN=off` / `LIEN_INCOMPLETE_MAIN=off`) for a *future* A/B
 * arm that would strip the ENTIRE rule from the main pass once its dedicated
 * loop is proven — because for both of those rules, the dedicated loop's
 * candidate shape covers the WHOLE rule. `structural-analysis` is different:
 * ADR-014's gating matrix marks it **hybrid** specifically because only ONE
 * of its two jobs (the removed-export sweep) has a bounded candidate shape —
 * the other (`rules.ts`'s "Check if callers handle new behavior correctly",
 * judging a CHANGED, not removed, export's new semantics against its
 * callers) is open investigation with no candidate list, the same reason
 * `boundary-change` stays out of the candidate-loop pattern entirely (per
 * the ADR's Context). Stripping `structural-analysis` out of the main pass's
 * active rules — the mechanism `applyStaleDuplicateMainOverride` /
 * `applyIncompleteHandlingMainOverride` use — would silently remove that
 * OTHER half's coverage too, with no dedicated pass to replace it. This
 * module therefore offers no main-pass-disable override: `<removed_exports>`
 * stays in the main pass unconditionally regardless of this loop's on/off
 * state, by design, not merely "not yet run."
 *
 * ## Verdict vocabulary: `breaking | intentional | internal-only | unverifiable`
 *
 * Adapted from the pilot's three-value set (`stale | intentional-reuse |
 * unverifiable`) to name the two FP classes the #711-era "removed-export vs
 * changeset" tuning history and this signal's own module doc already
 * identify:
 *  - `breaking` — a real, undisclosed breaking change. Converts to a finding.
 *  - `intentional` — the removal is DELIBERATE and DISCLOSED: an
 *    accompanying changeset entry describes this exact removal (or the
 *    version bump it belongs to). A changeset-documented removal is the
 *    historical FP source this loop must not flag — carrying the changeset
 *    mention as EVIDENCE (never auto-suppressing) is what lets the model
 *    still catch the inverse case: a changeset that misdescribes the break
 *    as non-breaking is itself a `boundary-change`-flavored contradiction,
 *    out of THIS pass's scope but exactly why the evidence is shown, not
 *    hidden.
 *  - `internal-only` — the surviving reference(s) are not a real external
 *    breakage: test/fixture files, or consumers that never see this export
 *    as public API. Test-only importers are the other historical FP class
 *    named in the brief.
 *  - `unverifiable` — investigation couldn't confirm either way (budget cut
 *    short, or the export's real consumers are outside the indexed corpus —
 *    e.g. a published package's external consumers, which no local corpus
 *    scan can see).
 * Only `breaking` becomes a finding; the other three are silent dispositions
 * the honesty contract still requires exactly one of, per candidate.
 *
 * ## Toolset: read_file + grep_codebase (the pilot's set, not the second
 * loop's three-tool set)
 *
 * Every candidate here already carries the removal's diff hunk (re-derived
 * from the patch text — `removed-export-signals.ts`'s `RemovedExport` has no
 * stored line number, only `symbol` + `file`, since it's a presentation-only
 * need this module doesn't widen that shared shape for), every surviving
 * reference's `file:line`, and any changeset mention. Judging a candidate is
 * "is this surviving reference real production usage or not" — a single-file
 * `read_file` question, not the second loop's "is this handled via a
 * different mechanism entirely" cross-file structural question that justified
 * `get_files_context` there. `grep_codebase` stays as the same documented
 * escape hatch the rule's own prompt text already names ("Only grep_codebase
 * for removed symbols NOT covered there — the scan can miss exotic export
 * shapes").
 *
 * ## Dedupe: same-export identity, not just location proximity
 *
 * Unlike the pilot/second loop's proximity-only dedupe (same file, within a
 * few lines), a removed-export candidate carries a STABLE identity — the
 * removed symbol name — that a main-pass `structural-analysis` finding often
 * also carries (`AgentFinding.symbolName`, per that rule's own example). This
 * loop's merge matches on `symbolName` equality (same file) IN ADDITION TO
 * line proximity, so a main-pass finding that cites a different surviving
 * call site's line for the SAME removed symbol still dedupes correctly
 * against this loop's own (better-evidenced) finding.
 */

import type { ReviewContext } from '../../plugin-types.js';

import type { AgentConfig, AgentFinding, AgentResult } from './types.js';
import {
  computeRemovedExportContexts,
  type RemovedExportContext,
} from '../../removed-export-signals.js';
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

/** Turn cap for the candidate-loop pass. Every candidate needs at least one
 * read_file round trip to confirm a surviving reference is real production
 * usage (no inline snippet is attached, unlike the pilot's stale-literal
 * candidates) — higher than the pilot's 6, matching the second loop's 8. */
export const REMOVED_EXPORTS_PASS_MAX_TURNS = 8;

const REMOVED_EXPORTS_BASE_OVERHEAD_TOKENS = 2_000;
const REMOVED_EXPORTS_PER_CANDIDATE_TOKENS = 800;
const REMOVED_EXPORTS_MAX_BUDGET = 30_000;
/** Mirrors removed-export-signals.ts's own private MAX_ENTRIES cap (15) — that
 * module's `computeRemovedExportContexts` is itself uncapped (its cap is only
 * applied by its own renderer, which this pass does not use), so this pass
 * re-applies the same cap locally, same reasoning as the second loop's
 * VARIANT_SWEEP_CAP/UNREAD_FIELD_CAP. */
const MAX_CANDIDATES = 15;

/** Opt-IN env flag — this loop ships dark by default, same as its siblings. */
const REMOVED_EXPORTS_PASS_ENV = 'LIEN_REMOVED_EXPORTS_PASS';

export const STRUCTURAL_ANALYSIS_RULE_ID = 'structural-analysis';

/** Plugin name this pass reports itself under in the delivery attestation. */
const REMOVED_EXPORTS_SKIP_PLUGIN = 'agent-review:removed-exports-loop';

/** Two findings on the same file within this many lines are the same location. */
const DEDUPE_LINE_PROXIMITY = 2;

const REMOVED_EXPORTS_INTRO =
  'This is a REMOVED-EXPORTS candidate loop — a dedicated second pass scoped to ' +
  'the removed-export-sweep half of ONE rule (structural-analysis), running only ' +
  'because a deterministic diff scan already found at least one removed public ' +
  'export. Your ONLY job is to judge the <removed_exports> worklist below; do not ' +
  "report anything else (a changed-but-not-removed export's new behavior, other " +
  'bugs, style, doc drift — those are handled elsewhere).';

const REMOVED_EXPORTS_TOOLS_SECTION = `<tools>
You have these tools to investigate the codebase:
- read_file: Read file contents from the repo — use to inspect a surviving reference's actual site and confirm it is real production usage, not a comment, test, or unrelated string match.
- grep_codebase: Search the entire repository working tree for a text pattern (regex) — use ONLY for an exotic export shape the worklist doesn't cover (the rule text's own closing note). Do NOT re-grep the symbols already listed below; that discovery and reference sweep is already done.
</tools>`;

/**
 * Guards against the two FP classes the #711-era removed-export/changeset
 * tuning history and this signal's own module doc already name. Baked in
 * from day one, per the pilot's own lesson (its equivalent guard was only
 * added in PR #805, after an FP was observed) and the second loop's (which
 * baked its guard in from the start, avoiding a repeat).
 */
const VERDICT_GUIDANCE = `<verdict_guidance>
Two classes of surviving reference are usually NOT a real breaking change — do not
verdict a candidate "breaking" on these alone:
1. A removal already DISCLOSED by an accompanying changeset entry (the candidate's
   "Changeset:" line names one). A changeset-documented removal is a deliberate,
   announced break — verdict "intentional", not "breaking" — UNLESS the changeset's
   own wording contradicts what actually happened (e.g. it claims the symbol is
   unchanged or non-breaking while a production caller still depends on it); that
   contradiction is still worth naming in your message even though it verdicts
   "intentional" here (a full changeset-vs-reality cross-check is boundary-change's
   job, not this pass's).
2. A surviving reference that lives ONLY in test files, fixtures, or internal-only
   tooling that never sees this export as real public API — verdict "internal-only".
A real "breaking" verdict requires at least one surviving reference in PRODUCTION
code (not test/fixture/internal-only) with no changeset documenting the removal.
</verdict_guidance>`;

/**
 * A condensed, LOOP-SCOPED strategy — deliberately NOT `STRUCTURAL_ANALYSIS.prompt`
 * reused verbatim the way the pilot/second loop reuse their own rule's full text.
 * That rule's full prompt is written for the MAIN pass's BROADER job (5 steps:
 * get_files_context, get_dependents, the removed-export check, "check if callers
 * handle new behavior correctly", read_file on every changed function) — only
 * step 3 is this loop's job. Steps 1/2/4/5 name tools (`get_files_context`,
 * `get_dependents`) this loop's hard-cut toolset (see module doc) doesn't
 * provide and a broader investigation (changed-but-not-removed behavior) this
 * loop must NOT attempt (that's the shared main pass's job, per ADR-014's
 * hybrid gating). Verbatim reuse here would tell the model to use tools that
 * don't exist for this pass — a real contradiction, not just unused prose.
 */
const REMOVED_EXPORTS_STRATEGY = `### Structural Analysis — removed-export sweep
For each candidate in the <removed_exports> worklist below:
1. If it lists surviving reference(s), use read_file to inspect each one and confirm
   it is REAL production usage (an import, a call site, a type reference) — not a
   comment, a test/fixture file, or an unrelated string match.
2. Check whether a changeset already documents this removal (the candidate's
   "Changeset:" line) — see <verdict_guidance> below for how that interacts with
   your verdict.
3. Removed exports are the #1 source of breaking changes in deletion PRs — do not
   assume a removal is safe just because this repo's own callers were updated; a
   consumer outside this repo's own type-checked boundary (a published package's
   external user, a dynamically-loaded plugin) can still break silently and won't
   show up as a surviving reference in this corpus.
4. Only use grep_codebase for an export shape the worklist doesn't cover (the
   scan can miss exotic shapes) — do NOT re-grep symbols already listed above.`;

/** A removed-export-shaped example — `STRUCTURAL_ANALYSIS.example` illustrates a
 * CHANGED (not removed) export's new behavior, the wrong shape for this loop. */
const REMOVED_EXPORTS_EXAMPLE = `### Good finding — removed export, real caller breaks:
{
  "filepath": "src/consumer.ts",
  "line": 4,
  "symbolName": "fetchUser",
  "severity": "error",
  "category": "breaking_change",
  "ruleId": "structural-analysis",
  "message": "fetchUser was removed from src/api.ts but src/consumer.ts:4 still imports and calls it directly. This import will fail to resolve.",
  "suggestion": "Restore fetchUser, or update src/consumer.ts to use its replacement.",
  "evidence": "removed_exports worklist candidate; surviving reference confirmed via read_file at src/consumer.ts:4"
}

### Good finding — verdict is NOT breaking, changeset documents the removal:
A candidate with a "Changeset: described in .changeset/silly-otters-jump.md" line
whose changeset text explicitly announces this removal should verdict "intentional"
— do not report it as a finding, even if a surviving reference exists.`;

// ---------------------------------------------------------------------------
// Loop eligibility gate
// ---------------------------------------------------------------------------

/**
 * Loop eligibility: at least one removed-export candidate. Unlike the
 * pilot's unconditional `always: true` signal (which renders on ~40/40 real
 * PRs, forcing a stricter same-file/high-confidence threshold),
 * `computeRemovedExportContexts` is ALREADY selective by construction — it
 * returns [] unless the diff actually removes a public export, the same
 * shape the second loop's `hasEligibleCandidate` relies on. No extra
 * confidence tiering on top of "any candidate exists" (see the PR body's
 * real-PR census for the measured firing rate).
 */
function hasEligibleCandidate(candidates: RemovedExportContext[]): boolean {
  return candidates.length > 0;
}

function envEnabled(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}

/** Whether the loop is opted in — config takes precedence, then the env flag. */
export function isRemovedExportsPassEnabled(config?: AgentConfig): boolean {
  if (config?.removedExportsPass === true) return true;
  return envEnabled(process.env[REMOVED_EXPORTS_PASS_ENV]);
}

/**
 * Precisely why the removed-exports loop would not run right now, or null if
 * it should run. Mirrors `staleDuplicateSkipReason`/`incompleteHandlingSkipReason`.
 */
export function removedExportsSkipReason(
  context: ReviewContext,
  config?: AgentConfig,
): string | null {
  if (!isRemovedExportsPassEnabled(config)) {
    return (
      `disabled (opt-in; set config.removedExportsPass or ${REMOVED_EXPORTS_PASS_ENV}=on ` +
      'to enable)'
    );
  }
  const candidates = computeRemovedExportsCandidates(context);
  if (!hasEligibleCandidate(candidates)) {
    return 'no removed public export found in this PR’s diff';
  }
  return null;
}

/** Whether to run the removed-exports loop. True iff `removedExportsSkipReason` is null. */
export function shouldRunRemovedExportsPass(context: ReviewContext, config?: AgentConfig): boolean {
  return removedExportsSkipReason(context, config) === null;
}

// ---------------------------------------------------------------------------
// Candidate worklist (capped)
// ---------------------------------------------------------------------------

/**
 * The capped removed-export candidate list this loop judges — the shared
 * signal's own sort order (breakage-first, then changeset-mentioned, ties by
 * symbol name) is preserved, just capped at `MAX_CANDIDATES` for prompt size.
 * Exposed for testing.
 */
export function computeRemovedExportsCandidates(context: ReviewContext): RemovedExportContext[] {
  return computeRemovedExportContexts(context).slice(0, MAX_CANDIDATES);
}

function candidateIds(candidates: RemovedExportContext[]): string[] {
  return candidates.map((_, i) => `candidate-${i + 1}`);
}

// ---------------------------------------------------------------------------
// Candidate-overflow handling (rank-and-cap with attested deferral)
// ---------------------------------------------------------------------------

/** Best-effort short label for a candidate — for the delivery attestation's
 *  `deferredCandidateIds`, not the pass's own `candidate-N` worklist ids. */
function removedExportsLabel(c: RemovedExportContext): string {
  return c.symbol;
}

/** This run's actual worklist after rank-and-cap. No candidate here carries an inline snippet
 *  (module doc: "no inline snippet is attached, unlike the pilot's stale-literal candidates") —
 *  confirming a surviving reference is real production usage requires read_file, so the
 *  realistic per-candidate cost is `OBSERVED_TOKENS_PER_TURN`, not this pass's own (prompt-sizing)
 *  PER_CANDIDATE_TOKENS constant. `budget` defaults to unlimited so every existing call site that
 *  doesn't pass one is byte-identical to before this feature existed. Exposed for testing. */
export function computeRemovedExportsWorklist(
  context: ReviewContext,
  budget = Number.POSITIVE_INFINITY,
): { candidates: RemovedExportContext[]; deferredCount: number; deferredIds: string[] } {
  const all = computeRemovedExportsCandidates(context);
  const ceiling = affordableCandidateCeiling(budget, OBSERVED_TOKENS_PER_TURN);
  const { kept, deferred } = capCandidatesToCeiling(all, ceiling);
  return {
    candidates: kept,
    deferredCount: deferred.length,
    deferredIds: deferredCandidateLabels(deferred, removedExportsLabel),
  };
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(?:\d+)(?:,\d+)? @@/;
const DEFAULT_PREFIX = 'default (';
const BULK_PREFIX = "* (all re-exports of '";

/** The bare identifier to search a hunk's removed lines for, or undefined for a
 * default/bulk export (no stable declaration text a plain search can re-find). */
function bareSymbolName(symbol: string): string | undefined {
  if (symbol.startsWith(DEFAULT_PREFIX) || symbol.startsWith(BULK_PREFIX)) return undefined;
  return symbol;
}

function wordBoundaryRe(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`);
}

/**
 * Find the diff hunk whose REMOVED (`-`) lines mention `symbol` — the hunk
 * that actually deleted this export's declaration. `RemovedExport` carries no
 * line number (only `symbol` + `file` — see module doc), so this re-derives
 * the hunk from the diff text by content match rather than widening that
 * shared shape for a presentation-only need. Returns undefined when no hunk's
 * removed lines mention the symbol (default/bulk exports, or an exotic shape
 * a plain search can't re-find).
 */
function findRemovalHunk(patch: string | undefined, symbol: string): string | undefined {
  const bareName = bareSymbolName(symbol);
  if (!patch || !bareName) return undefined;
  const re = wordBoundaryRe(bareName);

  let hunkLines: string[] = [];
  let matched = false;
  const flush = (): string | undefined => (matched ? hunkLines.join('\n') : undefined);

  for (const raw of patch.split('\n')) {
    if (HUNK_HEADER_RE.test(raw)) {
      const prior = flush();
      if (prior) return prior;
      hunkLines = [raw];
      matched = false;
      continue;
    }
    if (hunkLines.length === 0) continue; // before the first hunk
    hunkLines.push(raw);
    if (raw.startsWith('-') && re.test(raw)) matched = true;
  }
  return flush();
}

/** Render one candidate's evidence block: removal hunk, surviving references, changeset. */
function renderCandidate(id: string, c: RemovedExportContext, patch: string | undefined): string {
  const lines: string[] = [`<candidate id="${id}" symbol=${JSON.stringify(c.symbol)}>`];
  lines.push(`Removed from: ${c.file}`);
  const hunk = findRemovalHunk(patch, c.symbol);
  if (hunk) {
    lines.push('```diff');
    lines.push(hunk);
    lines.push('```');
  }
  lines.push('Surviving reference(s):');
  if (c.survivingReferences.length === 0) {
    lines.push('  - none found in the head corpus');
  } else {
    for (const r of c.survivingReferences) lines.push(`  - ${r.file}:${r.line}`);
  }
  lines.push(
    c.changesetFile
      ? `Changeset: described in ${c.changesetFile}`
      : 'Changeset: none found mentioning this symbol',
  );
  lines.push('</candidate>');
  return lines.join('\n');
}

/**
 * Build the worklist. Uses the SAME `<removed_exports>` tag name the shared
 * `STRUCTURAL_ANALYSIS.prompt` text (in `rules.ts`, active in the MAIN pass)
 * already instructs the model to look for — the exact "prompt promises a
 * signal it doesn't inject" mismatch class ADR-014's design work called out
 * for the rename-sweep/doc-truth precedent. Safe to reuse across the main
 * pass and this pass: they are separate, non-overlapping LLM calls.
 */
function renderWorklist(context: ReviewContext, candidates: RemovedExportContext[]): string {
  const patches = context.pr?.patches;
  const ids = candidateIds(candidates);
  const lines: string[] = ['<removed_exports>'];
  lines.push(
    'One verdict is REQUIRED per candidate id below (see <output_format>) — ' +
      `${ids.join(', ')}. Each candidate is a public export this PR REMOVES, with any ` +
      'surviving cross-file reference(s) and changeset mention already computed for you.',
  );
  candidates.forEach((c, i) => {
    lines.push('');
    lines.push(renderCandidate(ids[i], c, patches?.get(c.file)));
  });
  lines.push('</removed_exports>');
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
      "verdict": "breaking | intentional | internal-only | unverifiable",
      "filepath": "relative/path.ts",
      "line": 42,
      "symbolName": "removedSymbolName",
      "severity": "error | warning",
      "category": "breaking_change",
      "message": "REQUIRED for every verdict. When breaking: 1-2 sentences naming the removed export and the surviving caller(s) that will break. When intentional/internal-only/unverifiable: 1 sentence saying why.",
      "suggestion": "The fix (breaking only) — restore the export, or update the surviving caller(s).",
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
message — even for intentional/internal-only/unverifiable verdicts (fill filepath
from the candidate's removal file, line from its first surviving reference or 1 if
none, severity "warning", category any short slug e.g. "breaking_change", message
explaining the disposition). A missing category silently drops the ENTIRE entry,
same as a missing candidateId — both make this pass's result incomplete. ALWAYS set
symbolName to the candidate's removed symbol on a breaking verdict — this pass's
dedupe against the main pass's own structural-analysis findings matches on symbol
identity, not just location.
</output_format>`;
}

function buildSystemPrompt(ids: string[]): string {
  return `${REMOVED_EXPORTS_INTRO}

${REMOVED_EXPORTS_TOOLS_SECTION}

<strategy>
${REMOVED_EXPORTS_STRATEGY}
</strategy>

${VERDICT_GUIDANCE}

<examples>
${REMOVED_EXPORTS_EXAMPLE}
</examples>

${buildOutputFormat(ids)}`;
}

/** Build the candidate-loop's initial message: PR header + worklist + a closing nudge. `budget`
 *  drives rank-and-cap overflow handling (see `computeRemovedExportsWorklist`) — defaults to
 *  unlimited so existing callers that don't pass one are unaffected. */
export function buildRemovedExportsPassInitialMessage(
  context: ReviewContext,
  budget = Number.POSITIVE_INFINITY,
): string {
  const { candidates, deferredCount } = computeRemovedExportsWorklist(context, budget);
  const sections: string[] = [];
  const header = renderPassPrHeader(context);
  if (header) sections.push(header);
  sections.push(renderWorklist(context, candidates));
  const deferralNote = renderDeferralNote(deferredCount);
  if (deferralNote) sections.push(deferralNote);
  sections.push('Judge every candidate above and output your verdicts as JSON.');
  return sections.join('\n\n');
}

/** The system + initial prompts for the removed-exports candidate loop. `budget` is this pass's
 *  own final allocated budget (see `ReviewPassSpec.buildPrompts`'s doc comment) — defaults to
 *  unlimited so existing callers unaware of overflow handling are byte-identical to before. */
export function buildRemovedExportsPassPrompts(
  context: ReviewContext,
  budget = Number.POSITIVE_INFINITY,
): {
  systemPrompt: string;
  initialMessage: string;
} {
  const { candidates } = computeRemovedExportsWorklist(context, budget);
  const ids = candidateIds(candidates);
  return {
    systemPrompt: buildSystemPrompt(ids),
    initialMessage: buildRemovedExportsPassInitialMessage(context, budget),
  };
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

/**
 * Budget scaled by this pass's own candidate count, clamped floor/ceiling —
 * mirrors the pilot's `staleDuplicatePassBudget` formula shape. The floor is
 * `EXTRA_PASS_MIN_BUDGET_TOKENS` (shared across all four extra passes — see
 * that constant's doc comment / PR #811): a 1-2 candidate run (the common
 * real-PR case) gets the same one-real-round-trip floor every other pass
 * gets, while the scaling term still exists so a future cap increase scales
 * up past the floor rather than needing a second formula change.
 */
export function removedExportsPassBudget(_baseBudget: number, context: ReviewContext): number {
  const candidateCount = computeRemovedExportsCandidates(context).length;
  const scaled =
    REMOVED_EXPORTS_BASE_OVERHEAD_TOKENS +
    REMOVED_EXPORTS_PER_CANDIDATE_TOKENS * Math.min(candidateCount, MAX_CANDIDATES);
  return Math.min(Math.max(scaled, EXTRA_PASS_MIN_BUDGET_TOKENS), REMOVED_EXPORTS_MAX_BUDGET);
}

// ---------------------------------------------------------------------------
// Post-processing (verdict reduction + honest completeness)
// ---------------------------------------------------------------------------

/** A verdict value the loop's output contract recognizes. */
type Verdict = 'breaking' | 'intentional' | 'internal-only' | 'unverifiable';
const VALID_VERDICTS: ReadonlySet<string> = new Set<Verdict>([
  'breaking',
  'intentional',
  'internal-only',
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
 * unknown candidateId or an unrecognized verdict. Same contract as the two
 * siblings' `hasCompleteVerdictCoverage` (see either module's doc for why
 * candidateId-presence alone isn't enough): "one recognized verdict per
 * expected id", not merely "every id mentioned somewhere". This is a third
 * copy of the same ~15-line shape rather than an extraction into a shared
 * helper — deliberate: doing so would mean touching both sibling files
 * (out of scope for this pass, and outside this session's collision-
 * minimization brief), not a missed DRY opportunity.
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
 * (`verdict === 'breaking'` AND `candidateId` names a real worklist entry
 * only, cleaned of the loop-only fields), and mark the result honestly
 * incomplete when the verdict array doesn't cleanly cover the worklist —
 * same honesty contract as both siblings. The candidateId check guards
 * against the same hallucinated-id loophole a code reviewer caught in PR
 * #804: a phantom candidate id must not leak through as a real finding just
 * because it carries `verdict: 'breaking'`. When the underlying client
 * result was ALREADY incomplete for a real reason (budget/max_turns/error),
 * that reason is kept as-is; `incomplete_verdict` is only used when the
 * model otherwise returned a syntactically complete verdict.
 *
 * Coverage is checked against the RANK-AND-CAPPED worklist (from
 * `computeRemovedExportsWorklist(context, budget)`), not the full pre-cap
 * candidate set — a deferred candidate was never listed, so it is correctly
 * exempt from the honesty contract (candidate-overflow handling's point 3:
 * deferral is not incompleteness). `budget` must be the SAME value
 * `buildRemovedExportsPassPrompts` used — `review-pass.ts`'s `runReviewPass`
 * guarantees this by threading one computed budget through both calls.
 */
export function postProcessRemovedExportsResult(
  result: AgentResult,
  context: ReviewContext,
  budget = Number.POSITIVE_INFINITY,
): AgentResult {
  const { candidates, deferredCount, deferredIds } = computeRemovedExportsWorklist(context, budget);
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
          f.verdict === 'breaking' &&
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

/**
 * Two findings are the "same export collision" when they're in the same file
 * AND either within `DEDUPE_LINE_PROXIMITY` lines OR share a non-empty
 * `symbolName` — the stable removed-symbol identity this loop's candidates
 * carry (see module doc's "Dedupe" section for why this loop adds identity
 * matching on top of the siblings' proximity-only check).
 */
function sameExportCollision(a: AgentFinding, b: AgentFinding): boolean {
  if (a.filepath !== b.filepath) return false;
  if (Math.abs(a.line - b.line) <= DEDUPE_LINE_PROXIMITY) return true;
  return !!a.symbolName && !!b.symbolName && a.symbolName === b.symbolName;
}

/**
 * Fold the loop's findings (already reduced to `verdict === 'breaking'` only)
 * into the main pass's. The LOOP finding wins on a same-export collision —
 * same "loop wins" direction as both siblings — scoped to main-pass findings
 * whose OWN `ruleId` is also `structural-analysis`, never an unrelated
 * rule's finding that merely lands nearby. Returns a new array; inputs are
 * not mutated.
 */
export function mergeRemovedExportsFindings(
  mainFindings: AgentFinding[],
  loopFindings: AgentFinding[],
): AgentFinding[] {
  const forced = loopFindings.map(f => ({ ...f, ruleId: STRUCTURAL_ANALYSIS_RULE_ID }));
  const survivingMain = mainFindings.filter(
    mf =>
      mf.ruleId !== STRUCTURAL_ANALYSIS_RULE_ID || !forced.some(lf => sameExportCollision(mf, lf)),
  );
  return [...survivingMain, ...forced];
}

/**
 * Fold the loop's result-level state into the main pass's — only
 * incomplete/stopReason propagate, naming this pass via the generic
 * `incompleteFromPass` (see types.ts), same as both siblings.
 */
export function mergeRemovedExportsResultState(
  main: AgentResult,
  passResult: AgentResult | null,
): AgentResult {
  if (!passResult) return main;
  if (passResult.incomplete && !main.incomplete) {
    main.incomplete = true;
    main.stopReason = passResult.stopReason;
    main.incompleteFromPass = 'removed-exports';
  }
  return main;
}

// ---------------------------------------------------------------------------
// ReviewPassSpec (plugs the loop into the generalized executor)
// ---------------------------------------------------------------------------

/**
 * Removed-exports candidate loop bundled as a `ReviewPassSpec` (see
 * `review-pass.ts`). Every field here is one of this module's own pure
 * functions; the generic executor supplies the gate-check/run/
 * failure-isolation/reporting plumbing.
 */
export const REMOVED_EXPORTS_PASS_SPEC: ReviewPassSpec = {
  name: 'removed-exports-loop',
  skipPlugin: REMOVED_EXPORTS_SKIP_PLUGIN,
  gateReason: removedExportsSkipReason,
  buildPrompts: buildRemovedExportsPassPrompts,
  budget: removedExportsPassBudget,
  maxTurns: REMOVED_EXPORTS_PASS_MAX_TURNS,
  mergeFindings: mergeRemovedExportsFindings,
  mergeResultState: mergeRemovedExportsResultState,
  postProcessResult: postProcessRemovedExportsResult,
};
