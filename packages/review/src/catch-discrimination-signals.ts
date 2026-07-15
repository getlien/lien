/**
 * Deterministic "undiscriminated catch" signal for PR reviews.
 *
 * Provenance: PR #752 (this repo) — `postPRReview`'s catch block salvaged
 * EVERY `createReview` error (auth, rate-limit, 5xx, network) the same way
 * it salvaged the one 422 anchor-validation failure the fallback was
 * designed for, silently degrading an infra outage into a success-shaped
 * `{posted: 0, dropped: <all>}` result instead of rethrowing. CodeRabbit
 * caught it same-SHA; Lien Review's `error-swallowing` rule did not (3-vote
 * baseline: 0/3 — see
 * `test/harness/fixtures/error-swallowing/pr752-undiscriminated-catch-salvage`).
 *
 * The rule asks the agent to notice, for each catch block, whether it
 * actually discriminates between error classes before choosing to degrade
 * instead of rethrow — a judgment call that's easy to skip when a catch's
 * *shape* (try/catch, some logging, a fallback call) reads as "handled" at
 * a glance. This module pre-computes the STRUCTURAL fact instead, mirroring
 * the `<stale_literal_candidates>` / `<removed_exports>` precedents: find
 * every catch clause the diff ADDS or MODIFIES, and flag it when:
 *   (a) its body never inspects the caught error's type/class/status (no
 *       `instanceof`, no `.status`/`.code`/`.name`/etc. on the caught
 *       binding);
 *   (b) it does not unconditionally rethrow — the last statement not
 *       nested inside a conditional block is not a `throw` (so at least one
 *       path degrades instead of propagating); and
 *   (c) it does something beyond pure logging — a call or a value-returning
 *       `return` (an actual fallback/degrade path, not just "log and let it
 *       fall through").
 * A catch clause with NO binding (`catch { ... }`) is never flagged: it
 * cannot discriminate by construction (there is no reference to check), and
 * it is also an extremely common, usually-correct idiom for a best-effort
 * probe ("any failure here means use the safe default") — the byte-diff
 * census run while building this module caught it over-firing on exactly
 * that shape in this repo's own `worktree.ts`/`overlay-backend.ts` before
 * this exclusion was added.
 *
 * The result is injected as an `<undiscriminated_catch_candidates>` block
 * so the agent confirms a handed-to-it candidate instead of re-reading
 * every catch body itself.
 *
 * v1 scope: TS/JS only, operating on the changed-file chunks the engine
 * already parses (`context.chunks`) — text/light-parsing (brace-depth
 * tracking to isolate a catch body, no full AST), consistent with this
 * file's siblings. Known limitations, kept honest rather than papered over:
 *  - Bindingless catches are never flagged (see above) — a true positive
 *    that happens to omit the binding (rare; nothing to check against
 *    anyway) is invisible to this scan by design.
 *  - "discrimination" is a shallow textual check on the bound identifier.
 *    A check performed via a helper function (`if (isRetryable(err))`) is
 *    invisible to this scan — it will still flag such a catch.
 *  - "rethrows" is approximated as "the last statement not nested in a
 *    block is a throw", not full control-flow/exhaustiveness analysis. A
 *    body that rethrows inside a non-trailing branch (rather than as a
 *    trailing statement) can still be flagged as a false positive.
 *  - Catches with no textual overlap with the diff's added/changed lines
 *    (i.e. untouched by this PR) are never considered, regardless of shape.
 *  - Catch-shaped text inside a comment or string literal is excluded via a
 *    masking pre-pass (see `maskNonCode`) — found over-firing on this
 *    repo's own `.assertions.ts` fixtures, whose docstrings quote code
 *    snippets like `catch { return false; }` as narrative prose.
 */

import type { CodeChunk } from '@liendev/parser';
import type { ReviewContext } from './plugin-types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A catch clause this PR added or modified that appears to degrade indiscriminately. */
export interface UndiscriminatedCatchCandidate {
  file: string;
  /** Line of the `catch` keyword. */
  line: number;
  /** Line of the catch block's closing brace. */
  endLine: number;
  /** The caught binding's identifier, or null for a bindingless `catch { }`. */
  binding: string | null;
  /** One-line explanation of why this catch was flagged. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max candidates reported — keeps the prompt compact. */
const MAX_CANDIDATES = 10;

/** Files whose diffs we parse (this repo's TS/JS surface — v1 scope). */
const TS_JS_FILE_RE = /\.(?:[cm]?[jt]sx?)$/;

const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Matches a `catch`, with an optional (possibly typed) binding, up to its opening `{`. */
const CATCH_RE = /\bcatch\s*(?:\(\s*([A-Za-z_$][\w$]*)\s*(?::\s*[^)]+)?\s*\))?\s*\{/g;

const GENERIC_DISCRIMINATION_RE = /\binstanceof\b/;
const BINDING_PROPERTY_SUFFIX = 'status|code|name|statusCode|errno|type';

/** A trailing, unconditional (not nested in any block) throw statement. */
const TRAILING_THROW_RE = /\bthrow\b[^;{}]*;\s*$/;

/** A `return` with a non-empty expression — "returns a value" per the design. */
const RETURN_WITH_VALUE_RE = /\breturn\s+[^\s;][^;]*;/;

const LOGGING_CALL_STATEMENT_RE =
  /\b(?:console|logger|log)\s*\.\s*(?:debug|info|warn|warning|error|trace|log)\s*\([^)]*\)\s*;?/gi;

/** JS/TS keywords that can precede `(` without being a function call. */
const CONTROL_KEYWORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'throw',
  'function',
  'typeof',
  'instanceof',
  'new',
  'do',
  'try',
  'yield',
  'await',
  'void',
  'delete',
  'in',
  'of',
]);

// ---------------------------------------------------------------------------
// Diff scanning — which new-file lines did this PR add/change?
// ---------------------------------------------------------------------------

/** Mutable new-file line cursor threaded through {@link applyPatchLine}. */
interface LineCursor {
  newLine: number;
}

/**
 * Apply one raw unified-diff line to the cursor/line-set: advance past hunk
 * headers and `+++`/`---`/no-newline markers, record `+` lines as touched,
 * and advance the new-file counter for `+` and context lines (`-` lines
 * don't advance it and are never "touched" in the new file). Split out of
 * {@link computeTouchedLines} so the per-file loop stays flat.
 */
function applyPatchLine(raw: string, cursor: LineCursor, lines: Set<number>): void {
  const header = raw.match(HUNK_HEADER_RE);
  if (header) {
    cursor.newLine = parseInt(header[1], 10);
    return;
  }
  if (raw.startsWith('+++') || raw.startsWith('---')) return;
  if (raw.startsWith('\\')) return; // "\ No newline at end of file"

  if (raw.startsWith('+')) {
    lines.add(cursor.newLine);
    cursor.newLine++;
  } else if (!raw.startsWith('-')) {
    cursor.newLine++; // context line
  }
}

/**
 * Walk each file's unified-diff patch and collect the new-file line numbers
 * it adds or changes (the `+` lines). Mirrors the equivalent step in
 * stale-literal-signals.ts.
 */
function computeTouchedLines(patches: Map<string, string>): Map<string, Set<number>> {
  const touched = new Map<string, Set<number>>();

  for (const [file, patch] of patches) {
    const lines = new Set<number>();
    const cursor: LineCursor = { newLine: 0 };
    for (const raw of patch.split('\n')) applyPatchLine(raw, cursor, lines);
    touched.set(file, lines);
  }

  return touched;
}

/** Union patch-derived touched lines with any caller-provided diffLines. */
function mergeTouchedLines(
  patchLines: Map<string, Set<number>>,
  provided: Map<string, Set<number>> | undefined,
): Map<string, Set<number>> {
  const merged = new Map<string, Set<number>>();
  for (const [file, set] of patchLines) merged.set(file, new Set(set));
  if (provided) {
    for (const [file, set] of provided) {
      const existing = merged.get(file) ?? new Set<number>();
      for (const n of set) existing.add(n);
      merged.set(file, existing);
    }
  }
  return merged;
}

function rangeOverlaps(start: number, end: number, touched: Set<number>): boolean {
  for (let line = start; line <= end; line++) {
    if (touched.has(line)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Light parsing — isolate a catch clause's body from chunk text
// ---------------------------------------------------------------------------

/** Skip a quoted string/template literal (any of `'`, `"`, `` ` ``), returning the index after it. */
function skipStringLike(text: string, i: number): number {
  const quote = text[i];
  i++;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === quote) return i + 1;
    i++;
  }
  return i;
}

/**
 * If `i` sits at the start of a string/template literal or a `//`/`/* *‍/`
 * comment, return the index just past it; otherwise null (nothing to skip).
 * Shared by {@link findMatchingBrace} and {@link extractTopLevelText} so
 * neither duplicates string/comment-skipping in its own depth-tracking loop.
 */
function skipNonStructural(text: string, i: number): number | null {
  const ch = text[i];
  if (ch === '"' || ch === "'" || ch === '`') return skipStringLike(text, i);
  if (ch === '/' && text[i + 1] === '/') {
    const j = text.indexOf('\n', i);
    return j === -1 ? text.length : j;
  }
  if (ch === '/' && text[i + 1] === '*') {
    const j = text.indexOf('*/', i + 2);
    return j === -1 ? text.length : j + 2;
  }
  return null;
}

/**
 * Given the index of an opening `{`, find the index of its matching `}`,
 * skipping over string/template literals and comments so stray brace-like
 * characters inside them don't confuse the depth count. Returns -1 if the
 * braces never balance (malformed/truncated source — bail rather than guess).
 */
function findMatchingBrace(text: string, openIdx: number): number {
  let depth = 0;
  let i = openIdx;
  while (i < text.length) {
    const skipped = skipNonStructural(text, i);
    if (skipped !== null) {
      i = skipped;
      continue;
    }
    const ch = text[i];
    if (ch === '{') {
      depth++;
      i++;
      continue;
    }
    if (ch === '}') {
      depth--;
      i++;
      if (depth === 0) return i - 1;
      continue;
    }
    i++;
  }
  return -1;
}

/**
 * Extract only the depth-0 text of a block body — i.e. everything NOT
 * nested inside a further `{...}` (an `if`/`for`/`try`/etc. block). This is
 * what lets us ask "is the code that ALWAYS runs, regardless of any
 * conditional inside this catch, a trailing throw?" without full
 * control-flow analysis: a nested block's content is opaque to this scan,
 * but its header (e.g. `if (comments.length === 0)`) stays, since only `{`
 * and `}` affect depth.
 */
function extractTopLevelText(body: string): string {
  let depth = 0;
  let i = 0;
  let out = '';
  while (i < body.length) {
    const skipped = skipNonStructural(body, i);
    if (skipped !== null) {
      if (depth === 0) out += body.slice(i, skipped);
      i = skipped;
      continue;
    }
    const ch = body[i];
    if (ch === '{') {
      depth++;
      i++;
      continue;
    }
    if (ch === '}') {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }
    if (depth === 0) out += ch;
    i++;
  }
  return out;
}

function countNewlines(text: string, upTo: number): number {
  let n = 0;
  for (let i = 0; i < upTo; i++) {
    if (text[i] === '\n') n++;
  }
  return n;
}

/**
 * Replace every string/template literal and comment span in `text` with
 * same-length whitespace (preserving newlines, so absolute line numbers
 * computed from the result still match the original). Used so the literal
 * word "catch" inside a docstring or a quoted code example — real content in
 * this repo's own `.assertions.ts` fixtures — never matches {@link CATCH_RE}.
 * Indices into the masked string line up 1:1 with the original, so callers
 * can find-match on the masked text but slice the ORIGINAL for real content.
 */
function maskNonCode(text: string): string {
  let i = 0;
  let out = '';
  while (i < text.length) {
    const skipped = skipNonStructural(text, i);
    if (skipped === null) {
      out += text[i];
      i++;
      continue;
    }
    for (let j = i; j < skipped; j++) out += text[j] === '\n' ? '\n' : ' ';
    i = skipped;
  }
  return out;
}

interface RawCatchMatch {
  binding: string | null;
  startLine: number;
  endLine: number;
  body: string;
}

/** Find every REAL (non-comment, non-string) catch clause in one chunk's content. */
function findCatchClauses(chunk: CodeChunk): RawCatchMatch[] {
  const { content, metadata } = chunk;
  const masked = maskNonCode(content);
  const results: RawCatchMatch[] = [];

  for (const m of masked.matchAll(CATCH_RE)) {
    const openIdx = m.index + m[0].length - 1; // index of the matched '{'
    const closeIdx = findMatchingBrace(content, openIdx);
    if (closeIdx === -1) continue; // unbalanced — skip rather than guess

    results.push({
      binding: m[1] ?? null,
      startLine: metadata.startLine + countNewlines(content, m.index),
      endLine: metadata.startLine + countNewlines(content, closeIdx),
      body: content.slice(openIdx + 1, closeIdx),
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Heuristic — does this catch body degrade indiscriminately?
// ---------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** (a) Does the body ever inspect the caught error's type/class/status? */
function hasDiscrimination(body: string, binding: string | null): boolean {
  if (GENERIC_DISCRIMINATION_RE.test(body)) return true;
  if (!binding) return false;
  const re = new RegExp(`\\b${escapeRegExp(binding)}\\s*\\.\\s*(?:${BINDING_PROPERTY_SUFFIX})\\b`);
  return re.test(body);
}

/** (b) Is the last statement NOT nested in a conditional block an unconditional throw? */
function endsWithUnconditionalThrow(topLevelText: string): boolean {
  return TRAILING_THROW_RE.test(topLevelText.trim());
}

/** Remove logging-call statements so what's left only reflects "real" actions. */
function stripLoggingCalls(text: string): string {
  return text.replace(LOGGING_CALL_STATEMENT_RE, '');
}

/** Does `text` contain a call to something other than a JS/TS keyword? */
function hasNonKeywordCall(text: string): boolean {
  for (const m of text.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (!CONTROL_KEYWORDS.has(m[1])) return true;
  }
  return false;
}

/** (c) Does the body do something beyond pure logging (a call, or a value-returning return)? */
function hasDegradeAction(strippedTopLevelText: string): boolean {
  return RETURN_WITH_VALUE_RE.test(strippedTopLevelText) || hasNonKeywordCall(strippedTopLevelText);
}

/**
 * Classify one catch body. Returns a one-line reason when it should be
 * flagged as an undiscriminated-degrade candidate, or null when it's exempt
 * (no binding to discriminate on, discriminates by error type, unconditionally
 * rethrows, or only logs). Exposed for direct unit testing of the heuristic,
 * independent of diff/chunk plumbing.
 */
export function classifyCatchBody(binding: string | null, body: string): string | null {
  // A bindingless `catch { ... }` cannot discriminate by construction — there
  // is no reference to check `.status`/`.code`/instanceof against. This is
  // also an extremely common, usually-correct idiom in this repo (a
  // best-effort probe that treats every failure as "use the safe default":
  // `catch { return standalone; }`, `catch { return []; }`) — measured via
  // this module's own byte-diff census on real fixtures. v1 stays silent on
  // it rather than mislabel that pattern as a bug the agent should "fix" by
  // adding a check that would never make sense here.
  if (!binding) return null;

  if (hasDiscrimination(body, binding)) return null;

  const topLevel = extractTopLevelText(body);
  if (endsWithUnconditionalThrow(topLevel)) return null;

  const stripped = stripLoggingCalls(topLevel);
  if (!hasDegradeAction(stripped)) return null; // pure logging (or no-op) — not a degrade path

  return (
    `treats every error class alike (no instanceof/.status/.code/.name check on the caught \`${binding}\`) ` +
    'and degrades via a fallback instead of rethrowing'
  );
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Evaluate every catch clause found in one chunk against `fileTouched`,
 * pushing a candidate for each one that overlaps the diff and classifies as
 * a degrade. `seen` dedupes by `file:line` across chunks whose ranges
 * overlap (e.g. an enclosing chunk and a nested one), split out of
 * {@link computeUndiscriminatedCatches} so its own loop stays flat.
 */
function collectCandidatesFromChunk(
  chunk: CodeChunk,
  fileTouched: Set<number>,
  seen: Set<string>,
  candidates: UndiscriminatedCatchCandidate[],
): void {
  const file = chunk.metadata.file;
  for (const found of findCatchClauses(chunk)) {
    if (!rangeOverlaps(found.startLine, found.endLine, fileTouched)) continue;

    const key = `${file}:${found.startLine}`;
    if (seen.has(key)) continue; // overlapping chunks (e.g. nested) can revisit the same catch

    const reason = classifyCatchBody(found.binding, found.body);
    if (!reason) continue;

    seen.add(key);
    candidates.push({
      file,
      line: found.startLine,
      endLine: found.endLine,
      binding: found.binding,
      reason,
    });
  }
}

/**
 * Find every catch clause this PR adds or modifies that appears to degrade
 * indiscriminately. Returns [] when there is no diff or no changed-file
 * chunks to scan. Exposed for testing.
 */
export function computeUndiscriminatedCatches(
  context: ReviewContext,
): UndiscriminatedCatchCandidate[] {
  const patches = context.pr?.patches;
  if (!patches || patches.size === 0) return [];
  const chunks = context.chunks;
  if (!chunks || chunks.length === 0) return [];

  const touchedLines = mergeTouchedLines(computeTouchedLines(patches), context.pr?.diffLines);

  const seen = new Set<string>();
  const candidates: UndiscriminatedCatchCandidate[] = [];

  for (const chunk of chunks) {
    if (!TS_JS_FILE_RE.test(chunk.metadata.file)) continue;
    const fileTouched = touchedLines.get(chunk.metadata.file);
    if (!fileTouched || fileTouched.size === 0) continue;
    collectCandidatesFromChunk(chunk, fileTouched, seen, candidates);
  }

  candidates.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return candidates;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const HEADER =
  'Pre-computed by a deterministic diff scan — the catch-clause discovery is ' +
  'done for you; do not re-read every catch block from scratch looking for this. ' +
  'Each entry is a catch clause this PR added or modified that appears to treat ' +
  'every error class alike (no instanceof/.status/.code/.name check on the ' +
  'caught binding) and does not unconditionally rethrow — it falls through to a ' +
  'fallback/degrade path instead. Confirm before reporting: if the degrade path ' +
  'is only correct for ONE error class (e.g. one specific HTTP status) while ' +
  'other classes (auth, rate-limit, 5xx, network) take the identical path, ' +
  'that is error-swallowing — report it. If the catch genuinely handles every ' +
  'error the same way correctly, stay silent.';

function renderEntry(c: UndiscriminatedCatchCandidate): string {
  const bindingLabel = c.binding ? `\`${c.binding}\`` : '(no binding)';
  return `- ${c.file}:${c.line}-${c.endLine} — caught as ${bindingLabel}: ${c.reason}`;
}

/**
 * Render undiscriminated-catch candidates as an
 * `<undiscriminated_catch_candidates>` block for the agent's initial
 * message. Returns '' when there are no candidates so callers can append
 * unconditionally. Caps at MAX_CANDIDATES with an explicit omission note —
 * never truncates silently. Exposed for testing.
 */
export function renderUndiscriminatedCatchCandidates(
  candidates: UndiscriminatedCatchCandidate[],
): string {
  if (candidates.length === 0) return '';

  const lines: string[] = ['<undiscriminated_catch_candidates>', HEADER];
  const shown = candidates.slice(0, MAX_CANDIDATES);
  for (const c of shown) lines.push(renderEntry(c));

  const omitted = candidates.length - shown.length;
  if (omitted > 0) {
    lines.push(
      `- [+${omitted} more candidate(s) omitted to respect the input budget — inspect the diff for the rest]`,
    );
  }

  lines.push('</undiscriminated_catch_candidates>');
  return lines.join('\n');
}

/**
 * Build the `<undiscriminated_catch_candidates>` section from the review
 * context. Returns '' when the PR adds/modifies no catch clause that fits
 * the shape, or there's no diff/changed-file chunks to scan.
 */
export function renderUndiscriminatedCatchSection(context: ReviewContext): string {
  return renderUndiscriminatedCatchCandidates(computeUndiscriminatedCatches(context));
}
