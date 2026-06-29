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

export type LiteralKind = 'string' | 'number';

/** A literal the diff moved away from (net-removed within a file's patch). */
export interface ChangedLiteral {
  /** Inner text for strings (no quotes); the numeric token for numbers. */
  value: string;
  kind: LiteralKind;
  /** Display form: quoted for strings, raw for numbers. */
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
/** Decimals (0.74, 3.5) or integers with >= 3 digits (100, 4096). Skips small ints / indices. */
const NUMBER_RE = /(?<![\w.])(\d[\d_]*\.\d+|\d{3,})(?![\w.])/g;
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

/** Extract distinctive string + numeric literals from one line of code. */
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

  for (const m of text.matchAll(NUMBER_RE)) {
    const value = m[1];
    out.push({ key: `n:${value}`, value, kind: 'number', display: value });
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

/**
 * Walk one file's unified-diff patch, tracking the new-file line number, and
 * collect every distinctive literal that appears on a `+` or `-` line (the
 * literals the diff touches — whether removed outright or conditionalized in
 * place). Keyed so each literal is recorded once, at its first touched line.
 */
function scanPatch(file: string, patch: string): Map<string, ChangedLiteral> {
  const touched = new Map<string, ChangedLiteral>();
  let newLine = 0;

  for (const raw of patch.split('\n')) {
    const header = raw.match(HUNK_HEADER_RE);
    if (header) {
      newLine = parseInt(header[1], 10);
      continue;
    }
    if (raw.startsWith('+++') || raw.startsWith('---')) continue;

    if (raw.startsWith('+')) {
      recordLiterals(touched, raw.slice(1), file, newLine);
      newLine++;
    } else if (raw.startsWith('-')) {
      recordLiterals(touched, raw.slice(1), file, newLine);
      // a removed line does not advance the new-file counter
    } else {
      newLine++; // context line
    }
  }

  return touched;
}

/**
 * Collect every distinctive literal each changed file's diff touches.
 * Exposed for testing.
 */
export function extractChangedLiterals(patches: Map<string, string>): ChangedLiteral[] {
  const result: ChangedLiteral[] = [];
  for (const [file, patch] of patches) {
    result.push(...scanPatch(file, patch).values());
  }
  return result;
}

// ---------------------------------------------------------------------------
// Surviving-occurrence scan
// ---------------------------------------------------------------------------

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Does `line` contain the literal `lit` as a real token (not a substring of a larger word)? */
function lineContainsLiteral(line: string, lit: ChangedLiteral): boolean {
  if (lit.kind === 'string') {
    // Match the exact string literal in any quote style.
    return (
      line.includes(`'${lit.value}'`) ||
      line.includes(`"${lit.value}"`) ||
      line.includes(`\`${lit.value}\``)
    );
  }
  // number: bounded so 100 doesn't match 1000 or foo100
  return new RegExp(`(?<![\\w.])${escapeRegExp(lit.value)}(?![\\w.])`).test(line);
}

function classifySnippet(line: string): { snippet: string; isComment: boolean } {
  const trimmed = line.trim();
  return {
    snippet: trimmed.slice(0, MAX_SNIPPET_CHARS),
    isComment: COMMENT_RE.test(trimmed),
  };
}

/**
 * Scan the indexed repo (post-image chunk content) for the literal surviving
 * outside the diff. Because chunks are the head state, the changed site no
 * longer contains the moved-away literal — any hit is by definition a survivor.
 * `changedLines` is consulted defensively to never re-report a touched line.
 */
function findStaleSites(
  lit: ChangedLiteral,
  repoChunks: CodeChunk[],
  changedLines: Map<string, Set<number>>,
): StaleSite[] {
  const seen = new Set<string>();
  const sites: StaleSite[] = [];

  for (const chunk of repoChunks) {
    const file = chunk.metadata.file;
    const fileChanged = changedLines.get(file);
    const lines = chunk.content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const absLine = chunk.metadata.startLine + i;
      const dedupKey = `${file}:${absLine}`;
      if (seen.has(dedupKey)) continue;
      if (fileChanged?.has(absLine)) continue; // a line this PR touched — not a survivor
      if (file === lit.file && absLine === lit.changedLine) continue; // the touched site itself
      if (!lineContainsLiteral(lines[i], lit)) continue;

      seen.add(dedupKey);
      const { snippet, isComment } = classifySnippet(lines[i]);
      sites.push({
        file,
        line: absLine,
        snippet,
        isComment,
        isTest: TEST_PATH_RE.test(file),
      });
      if (sites.length >= MAX_SITES_PER_LITERAL) return sites;
    }
  }

  return sites;
}

function scoreConfidence(
  kind: LiteralKind,
  sites: StaleSite[],
): StaleLiteralCandidate['confidence'] {
  const realCode = sites.filter(s => !s.isComment && !s.isTest);
  if (realCode.length === 0) return 'low';
  const valueEmitting = realCode.some(s => VALUE_EMITTING_RE.test(s.snippet));
  if (kind === 'number') return valueEmitting ? 'medium' : 'low';
  return valueEmitting ? 'high' : 'medium';
}

const CONFIDENCE_RANK: Record<StaleLiteralCandidate['confidence'], number> = {
  high: 2,
  medium: 1,
  low: 0,
};

/**
 * Pre-compute stale-duplicate literal candidates from the review context.
 * Returns [] when there is no diff or no full-repo index to scan against.
 */
export function computeStaleLiteralCandidates(context: ReviewContext): StaleLiteralCandidate[] {
  const patches = context.pr?.patches;
  const repoChunks = context.repoChunks;
  if (!patches || patches.size === 0) return [];
  if (!repoChunks || repoChunks.length === 0) return [];

  const changedLines = context.pr?.diffLines ?? new Map<string, Set<number>>();
  const candidates: StaleLiteralCandidate[] = [];

  for (const lit of extractChangedLiterals(patches)) {
    const staleSites = findStaleSites(lit, repoChunks, changedLines);
    if (staleSites.length === 0) continue;
    candidates.push({
      literal: lit.display,
      kind: lit.kind,
      changedSite: { file: lit.file, line: lit.changedLine },
      staleSites,
      confidence: scoreConfidence(lit.kind, staleSites),
    });
  }

  candidates.sort((a, b) => {
    const byConf = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
    if (byConf !== 0) return byConf;
    return b.staleSites.length - a.staleSites.length;
  });

  return candidates.slice(0, MAX_CANDIDATES);
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
      `- ${c.literal} (${c.kind}) — changed at ${c.changedSite.file}:${c.changedSite.line}; ` +
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
