/**
 * Deterministic "changed comparison" signal for PR reviews, feeding the
 * `boundary-change` rule.
 *
 * Provenance / design principle: `boundary-change`'s entire domain is
 * comparisons and threshold literals changing (`>` -> `>=`, `5` -> `6`,
 * `&&` -> `||`, off-by-one index arithmetic, sign flips). Today the agent
 * must NOTICE these shapes in the diff before it can even start the rule's
 * MANDATORY investigation protocol — and the rule's own trigger-tuning
 * history (#741/#743, see `rules.ts`'s `BOUNDARY_CHANGE.triggers`) shows
 * noticing is the weak link, not judgment. This module precomputes the
 * DISCOVERY step only — "here is every comparison-shaped edit in this
 * diff" — and leaves judgment (intentional? disclosed? breaking?) to the
 * agent, mirroring `stale-literal-signals.ts` / `catch-discrimination-signals.ts`.
 *
 * ## What this scans for, per changed-line pair
 *
 * The diff's hunks are walked and REMOVED lines are paired with ADDED
 * lines within the same hunk (never across hunks — see "Conservative
 * pairing" below). Each accepted pair is classified as one of:
 *
 *  (a) **Comparison operator change** — `<`<->`<=`, `>`<->`>=`,
 *      `==`<->`===`, `!=`<->`!==`, `&&`<->`||`, or a bare logical negation
 *      (`!`) added/removed — detected by tokenizing both lines with
 *      {@link OPERATOR_TOKEN_RE}, stripping the matched tokens to form a
 *      "skeleton", and requiring the skeletons match (mod whitespace) so
 *      only the operator itself differs.
 *  (b) **Numeric literal change in a conditional context** — a number
 *      token changed (`5` -> `6`) via the same skeleton-diff technique,
 *      gated on the line containing a conditional/comparison keyword
 *      (`if`, `while`, `?`, `switch`, `case`, `.filter(`/`.some(`/`.every(`/
 *      `.find(`, or any comparison/logical operator) — per the design,
 *      literal changes with NO such keyword on the line (e.g. an unrelated
 *      config default) are intentionally not flagged here.
 *  (c) **Index-arithmetic off-by-one** — an identifier or `.length`
 *      expression used as an array index gains, loses, or changes a
 *      `+ N` / `- N` delta (`i` <-> `i + 1`, `.length` <-> `.length - 1`),
 *      detected by comparing the per-base "delta signature" extracted from
 *      each line via {@link INDEX_DELTA_RE} / {@link BARE_SUBSCRIPT_RE} /
 *      {@link BARE_LENGTH_RE}.
 *
 * ## Conservative pairing
 *
 * A removed line is only paired with an added line when (1) they appear in
 * the same diff hunk (proximity — pairing never crosses a `@@` boundary),
 * and (2) they share > 70% token overlap (Jaccard over a word/number/
 * punctuation-run tokenization) — see {@link tokenOverlap}. This is what
 * keeps unrelated refactors from false-pairing: a line rewritten beyond
 * recognition, or a wholly new line with no similar removed counterpart
 * (new code, not a boundary *change*), never enters the classifiers.
 * Pairing is greedy first-fit within a hunk's contiguous removed/added
 * block, not a globally optimal matching — acceptable for a heuristic
 * discovery aid, not a ground-truth diff algorithm.
 *
 * ## Known limitations (kept honest, not papered over)
 *
 *  - **Compound changes are invisible.** If BOTH the operator and the
 *    literal change on the same line (`> 5` -> `>= 6`), neither classifier
 *    fires: each requires everything OTHER than its own token category to
 *    stay skeleton-identical. A real boundary change can therefore slip
 *    through when it's more than one edit at once — the diff itself
 *    (always rendered separately in `<diff>`) is the backstop.
 *  - **`.length`-style index arithmetic is JS/TS-shaped.** Category (c)'s
 *    `.length` pattern doesn't recognize Python's `len(x)`, Go's `len(x)`,
 *    etc. — only a literal `.length` property access. Operator/negation
 *    categories (a) generalize better across C-family languages, but
 *    still miss Python's `and`/`or`/`not` keyword forms (no `&&`/`||`/`!`
 *    in Python) and Ruby's `unless`. Cross-language coverage is partial by
 *    construction, not a bug.
 *  - **Single-line masking only.** {@link maskLine} strips string/template
 *    literals and same-line `//`/`#` comments, but has no cross-line state
 *    — a multi-line `/* ... *‍/` block comment is not recognized as a
 *    comment on its continuation lines. A comparison-shaped token that
 *    happens to sit inside such a continuation is a possible false
 *    positive this scan cannot see.
 *  - **Test-assertion noise is only trivially filtered.** A pair where
 *    BOTH lines are `expect(...)`/`assert(...)` calls in a file matching
 *    {@link TEST_FILE_RE} is skipped — this catches the common case but not
 *    every assertion style (e.g. `.should.equal(...)`, bare `assert x == y`
 *    without a call-like prefix).
 *  - **Negation detection is a raw `!` count, not scope-aware.** Adding an
 *    unrelated `!` elsewhere on an otherwise-similar line (rare in
 *    practice, given the skeleton-equality gate) would still be classified
 *    as a negation toggle.
 */

import type { ReviewContext } from './plugin-types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComparisonChangeKind = 'operator' | 'literal' | 'index-arithmetic';

/** A comparison/threshold-shaped edit this PR made, paired old -> new. */
export interface ComparisonChangeCandidate {
  file: string;
  /** New-file line number of the added line in the pair. */
  line: number;
  kind: ComparisonChangeKind;
  /** The old fragment (operator, literal, or index expression). */
  oldFragment: string;
  /** The new fragment. */
  newFragment: string;
  /** One-line explanation of what changed. */
  reason: string;
}

/** Shared shape returned by each per-category classifier before `kind` is attached. */
interface FragmentResult {
  oldFragment: string;
  newFragment: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max candidates reported — keeps the prompt compact. */
const MAX_CANDIDATES = 10;

/** Minimum Jaccard token overlap for a removed/added line to be paired. */
const PAIRING_OVERLAP_THRESHOLD = 0.7;

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Comparison/logical operator tokens, longest-first so the regex engine's
 * left-to-right alternative order greedily prefers `===` over `==`, `!==`
 * over `!=`, etc. A bare `!` is included as its own token (logical NOT) —
 * distinguished from `!=`/`!==` only by alternative order, same trick.
 */
const OPERATOR_TOKEN_RE = /<=|>=|===|!==|==|!=|&&|\|\||<|>|!/g;

/** A number literal, excluding digits embedded in a wider identifier/decimal chain. */
const NUMBER_TOKEN_RE = /(?<![\w.])-?\d+(?:\.\d+)?(?![\w.])/g;

/** Recognized unordered operator-change pairs — the domain from the module doc. */
const OPERATOR_PAIRS = new Set<string>([
  ['<', '<='].sort().join('|'),
  ['>', '>='].sort().join('|'),
  ['==', '==='].sort().join('|'),
  ['!=', '!=='].sort().join('|'),
  ['&&', '||'].sort().join('|'),
]);

/** Line contains a conditional/comparison keyword — gates the literal-change check (b). */
const CONDITIONAL_CONTEXT_RE =
  /\bif\b|\bwhile\b|\?|\bswitch\b|\bcase\b|\.filter\s*\(|\.some\s*\(|\.every\s*\(|\.find\s*\(|<=|>=|===?|!==?|&&|\|\||[<>]/;

/** `base + N` / `base - N` where base is an identifier or `identifier.length`. */
const INDEX_DELTA_RE = /\b([A-Za-z_$][\w$]*(?:\.length)?)\s*([+-])\s*(\d+)\b/g;

/** A bare base used as an array subscript with no delta: `arr[i]`, `arr[n.length]`. */
const BARE_SUBSCRIPT_RE = /\[\s*([A-Za-z_$][\w$]*(?:\.length)?)\s*\]/g;

/** A bare `identifier.length` NOT followed by a delta (avoids double-counting with INDEX_DELTA_RE). */
const BARE_LENGTH_RE = /\b([A-Za-z_$][\w$]*\.length)\b(?!\s*[+-]\s*\d)/g;

/** Files whose assertion lines are filtered per the "test noise" limitation. */
const TEST_FILE_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)test_[^/]+\.py$|_test\.py$|_spec\.rb$/;

/** A trivially-detectable test-assertion line (see module doc limitations). */
const TEST_ASSERTION_RE = /^\s*(?:expect|assert)\s*\(/;

// ---------------------------------------------------------------------------
// Diff hunk parsing — group removed/added lines into same-hunk change blocks
// ---------------------------------------------------------------------------

interface AddedLine {
  text: string;
  newLine: number;
}

interface ChangeBlock {
  removed: string[];
  added: AddedLine[];
}

/** Mutable state threaded through {@link processDiffLine} by {@link extractChangeBlocks}. */
interface BlockState {
  blocks: ChangeBlock[];
  current: ChangeBlock | null;
  newLine: number;
}

/** Close the pending block (if it qualifies — both sides non-empty) and clear it. */
function flushBlock(state: BlockState): void {
  if (state.current && state.current.removed.length > 0 && state.current.added.length > 0) {
    state.blocks.push(state.current);
  }
  state.current = null;
}

/**
 * Apply one raw unified-diff line to `state`: hunk headers reset the
 * new-line cursor and close the pending block; `-`/`+` lines open or extend
 * the pending block; a context line closes it. Split out of
 * {@link extractChangeBlocks} so its own loop stays flat.
 */
function processDiffLine(raw: string, state: BlockState): void {
  const header = raw.match(HUNK_HEADER_RE);
  if (header) {
    flushBlock(state);
    state.newLine = parseInt(header[2], 10);
    return;
  }
  if (raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('\\')) return;

  if (raw.startsWith('-')) {
    state.current ??= { removed: [], added: [] };
    state.current.removed.push(raw.slice(1));
    return;
  }
  if (raw.startsWith('+')) {
    state.current ??= { removed: [], added: [] };
    state.current.added.push({ text: raw.slice(1), newLine: state.newLine });
    state.newLine++;
    return;
  }
  // Context line: closes any pending block, and advances the cursor.
  flushBlock(state);
  state.newLine++;
}

/**
 * Split one file's unified-diff patch into per-hunk change blocks: maximal
 * runs of consecutive `-` lines immediately followed by consecutive `+`
 * lines (the shape git/unified-diff emits for a "modified line"), each
 * carrying the added lines' new-file line numbers. A context line or hunk
 * boundary closes the current block. This is the "same hunk proximity"
 * scope for pairing — blocks never span a `@@` header.
 */
function extractChangeBlocks(patch: string): ChangeBlock[] {
  const state: BlockState = { blocks: [], current: null, newLine: 0 };
  for (const raw of patch.split('\n')) processDiffLine(raw, state);
  flushBlock(state);
  return state.blocks;
}

// ---------------------------------------------------------------------------
// Line masking — hide string/template literals and same-line comments
// ---------------------------------------------------------------------------

function isQuoteChar(ch: string): boolean {
  return ch === '"' || ch === "'" || ch === '`';
}

/**
 * Mask the quoted region starting at `line[i]` (the opening quote) with
 * same-length spaces, honoring backslash escapes. Returns the masked
 * fragment and the index just past the closing quote (or end of line, for
 * an unterminated string). Split out of {@link maskLine} so its own loop
 * stays flat.
 */
function maskQuoted(line: string, i: number): { masked: string; next: number } {
  const quote = line[i];
  let masked = ' ';
  let j = i + 1;
  while (j < line.length && line[j] !== quote) {
    if (line[j] === '\\' && j + 1 < line.length) {
      masked += '  ';
      j += 2;
    } else {
      masked += ' ';
      j++;
    }
  }
  if (j < line.length) {
    masked += ' ';
    j++;
  }
  return { masked, next: j };
}

/**
 * Mask string/template-literal contents and a trailing same-line `//`/`#`
 * comment with spaces (preserving length, so no offsets shift). Single-line
 * only — see the module doc's "Single-line masking only" limitation.
 */
function maskLine(line: string): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (isQuoteChar(ch)) {
      const { masked, next } = maskQuoted(line, i);
      out += masked;
      i = next;
      continue;
    }
    if ((ch === '/' && line[i + 1] === '/') || ch === '#') {
      out += ' '.repeat(line.length - i);
      break;
    }
    out += ch;
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pairing — token-overlap similarity gate
// ---------------------------------------------------------------------------

const TOKEN_RE = /[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|[^\sA-Za-z0-9_$]+/g;

function tokenSet(line: string): Set<string> {
  return new Set(line.match(TOKEN_RE) ?? []);
}

/** Jaccard overlap between two lines' token sets. */
function tokenOverlap(a: string, b: string): number {
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

interface LinePair {
  oldLine: string;
  newLine: string;
  newLineNo: number;
}

/** Best unused added-line index for `removed` in `block`, or -1 if none clears the overlap bar. */
function findBestAddedMatch(removed: string, block: ChangeBlock, usedAdded: Set<number>): number {
  let bestIdx = -1;
  let bestScore = PAIRING_OVERLAP_THRESHOLD;
  block.added.forEach((added, idx) => {
    if (usedAdded.has(idx)) return;
    const score = tokenOverlap(removed, added.text);
    if (score >= bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });
  return bestIdx;
}

/**
 * Greedily pair each removed line with the best unused added line in the
 * same block, requiring >= {@link PAIRING_OVERLAP_THRESHOLD} token overlap.
 * Removed or added lines left over (no sufficiently similar counterpart)
 * are simply not paired — an added line with no match is new code, not a
 * changed line, per the module's scope.
 */
function pairBlock(block: ChangeBlock): LinePair[] {
  const pairs: LinePair[] = [];
  const usedAdded = new Set<number>();

  for (const removed of block.removed) {
    const bestIdx = findBestAddedMatch(removed, block, usedAdded);
    if (bestIdx === -1) continue;
    usedAdded.add(bestIdx);
    pairs.push({
      oldLine: removed,
      newLine: block.added[bestIdx].text,
      newLineNo: block.added[bestIdx].newLine,
    });
  }

  return pairs;
}

// ---------------------------------------------------------------------------
// Classifiers — (a) operator, (b) literal, (c) index-arithmetic
// ---------------------------------------------------------------------------

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Tokenize with `re`, returning both the matched tokens (in order) and the
 * residual "skeleton" with matches removed entirely (not replaced by a
 * placeholder). Removal matters: a token like `!` that sits directly
 * against an identifier with no surrounding space (`!isValid(x)`) would,
 * if replaced by a space instead of deleted, leave a spurious gap on
 * whichever side has the token and NOT the other — permanently breaking
 * skeleton equality for exactly the negation-added/removed case this
 * module needs to recognize. Deleting and then collapsing whitespace
 * (via {@link normalizeWhitespace}) is symmetric for both spaced tokens
 * (`a == b` vs `a === b`, both left with `a  b` -> `a b`) and unspaced
 * ones (`!isValid` vs `isValid`, both left with `isValid`).
 */
function tokenizeAndStrip(line: string, re: RegExp): { tokens: string[]; skeleton: string } {
  const tokens: string[] = [];
  const skeleton = line.replace(re, m => {
    tokens.push(m);
    return '';
  });
  return { tokens, skeleton: normalizeWhitespace(skeleton) };
}

/**
 * The single index where equal-length arrays `a`/`b` differ, or -1 when
 * they're identical or differ in more than one position. Shared by the
 * operator and literal classifiers — each requires exactly one changed
 * token with everything else (the skeleton, already checked by the caller)
 * unchanged.
 */
function findSingleDiffIndex(a: string[], b: string[]): number {
  let diffIdx = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (diffIdx !== -1) return -1; // more than one difference
    diffIdx = i;
  }
  return diffIdx;
}

/**
 * Find the single index whose removal from `longer` makes it equal (by
 * value) to `shorter`. Returns -1 if no such single-element removal exists.
 * Used to locate an added/removed negation token when operator-token counts
 * differ by exactly one.
 */
function findSingleInsertionIndex(shorter: string[], longer: string[]): number {
  if (longer.length !== shorter.length + 1) return -1;
  for (let skip = 0; skip < longer.length; skip++) {
    let matches = true;
    let si = 0;
    for (let li = 0; li < longer.length; li++) {
      if (li === skip) continue;
      if (longer[li] !== shorter[si]) {
        matches = false;
        break;
      }
      si++;
    }
    if (matches) return skip;
  }
  return -1;
}

/** Equal-length operator-token arrays: exactly one changed slot, and it's a recognized pair. */
function classifySameLengthOperatorChange(
  oldTokens: string[],
  newTokens: string[],
): FragmentResult | null {
  const i = findSingleDiffIndex(oldTokens, newTokens);
  if (i === -1) return null;
  const pairKey = [oldTokens[i], newTokens[i]].sort().join('|');
  if (!OPERATOR_PAIRS.has(pairKey)) return null;
  return {
    oldFragment: oldTokens[i],
    newFragment: newTokens[i],
    reason: `comparison operator changed from \`${oldTokens[i]}\` to \`${newTokens[i]}\``,
  };
}

/** Operator-token arrays differing by exactly one slot: a bare `!` (negation) added or removed. */
function classifyNegationToggle(oldTokens: string[], newTokens: string[]): FragmentResult | null {
  const oldIsShorter = oldTokens.length < newTokens.length;
  const shorter = oldIsShorter ? oldTokens : newTokens;
  const longer = oldIsShorter ? newTokens : oldTokens;

  const insertionIdx = findSingleInsertionIndex(shorter, longer);
  if (insertionIdx === -1 || longer[insertionIdx] !== '!') return null;

  return oldIsShorter
    ? { oldFragment: '(no negation)', newFragment: '!', reason: 'logical negation (`!`) added' }
    : { oldFragment: '!', newFragment: '(no negation)', reason: 'logical negation (`!`) removed' };
}

/** (a) Comparison operator change, including negation added/removed. */
function classifyOperatorChange(oldLine: string, newLine: string): FragmentResult | null {
  const oldTok = tokenizeAndStrip(oldLine, OPERATOR_TOKEN_RE);
  const newTok = tokenizeAndStrip(newLine, OPERATOR_TOKEN_RE);
  if (oldTok.skeleton !== newTok.skeleton) return null;

  return oldTok.tokens.length === newTok.tokens.length
    ? classifySameLengthOperatorChange(oldTok.tokens, newTok.tokens)
    : classifyNegationToggle(oldTok.tokens, newTok.tokens);
}

/** (b) Numeric literal change, gated on conditional/comparison context. */
function classifyLiteralChange(oldLine: string, newLine: string): FragmentResult | null {
  if (!CONDITIONAL_CONTEXT_RE.test(oldLine) && !CONDITIONAL_CONTEXT_RE.test(newLine)) return null;

  const oldTok = tokenizeAndStrip(oldLine, NUMBER_TOKEN_RE);
  const newTok = tokenizeAndStrip(newLine, NUMBER_TOKEN_RE);
  if (oldTok.skeleton !== newTok.skeleton) return null;
  if (oldTok.tokens.length !== newTok.tokens.length || oldTok.tokens.length === 0) return null;

  const i = findSingleDiffIndex(oldTok.tokens, newTok.tokens);
  if (i === -1) return null;
  return {
    oldFragment: oldTok.tokens[i],
    newFragment: newTok.tokens[i],
    reason: `numeric literal changed from \`${oldTok.tokens[i]}\` to \`${newTok.tokens[i]}\` in a conditional context`,
  };
}

/** Per-base delta signature: `null` sign means "bare" (no +/- delta). */
interface IndexSignature {
  sign: '+' | '-' | null;
  amount: number | null;
}

function findIndexSignatures(line: string): Map<string, IndexSignature> {
  const sigs = new Map<string, IndexSignature>();

  for (const m of line.matchAll(INDEX_DELTA_RE)) {
    const [, base, sign, amount] = m;
    sigs.set(base, { sign: sign as '+' | '-', amount: parseInt(amount, 10) });
  }
  for (const m of line.matchAll(BARE_SUBSCRIPT_RE)) {
    if (!sigs.has(m[1])) sigs.set(m[1], { sign: null, amount: null });
  }
  for (const m of line.matchAll(BARE_LENGTH_RE)) {
    if (!sigs.has(m[1])) sigs.set(m[1], { sign: null, amount: null });
  }

  return sigs;
}

function formatIndexFragment(base: string, sig: IndexSignature): string {
  return sig.sign === null ? base : `${base} ${sig.sign} ${sig.amount}`;
}

/** (c) Index-arithmetic off-by-one: a base identifier/`.length`'s delta changed. */
function classifyIndexArithmetic(oldLine: string, newLine: string): FragmentResult | null {
  const oldSigs = findIndexSignatures(oldLine);
  const newSigs = findIndexSignatures(newLine);

  for (const [base, oldSig] of oldSigs) {
    const newSig = newSigs.get(base);
    if (!newSig) continue;
    if (oldSig.sign === newSig.sign && oldSig.amount === newSig.amount) continue;

    const oldFragment = formatIndexFragment(base, oldSig);
    const newFragment = formatIndexFragment(base, newSig);
    return {
      oldFragment,
      newFragment,
      reason: `index arithmetic on \`${base}\` changed from \`${oldFragment}\` to \`${newFragment}\``,
    };
  }

  return null;
}

/**
 * Classify one masked old/new line pair against all three categories.
 * Checked in this fixed order; exposed for direct unit testing of the
 * heuristics, independent of diff/hunk plumbing. Returns null when none
 * of the three classifiers recognize the pair.
 */
export function classifyLinePair(
  oldLine: string,
  newLine: string,
): ({ kind: ComparisonChangeKind } & FragmentResult) | null {
  const maskedOld = maskLine(oldLine);
  const maskedNew = maskLine(newLine);

  const op = classifyOperatorChange(maskedOld, maskedNew);
  if (op) return { kind: 'operator', ...op };

  const lit = classifyLiteralChange(maskedOld, maskedNew);
  if (lit) return { kind: 'literal', ...lit };

  const idx = classifyIndexArithmetic(maskedOld, maskedNew);
  if (idx) return { kind: 'index-arithmetic', ...idx };

  return null;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

function isTestAssertionNoise(file: string, oldLine: string, newLine: string): boolean {
  if (!TEST_FILE_RE.test(file)) return false;
  return TEST_ASSERTION_RE.test(oldLine) && TEST_ASSERTION_RE.test(newLine);
}

/**
 * Classify every paired line in one file's patch, pushing a candidate for
 * each pair that isn't test-assertion noise and classifies as one of the
 * three categories. Split out of {@link computeComparisonChanges} so its
 * own loop stays flat.
 */
function collectCandidatesFromPatch(
  file: string,
  patch: string,
  candidates: ComparisonChangeCandidate[],
): void {
  for (const block of extractChangeBlocks(patch)) {
    for (const pair of pairBlock(block)) {
      if (isTestAssertionNoise(file, pair.oldLine, pair.newLine)) continue;
      const classified = classifyLinePair(pair.oldLine, pair.newLine);
      if (!classified) continue;
      candidates.push({ file, line: pair.newLineNo, ...classified });
    }
  }
}

/**
 * Find every comparison/threshold-shaped edit in this PR's diff: paired
 * removed/added lines (same hunk, > 70% token overlap) classified as an
 * operator change, a conditional-context literal change, or an
 * index-arithmetic off-by-one. Returns [] when there is no diff. Exposed
 * for testing.
 */
export function computeComparisonChanges(context: ReviewContext): ComparisonChangeCandidate[] {
  const patches = context.pr?.patches;
  if (!patches || patches.size === 0) return [];

  const candidates: ComparisonChangeCandidate[] = [];
  for (const [file, patch] of patches) collectCandidatesFromPatch(file, patch, candidates);

  candidates.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return candidates;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const HEADER =
  'Pre-computed by a deterministic diff scan — the comparison/threshold-shaped ' +
  'edit discovery is done for you; do not re-scan the whole diff line-by-line ' +
  'looking for these. Each entry is a removed/added line pair this PR changed ' +
  'that shifts a comparison operator, a numeric literal in a conditional ' +
  'context, or index arithmetic adjacent to indexing. Discovery only — this ' +
  'block does NOT judge whether the change is intentional, disclosed, or ' +
  "breaking, and it does NOT substitute for the boundary-change protocol's " +
  'MANDATORY get_files_context call: knowing the file:line here does not tell ' +
  'you the test associations for that file, so you must still call ' +
  'get_files_context on it to find and inspect the covering tests, per the ' +
  'protocol. Apply the full protocol to each entry: identify the divergence ' +
  'input, check test coverage for it via get_files_context, and consult ' +
  '<blast_radius>. This scan can miss compound changes (operator AND literal ' +
  'changed on the same line) — the <diff> section is still the ground truth.';

function renderEntry(c: ComparisonChangeCandidate): string {
  return `- ${c.file}:${c.line} — \`${c.oldFragment}\` → \`${c.newFragment}\` (${c.kind}): ${c.reason}`;
}

/**
 * Render comparison-change candidates as a `<comparison_change_candidates>`
 * block. Returns '' when there are none. Caps at MAX_CANDIDATES with an
 * explicit omission note — never truncates silently. Exposed for testing.
 */
export function renderComparisonChangeCandidates(candidates: ComparisonChangeCandidate[]): string {
  if (candidates.length === 0) return '';

  const lines: string[] = ['<comparison_change_candidates>', HEADER];
  const shown = candidates.slice(0, MAX_CANDIDATES);
  for (const c of shown) lines.push(renderEntry(c));

  const omitted = candidates.length - shown.length;
  if (omitted > 0) {
    lines.push(
      `- [+${omitted} more candidate(s) omitted to respect the input budget — inspect the diff for the rest]`,
    );
  }

  lines.push('</comparison_change_candidates>');
  return lines.join('\n');
}

/**
 * Build the `<comparison_change_candidates>` section from the review
 * context. Returns '' when the PR's diff has no qualifying comparison
 * change, or there's no diff at all.
 */
export function renderComparisonChangeSection(context: ReviewContext): string {
  return renderComparisonChangeCandidates(computeComparisonChanges(context));
}
