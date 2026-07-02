/**
 * Deterministic "stale duplicate literal" signal for PR reviews.
 *
 * The stale-duplicate rule asks the agent to grep for literals the diff changed
 * in one place but left hardcoded elsewhere. That grep-and-reason step is the
 * flaky, model-dependent part — and in the offline harness the agent's
 * grep/read tools are blind (they read a capture-time temp dir that no longer
 * exists), so the rule can never find the surviving copy.
 *
 * This module pre-computes the structural fact instead, mirroring the
 * `<blast_radius>` / `<deleted_exports>` precedents: collect every distinctive
 * literal the diff TOUCHES (on a `+` or `-` line — this covers both a literal
 * the PR removed and one it conditionalized in place), then scan the indexed
 * repo's post-image chunk content for the SAME literal surviving unchanged
 * OUTSIDE the diff. The result is injected as a
 * `<stale_literal_candidates>` block so the agent confirms a handed-to-it
 * candidate (narrow judgement) rather than discovering it via blind grep.
 *
 * It injects FACTS (literal + locations + a short snippet), never reconstructed
 * chunk content — a blunt content dump was tried and regressed unrelated rules.
 */

import type { CodeChunk } from '@liendev/parser';
import type { ReviewContext } from './plugin-types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Only string literals carry cross-file identity (a model name, flag key, schema
// field, copied message). Numbers were tried and dropped — a bare `0.5` or `2.5`
// matches CSS classes, test values, and unrelated ratios with no shared meaning.
export type LiteralKind = 'string';

/** A distinctive string literal the diff touches (on a `+` or `-` line). */
export interface ChangedLiteral {
  /** Inner text of the string literal, without surrounding quotes. */
  value: string;
  kind: LiteralKind;
  /** Display form: the literal re-quoted, e.g. `'claude-sonnet-4-6'`. */
  display: string;
  /** File whose diff removed/changed this literal. */
  file: string;
  /** Best-effort new-file line near where the change occurred. */
  changedLine: number;
}

/** A surviving occurrence of a changed literal, outside the diff. */
export interface StaleSite {
  file: string;
  line: number;
  snippet: string;
  isComment: boolean;
  isTest: boolean;
}

export interface StaleLiteralCandidate {
  /** Display form of the literal (quoted for strings). */
  literal: string;
  kind: LiteralKind;
  changedSite: { file: string; line: number };
  staleSites: StaleSite[];
  confidence: 'low' | 'medium' | 'high';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max literals reported, highest-confidence first — keeps the prompt compact. */
const MAX_CANDIDATES = 8;
/** Max surviving sites listed per literal. */
const MAX_SITES_PER_LITERAL = 5;
/** Snippet length cap per site. */
const MAX_SNIPPET_CHARS = 160;

/**
 * String literals too common to be a useful stale-duplicate signal. Anything
 * shorter than 3 chars or all-punctuation is also dropped (see isDistinctiveString).
 */
const LOW_SIGNAL_STRINGS = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'string',
  'number',
  'boolean',
  'object',
  'function',
]);

const STRING_RE = /(['"`])((?:\\.|(?!\1).)*?)\1/g;
const COMMENT_RE = /^(\/\/|\/\*|\*|#|--|<!--)/;
const TEST_PATH_RE = /(\.test\.|\.spec\.|\/tests?\/|__tests__|\/spec\/)/;
const VALUE_EMITTING_RE = /[=:]|=>|\breturn\b/;

// ---------------------------------------------------------------------------
// Literal extraction
// ---------------------------------------------------------------------------

interface RawLiteral {
  key: string;
  value: string;
  kind: LiteralKind;
  display: string;
}

function isDistinctiveString(inner: string): boolean {
  const t = inner.trim();
  if (t.length < 3) return false;
  if (LOW_SIGNAL_STRINGS.has(t.toLowerCase())) return false;
  if (!/[A-Za-z0-9]/.test(t)) return false; // must carry at least one alphanumeric
  // Bias toward configuration-like literals (model/version names, env keys,
  // paths, kebab/snake identifiers, copied messages) and away from common short
  // words that legitimately recur everywhere ('type', 'name', 'user').
  return /[-_./:]/.test(t) || /\d/.test(t) || t.length >= 6;
}

/** Extract distinctive string literals from one line of code. */
function extractLiteralsFromText(text: string): RawLiteral[] {
  const out: RawLiteral[] = [];

  for (const m of text.matchAll(STRING_RE)) {
    const quote = m[1];
    const inner = m[2];
    // Template literals with interpolation aren't stable literals — skip.
    if (quote === '`' && inner.includes('${')) continue;
    if (!isDistinctiveString(inner)) continue;
    out.push({
      key: `s:${inner}`,
      value: inner,
      kind: 'string',
      display: `${quote}${inner}${quote}`,
    });
  }

  return out;
}

const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function recordLiterals(
  touched: Map<string, ChangedLiteral>,
  text: string,
  file: string,
  line: number,
): void {
  for (const lit of extractLiteralsFromText(text)) {
    if (!touched.has(lit.key)) {
      touched.set(lit.key, {
        value: lit.value,
        kind: lit.kind,
        display: lit.display,
        file,
        changedLine: line,
      });
    }
  }
}

interface PatchScan {
  literals: ChangedLiteral[];
  /** New-file line numbers the diff added/changed, per file (the `+` lines). */
  touchedLinesByFile: Map<string, Set<number>>;
}

/**
 * Walk every file's unified-diff patch, tracking the new-file line number, and
 * collect (a) every distinctive literal that appears on a `+` or `-` line (the
 * literals the diff touches — whether removed outright or conditionalized in
 * place) and (b) the set of new-file lines the diff changed. The latter lets
 * the survivor scan exclude the touched site itself even when `pr.diffLines`
 * isn't provided — without it a literal conditionalized in place would report
 * its own `+` line as a stale survivor.
 */
function scanPatches(patches: Map<string, string>): PatchScan {
  const literals: ChangedLiteral[] = [];
  const touchedLinesByFile = new Map<string, Set<number>>();

  for (const [file, patch] of patches) {
    const touched = new Map<string, ChangedLiteral>();
    const touchedLines = new Set<number>();
    let newLine = 0;

    for (const raw of patch.split('\n')) {
      const header = raw.match(HUNK_HEADER_RE);
      if (header) {
        newLine = parseInt(header[1], 10);
        continue;
      }
      if (raw.startsWith('+++') || raw.startsWith('---')) continue;
      if (raw.startsWith('\\')) continue; // "\ No newline at end of file" — not a content line

      if (raw.startsWith('+')) {
        touchedLines.add(newLine);
        recordLiterals(touched, raw.slice(1), file, newLine);
        newLine++;
      } else if (raw.startsWith('-')) {
        recordLiterals(touched, raw.slice(1), file, newLine);
        // a removed line does not advance the new-file counter
      } else {
        newLine++; // context line
      }
    }

    literals.push(...touched.values());
    touchedLinesByFile.set(file, touchedLines);
  }

  return { literals, touchedLinesByFile };
}

/**
 * Collect every distinctive literal each changed file's diff touches.
 * Exposed for testing.
 */
export function extractChangedLiterals(patches: Map<string, string>): ChangedLiteral[] {
  return scanPatches(patches).literals;
}

// ---------------------------------------------------------------------------
// Surviving-occurrence scan
// ---------------------------------------------------------------------------

/**
 * Wall-clock backstop for the repo-wide survivor scan, mirroring
 * grep_codebase's GREP_TIME_BUDGET_MS (agent-tools.ts). A pathological input
 * (a huge indexed repo, or a diff that touches an unusually large number of
 * distinct literals) could otherwise scan for a long time on every PR — this
 * rule triggers unconditionally, before the LLM even runs. On budget hit we
 * return whatever was found so far rather than stalling the review.
 */
const STALE_LITERAL_TIME_BUDGET_MS = 5_000;

function classifySnippet(line: string): { snippet: string; isComment: boolean } {
  const trimmed = line.trim();
  return {
    snippet: trimmed.slice(0, MAX_SNIPPET_CHARS),
    isComment: COMMENT_RE.test(trimmed),
  };
}

/**
 * Extract the distinct quoted-string token values present on one repo line
 * (any quote style, no distinctiveness filtering — the caller already knows
 * which values are worth looking for). Returns null when the line has no
 * quote character at all, so the common case (most lines) skips the regex
 * entirely.
 *
 * Note: this parses proper quote-delimited tokens, so a value nested inside a
 * *differently*-quoted outer string (e.g. a backtick template that itself
 * contains a single-quoted copy of the literal) is not found as a separate
 * token — unlike a raw substring search. That combination hasn't shown up in
 * practice; if it ever matters, matching would need a substring/automaton
 * scan instead of tokenization.
 */
function extractQuotedValues(line: string): Set<string> | null {
  if (!/['"`]/.test(line)) return null;
  const values = new Set<string>();
  for (const m of line.matchAll(STRING_RE)) values.add(m[2]);
  return values.size > 0 ? values : null;
}

interface RepoScanResult {
  /** literal value -> its surviving sites, capped at MAX_SITES_PER_LITERAL, in traversal order. */
  sitesByLiteral: Map<string, StaleSite[]>;
  timedOut: boolean;
  chunksScanned: number;
}

/**
 * Record every touched-literal survivor found on one repo line into
 * `sitesByLiteral`, respecting each literal's own MAX_SITES_PER_LITERAL cap.
 * Split out of {@link scanRepoForStaleSites} so the triple-nested scan (chunks
 * x lines x values-on-a-line) reads as two single-purpose passes instead of
 * one deeply nested one.
 */
function recordSurvivorsForLine(
  line: string,
  absLine: number,
  file: string,
  isTest: boolean,
  touchedValues: Set<string>,
  sitesByLiteral: Map<string, StaleSite[]>,
): void {
  const values = extractQuotedValues(line);
  if (!values) return;

  let classified: { snippet: string; isComment: boolean } | undefined;
  for (const value of values) {
    if (!touchedValues.has(value)) continue;
    const sites = sitesByLiteral.get(value);
    if (sites && sites.length >= MAX_SITES_PER_LITERAL) continue; // this literal is already capped

    classified ??= classifySnippet(line);
    const site: StaleSite = { file, line: absLine, ...classified, isTest };
    if (sites) sites.push(site);
    else sitesByLiteral.set(value, [site]);
  }
}

/**
 * Scan the indexed repo (post-image chunk content) ONCE for every touched
 * literal at once, building `literal value -> surviving sites` directly.
 * Because chunks are the head state, the changed site no longer contains the
 * moved-away literal — any hit is by definition a survivor. `changedLines` is
 * consulted defensively to never re-report a touched line.
 *
 * This replaces a previous per-literal scan (call this once per touched
 * literal, re-walking every repo line each time), which made the cost
 * O(literals x repo-lines) — unconditional on every PR, with the common
 * zero-match case paying full cost. A single pass makes it
 * O(repo-lines + literals).
 */
function scanRepoForStaleSites(
  repoChunks: CodeChunk[],
  touchedValues: Set<string>,
  changedLines: Map<string, Set<number>>,
  deadline: number,
): RepoScanResult {
  const sitesByLiteral = new Map<string, StaleSite[]>();
  let timedOut = false;
  let chunksScanned = 0;

  chunkLoop: for (const chunk of repoChunks) {
    chunksScanned++;
    const file = chunk.metadata.file;
    const fileChanged = changedLines.get(file);
    const isTest = TEST_PATH_RE.test(file);
    const lines = chunk.content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (Date.now() > deadline) {
        timedOut = true;
        break chunkLoop;
      }

      const absLine = chunk.metadata.startLine + i;
      if (fileChanged?.has(absLine)) continue; // a line this PR touched — not a survivor

      recordSurvivorsForLine(lines[i], absLine, file, isTest, touchedValues, sitesByLiteral);
    }
  }

  return { sitesByLiteral, timedOut, chunksScanned };
}

function scoreConfidence(sites: StaleSite[]): StaleLiteralCandidate['confidence'] {
  const realCode = sites.filter(s => !s.isComment && !s.isTest);
  if (realCode.length === 0) return 'low'; // only comments/tests survive — weak signal
  return realCode.some(s => VALUE_EMITTING_RE.test(s.snippet)) ? 'high' : 'medium';
}

const CONFIDENCE_RANK: Record<StaleLiteralCandidate['confidence'], number> = {
  high: 2,
  medium: 1,
  low: 0,
};

/** Merge the patch-derived touched lines with any caller-provided diffLines. */
function mergeChangedLines(
  touchedLinesByFile: Map<string, Set<number>>,
  provided: Map<string, Set<number>> | undefined,
): Map<string, Set<number>> {
  const merged = new Map<string, Set<number>>();
  for (const [file, set] of touchedLinesByFile) merged.set(file, new Set(set));
  if (provided) {
    for (const [file, set] of provided) {
      const existing = merged.get(file) ?? new Set<number>();
      for (const n of set) existing.add(n);
      merged.set(file, existing);
    }
  }
  return merged;
}

/**
 * Pre-compute stale-duplicate literal candidates from the review context.
 * Returns [] when there is no diff or no full-repo index to scan against.
 */
export function computeStaleLiteralCandidates(context: ReviewContext): StaleLiteralCandidate[] {
  return computeStaleLiteralCandidatesWithDeadline(
    context,
    Date.now() + STALE_LITERAL_TIME_BUDGET_MS,
  );
}

/**
 * Turn scan results into the final ranked, capped candidate list: attach each
 * touched literal to its surviving sites (dropping literals with none), score
 * confidence, then sort highest-confidence-and-most-sites first.
 */
function buildRankedCandidates(
  literals: ChangedLiteral[],
  sitesByLiteral: Map<string, StaleSite[]>,
): StaleLiteralCandidate[] {
  const candidates: StaleLiteralCandidate[] = [];
  for (const lit of literals) {
    const staleSites = sitesByLiteral.get(lit.value);
    if (!staleSites || staleSites.length === 0) continue;
    candidates.push({
      literal: lit.display,
      kind: lit.kind,
      changedSite: { file: lit.file, line: lit.changedLine },
      staleSites,
      confidence: scoreConfidence(staleSites),
    });
  }

  candidates.sort((a, b) => {
    const byConf = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
    if (byConf !== 0) return byConf;
    return b.staleSites.length - a.staleSites.length;
  });

  return candidates.slice(0, MAX_CANDIDATES);
}

/** Log the budget-exceeded diagnostic: elapsed time, scan coverage, and touched-literal count. */
function logScanTimeout(
  context: ReviewContext,
  elapsedMs: number,
  chunksScanned: number,
  totalChunks: number,
  touchedCount: number,
): void {
  context.logger?.warning(
    `stale-literal-signals: repo scan exceeded its budget (${elapsedMs}ms elapsed) ` +
      `after ${chunksScanned}/${totalChunks} chunks for ${touchedCount} touched ` +
      'literal(s); returning partial results.',
  );
}

/**
 * Same as {@link computeStaleLiteralCandidates}, but with an explicit
 * absolute deadline (a value comparable to `Date.now()`) instead of the
 * default budget. Exposed for testing the budget-exceeded path
 * deterministically — pass an already-past deadline — without relying on
 * real elapsed time.
 */
export function computeStaleLiteralCandidatesWithDeadline(
  context: ReviewContext,
  deadline: number,
): StaleLiteralCandidate[] {
  const startedAt = Date.now();
  const patches = context.pr?.patches;
  const repoChunks = context.repoChunks;
  if (!patches || patches.size === 0) return [];
  if (!repoChunks || repoChunks.length === 0) return [];

  const { literals, touchedLinesByFile } = scanPatches(patches);
  if (literals.length === 0) return [];

  // Exclude the diff's own touched lines so a literal conditionalized in place
  // doesn't report its own `+` line as a survivor. Derived from the patch, so
  // this holds even when pr.diffLines is absent; union the two when both exist.
  const changedLines = mergeChangedLines(touchedLinesByFile, context.pr?.diffLines);
  const touchedValues = new Set(literals.map(lit => lit.value));

  const { sitesByLiteral, timedOut, chunksScanned } = scanRepoForStaleSites(
    repoChunks,
    touchedValues,
    changedLines,
    deadline,
  );

  if (timedOut) {
    logScanTimeout(
      context,
      Date.now() - startedAt,
      chunksScanned,
      repoChunks.length,
      touchedValues.size,
    );
  }

  return buildRankedCandidates(literals, sitesByLiteral);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Render stale-literal candidates as a `<stale_literal_candidates>` block for
 * the agent's initial message. Returns '' when there are no candidates so
 * callers can append unconditionally.
 */
export function renderStaleLiteralCandidates(candidates: StaleLiteralCandidate[]): string {
  if (candidates.length === 0) return '';

  const lines: string[] = [];
  lines.push('<stale_literal_candidates>');
  lines.push(
    'Pre-computed by a deterministic scan of the indexed repo (no grep needed — this is done for you). ' +
      'Each entry is a literal this PR changed in one place but that STILL appears unchanged elsewhere. ' +
      'For each, judge whether the surviving site should track the changed site: if yes, emit a ' +
      'stale-duplicate finding citing BOTH locations; if it is unrelated (different meaning, a comment, ' +
      'or a test fixture), stay silent. Confidence is a hint, not a verdict.',
  );

  for (const c of candidates) {
    lines.push('');
    lines.push(
      `- ${c.literal} — changed at ${c.changedSite.file}:${c.changedSite.line}; ` +
        `still present at [confidence: ${c.confidence}]:`,
    );
    for (const s of c.staleSites) {
      const tags = [s.isComment ? 'comment' : null, s.isTest ? 'test' : null]
        .filter(Boolean)
        .join(', ');
      const suffix = tags ? ` (${tags})` : '';
      lines.push(`    - ${s.file}:${s.line}${suffix}  \`${s.snippet}\``);
    }
  }

  lines.push('</stale_literal_candidates>');
  return lines.join('\n');
}

/**
 * Emitted when the deterministic scan ran but found nothing. Distinguishes
 * "scan completed, clean" from "scan never ran" — without it, an omitted block
 * is ambiguous and the rule would force a redundant grep fallback even after a
 * clean scan.
 */
const STALE_LITERAL_NONE_BLOCK = `<stale_literal_candidates>
None — the deterministic scan found no changed literal surviving unchanged elsewhere. The stale-duplicate discovery step is complete; you do not need to grep for the diff's literals.
</stale_literal_candidates>`;

/**
 * Build the `<stale_literal_candidates>` section for the agent's initial
 * message. Returns the candidate block when there are candidates, an explicit
 * "None" block when the scan ran but was clean, or '' when no scan was possible
 * (no diff or no repo index — e.g. CLI mode). Callers append unconditionally.
 */
export function renderStaleLiteralSection(context: ReviewContext): string {
  const patches = context.pr?.patches;
  const repoChunks = context.repoChunks;
  const scanPossible = !!patches && patches.size > 0 && !!repoChunks && repoChunks.length > 0;
  if (!scanPossible) return '';

  const candidates = computeStaleLiteralCandidates(context);
  return candidates.length > 0
    ? renderStaleLiteralCandidates(candidates)
    : STALE_LITERAL_NONE_BLOCK;
}
