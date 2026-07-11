/**
 * Deterministic discovery signal for the doc-truth rule.
 *
 * doc-truth's MANDATORY protocol tells the agent to "list every claim-bearing
 * line the diff touched" and verify each against the code — but nothing makes
 * that inventory non-optional, and calibration of the four seed fixtures
 * (pr667 0/10, pr711 0/10, pr716 2/10, pr687 1/10 on kimi-k2.7-code) showed the
 * model, under budget pressure on a bug-rich PR, doesn't reliably *chase* the
 * doc claim on its own initiative (issue #729). The claim was in-prompt and the
 * rule was active; what was missing was a handed-to-it worklist.
 *
 * This module pre-computes that worklist, mirroring the
 * `<stale_literal_candidates>` / `<untrusted_input_sites>` precedents: a
 * zero-LLM regex pass over the ADDED lines of the touched guidance/doc surfaces
 * (the exact surfaces `guidance-surface-signals` passes through), extracting
 * claim-shaped prose and injecting it as a `<doc_claims>` block — "the
 * discovery step is done for you; verify EACH against the code". It hands the
 * agent concrete claims to check, countering the initiative-driven miss.
 *
 * It is a DISCOVERY aid, not a verdict: extraction is intentionally recall-
 * biased on claim shapes but skips code (fenced blocks) and tabular data, and
 * the render layer reminds the agent that a worklist entry may be descriptive
 * prose rather than a falsifiable behavioral claim — those need no finding, so
 * the block never manufactures a contradiction the code doesn't support.
 */

import type { CodeChunk } from '@liendev/parser';
import type { ReviewContext } from './plugin-types.js';
import { collectGuidanceSurfaceChanges } from './guidance-surface-signals.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The claim shapes doc-truth enumerates, plus the two scope shapes the seed
 * fixtures need. Used as a hint label internally (extraction order) — the
 * rendered worklist lists the prose, not the shape.
 */
export type DocClaimShape =
  | 'mechanism'
  | 'state'
  | 'default'
  | 'scope-gate'
  | 'scope-unchanged'
  | 'requirement'
  | 'negation';

/**
 * A code (or sibling-doc) excerpt located deterministically for a claim: the
 * material the reviewer must COMPARE the claim against. Turns verification from
 * an O(n) tool investigation into a single comparison, mirroring how
 * `<stale_literal_candidates>` pre-computes the surviving line.
 */
export interface DocClaimEvidence {
  /** Repo-relative path of the chunk the evidence was taken from. */
  file: string;
  /** New-file line number of the first excerpt line. */
  startLine: number;
  /** The relevant lines of the located chunk (windowed + capped). */
  excerpt: string;
  /** The anchor token that located this evidence (used to center the excerpt). */
  anchor: string;
  /**
   * True when the evidence is a sibling DOC/guidance file rather than code —
   * the acceptable evidence shape for omission claims (e.g. a claim's
   * enumeration compared against an ADR's fuller list), flagged so the agent
   * weighs it as prose-vs-prose, not prose-vs-code.
   */
  fromDoc: boolean;
}

/** A claim-shaped line the diff added to a guidance/doc surface. */
export interface DocClaim {
  /** Repo-relative path of the guidance/doc surface the claim was added to. */
  file: string;
  /** The added line, trimmed and capped (see MAX_CLAIM_CHARS). */
  claimText: string;
  /** Which claim shape matched — most-specific-first (see CLAIM_SHAPES). */
  shape: DocClaimShape;
  /**
   * The code/sibling-doc the claim describes, located deterministically over
   * the indexed repo. Absent when no anchor in the claim resolves to a chunk
   * (or when there is no repo index to search) — the render layer then falls
   * back to the investigate-it-yourself instruction.
   */
  evidence?: DocClaimEvidence;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cap the worklist so the prompt stays compact (protects the input budget). */
const MAX_CLAIMS = 20;
/** Per-claim character cap — a claim line is a pointer, not the whole hunk. */
const MAX_CLAIM_CHARS = 200;
/** Per-claim evidence excerpt cap — enough to carry the described code, not a hunk. */
const MAX_EVIDENCE_CHARS = 400;
/** Lines of context above / below the anchor line in an evidence excerpt (~6-line window). */
const EVIDENCE_LINES_BEFORE = 2;
const EVIDENCE_LINES_AFTER = 3;
/**
 * Total budget for the whole `<doc_claims>` block. Evidence excerpts are
 * dropped (with an inline note) before any claim is dropped, so the worklist
 * itself always survives even on a doc-heavy PR.
 */
const MAX_DOC_CLAIMS_CHARS = 8_000;

const HUNK_META_RE = /^(?:\+\+\+|---)/;
/** A fenced code block opener/closer — claims are prose, not code samples. */
const FENCE_RE = /^(?:```|~~~)/;

/**
 * Claim-shaped prose matchers, most-specific first (first match wins the
 * shape label; one claim per line). Deliberately tight to keep the worklist
 * high-signal on doc-heavy PRs:
 *  - `mechanism`   — the classic doc-truth case: a search/discovery mechanism
 *    named as meaning-based/semantic/lexical/keyword/embedding/BM25/full-text.
 *    Requires a nearby search-domain word so "lexical scope" prose elsewhere
 *    doesn't match.
 *  - `state`       — "reports as disabled", "X disabled/enabled/required when Y"
 *    (doc-truth's own state-claim keywords).
 *  - `default`     — "defaults to N", "by default", "default: true".
 *  - `scope-gate`  — an existence/index-presence gate paired with a
 *    fallback/otherwise/standalone consequence (pr667's "has an index
 *    (`structural.db` exists) … we fall back to standalone").
 *  - `scope-unchanged` — "X are/is/remain(s) … unchanged" or "otherwise
 *    unchanged" (pr711's "public error exports are otherwise unchanged"). The
 *    linking verb keeps it off bare status-word fragments.
 *  - `requirement` — "requires"/"required" (pr716's "no compiler or build
 *    toolchain required").
 *  - `negation`    — a software-subject behavioral negation "(does|do|is|are|
 *    it|they|which|that) not <verb>" (pr687's "do not crash"). Bare modal
 *    "never/must/cannot" is intentionally NOT a trigger — in these docs it is
 *    almost always a developer imperative ("never run npm install", "must echo
 *    back"), not a falsifiable claim about the code the diff touches.
 */
const CLAIM_SHAPES: ReadonlyArray<{ shape: DocClaimShape; re: RegExp; near?: RegExp }> = [
  {
    shape: 'mechanism',
    re: /\b(?:meaning-based|semantic(?:ally)?|lexical|keyword-based|embedding-based|bm25|full-text|substring)\b/i,
    near: /\b(?:search|match(?:ing)?|similar|discover|rank(?:ing|ed)?|index|quer|token)/i,
  },
  { shape: 'state', re: /\breports?\s+as\s+(?:disabled|enabled|inactive|active|unavailable)\b/i },
  {
    shape: 'state',
    re: /\b(?:disabled|enabled|inactive|inert|no-?op|ignored|unavailable|read-only|optional|required|active)\s+(?:when|unless|if|without)\b/i,
  },
  { shape: 'default', re: /\bdefaults?\s+(?:to|:)|\bby default\b|default:\s*(?:true|false|\d)/i },
  {
    shape: 'scope-gate',
    re: /\b(?:exists?|has (?:an?|no) index|is present|is absent|is missing|no longer exists?)\b/i,
    near: /\b(?:fall(?:s)? back|fallback|otherwise|unless|only if|standalone|if (?:either|the|it|not))\b/i,
  },
  {
    shape: 'scope-unchanged',
    re: /\b(?:are|is|remains?|stays?)\s+(?:\w+\s+){0,3}unchanged\b|\botherwise\s+unchanged\b/i,
  },
  { shape: 'requirement', re: /\brequires?\b|\brequired\b/i },
  { shape: 'negation', re: /\b(?:does|do|is|are|it|they|which|that)\s+not\s+\w+/i },
];

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/** Return the first matching claim shape for a prose line, or null. */
function classifyClaim(text: string): { shape: DocClaimShape; matchIndex: number } | null {
  for (const { shape, re, near } of CLAIM_SHAPES) {
    const m = re.exec(text);
    if (m && (!near || near.test(text))) return { shape, matchIndex: m.index };
  }
  return null;
}

/**
 * Trim and cap a claim line. When the line exceeds the cap, the excerpt is
 * CENTERED on the matched claim phrase rather than taken from the line's head —
 * a long markdown line (e.g. a one-line blockquote Note) can carry its
 * falsifiable phrase hundreds of chars in, and a head-truncated pointer would
 * cut off exactly the words the reviewer must verify.
 */
function toClaimText(line: string, matchIndex: number): string {
  const t = line.trim();
  if (t.length <= MAX_CLAIM_CHARS) return t;
  const offset = Math.max(0, matchIndex - (line.length - line.trimStart().length));
  const start = Math.min(
    Math.max(0, offset - Math.floor(MAX_CLAIM_CHARS / 2)),
    t.length - MAX_CLAIM_CHARS,
  );
  const excerpt = t.slice(start, start + MAX_CLAIM_CHARS);
  return `${start > 0 ? '…' : ''}${excerpt}${start + MAX_CLAIM_CHARS < t.length ? '…' : ''}`;
}

/** One line of a patch's NEW-file view (context + added), stripped of prefix. */
interface NewFileLine {
  text: string;
  isAdded: boolean;
}

/**
 * The NEW-file view of a patch: context and added lines in order, prefix
 * stripped and tagged with `isAdded`. Removed (`-`) lines don't exist in the
 * new file, so they're dropped — which is also why fence state (tracked by the
 * caller over this view) stays correct.
 */
function newFileLines(patch: string): NewFileLine[] {
  const out: NewFileLine[] = [];
  for (const raw of patch.split('\n')) {
    if (HUNK_META_RE.test(raw)) continue;
    if (raw.startsWith('+')) out.push({ text: raw.slice(1), isAdded: true });
    else if (raw.startsWith(' ') || raw === '')
      out.push({ text: raw === '' ? '' : raw.slice(1), isAdded: false });
  }
  return out;
}

/**
 * The candidate-claim prose lines of one file's patch: ADDED lines that are
 * outside fenced code blocks, non-blank, and not Markdown table rows. A
 * ` ```sql ` block's contents are skipped — a doc's code SAMPLES are not
 * claims; blank lines and table rows (`|`) are tabular layout, not prose.
 */
function addedProseLines(patch: string): string[] {
  const out: string[] = [];
  let inFence = false;

  for (const { text, isAdded } of newFileLines(patch)) {
    if (FENCE_RE.test(text.trim())) {
      inFence = !inFence;
      continue;
    }
    if (!isAdded || inFence) continue;

    const t = text.trim();
    if (t && !t.startsWith('|')) out.push(t);
  }

  return out;
}

/**
 * Reduce a markdown link to its display text. Link TARGETS are not prose: a
 * slug like `0011-…-fts5-lexical-search.md` contains claim-shaped words
 * ("lexical", "search") that false-classify the line and steal the excerpt
 * center from the real claim later in the sentence (observed on PR #687's
 * one-line Note, where the ADR-011 link out-matched "do not crash").
 */
function stripLinkTargets(text: string): string {
  return text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
}

/** Extract classified claim lines from one file's patch. */
function extractClaimsFromPatch(file: string, patch: string): DocClaim[] {
  const claims: DocClaim[] = [];
  for (const raw of addedProseLines(patch)) {
    const text = stripLinkTargets(raw);
    const match = classifyClaim(text);
    if (match)
      claims.push({ file, claimText: toClaimText(text, match.matchIndex), shape: match.shape });
  }
  return claims;
}

/**
 * Collect claim-shaped lines from every changed guidance/doc surface, smallest
 * hunk first (reusing `collectGuidanceSurfaceChanges`' ordering so a voluminous
 * doc can't crowd a small changeset's claims out of the cap downstream).
 * Identical claim lines are deduped. Returns ALL claims (uncapped); the render
 * layer caps and notes any overflow. Exposed for testing.
 */
export function extractDocClaims(patches: Map<string, string>): DocClaim[] {
  const claims: DocClaim[] = [];
  const seen = new Set<string>();

  for (const { file, patch } of collectGuidanceSurfaceChanges(patches)) {
    for (const claim of extractClaimsFromPatch(file, patch)) {
      if (seen.has(claim.claimText)) continue;
      seen.add(claim.claimText);
      claims.push(claim);
    }
  }

  return claims;
}

// ---------------------------------------------------------------------------
// Anchor extraction
// ---------------------------------------------------------------------------

/**
 * A dotted / starred config-or-file key: `structural.db`, `embeddings.*`,
 * `core.embeddingBatchSize`, `qdrant.*`. The most specific anchor shape —
 * these tokens are rare enough that a content match is almost always the
 * described key.
 */
const DOTTED_KEY_RE = /\b[A-Za-z_$][\w$-]*(?:\.[\w$*-]+)+/g;
/** A camelCase / PascalCase identifier: `resolveIndexStrategy`, `OverlayBackend`, `LienErrorCode`. */
const CAMEL_ID_RE = /\b[A-Za-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+\b/g;
/** A snake / SCREAMING_SNAKE identifier: `search_code`, `LIEN_WORKTREE_STANDALONE`. */
const SNAKE_ID_RE = /\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b/g;
/** Backtick-quoted spans — high-confidence code tokens even when a bare word. */
const BACKTICK_SPAN_RE = /`([^`]+)`/g;
/** Plain word tokens (letters/digits), used only to mine backtick spans. */
const PLAIN_WORD_RE = /[A-Za-z][A-Za-z0-9]*/g;

/** Minimum anchor length — shorter tokens are too common to locate anything. */
const MIN_ANCHOR_CHARS = 4;

/**
 * Plain backtick words that are code-ish but too generic to anchor on their
 * own (they'd match half the repo). Dotted/camel/snake identifiers bypass this
 * — their shape already makes them distinctive.
 */
const ANCHOR_STOP_WORDS = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'string',
  'number',
  'object',
  'return',
  'import',
  'export',
  'const',
  'type',
  'when',
  'then',
  'with',
  'from',
  'that',
  'this',
  'null',
  'note',
]);

/** Push a candidate anchor if it clears the length / noise filters and is new. */
function pushAnchor(out: string[], seen: Set<string>, token: string, isPlainWord: boolean): void {
  const t = token.trim();
  if (t.length < MIN_ANCHOR_CHARS) return;
  if (/^\d+$/.test(t)) return; // pure number
  if (isPlainWord && ANCHOR_STOP_WORDS.has(t.toLowerCase())) return;
  if (seen.has(t)) return;
  seen.add(t);
  out.push(t);
}

/**
 * Extract locate-able anchors from a claim line, most-distinctive first:
 * dotted/starred config keys, then camelCase/PascalCase and snake identifiers,
 * then the plain words inside backtick spans (e.g. `backend: "lancedb"` yields
 * `backend`, `lancedb`). Free-prose plain words are deliberately NOT anchors —
 * only backtick-quoted ones — to keep the lookup from matching generic vocab.
 * Exposed for testing.
 */
export function extractAnchors(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const m of text.matchAll(DOTTED_KEY_RE)) pushAnchor(out, seen, m[0], false);
  for (const m of text.matchAll(CAMEL_ID_RE)) pushAnchor(out, seen, m[0], false);
  for (const m of text.matchAll(SNAKE_ID_RE)) pushAnchor(out, seen, m[0], false);
  for (const span of text.matchAll(BACKTICK_SPAN_RE)) {
    for (const w of span[1].matchAll(PLAIN_WORD_RE)) pushAnchor(out, seen, w[0], true);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Evidence lookup
// ---------------------------------------------------------------------------

const DOC_FILE_RE = /\.mdc?$/;
const TEST_FILE_RE = /(\.test\.|\.spec\.|\/tests?\/|__tests__|\/spec\/)/;

/**
 * Evidence-source ranking. A claim describes code the PR touched, so a changed
 * code file is the strongest locate; a changed sibling DOC is next (the
 * omission-claim case, e.g. an ADR's fuller enumeration); then any code, then
 * any doc; tests are last (a fixture rarely IS the described behavior). An
 * exact symbolName match beats every content match — that chunk is literally
 * the named symbol.
 */
const enum EvidenceTier {
  Test = 0,
  Doc = 1,
  Code = 2,
  ChangedDoc = 3,
  ChangedCode = 4,
  SymbolMatch = 5,
}

/** The union of every path this PR changed (analyzable + non-code + patched). */
function collectChangedFiles(context: ReviewContext): Set<string> {
  const files = new Set<string>(context.changedFiles ?? []);
  for (const f of context.allChangedFiles ?? []) files.add(f);
  for (const f of context.pr?.patches?.keys() ?? []) files.add(f);
  return files;
}

interface ChunkMatch {
  /** Distinct anchors present in the chunk, in the claim's anchor priority order. */
  matched: string[];
  /** True when the chunk's symbolName exactly equals one of the anchors. */
  symbolMatched: boolean;
}

/**
 * Which of `anchors` this chunk carries — by exact symbolName equality or by
 * content substring. `compare` lowercases both sides on the case-insensitive
 * fallback pass; on the (common) case-sensitive pass it is identity, so no
 * per-chunk lowercasing cost is paid.
 */
function matchChunk(
  chunk: CodeChunk,
  anchors: string[],
  compare: (s: string) => string,
): ChunkMatch | null {
  const content = compare(chunk.content);
  const symbolName = chunk.metadata.symbolName ? compare(chunk.metadata.symbolName) : undefined;
  const matched: string[] = [];
  let symbolMatched = false;
  for (const anchor of anchors) {
    const needle = compare(anchor);
    if (symbolName !== undefined && symbolName === needle) {
      symbolMatched = true;
      matched.push(anchor);
    } else if (content.includes(needle)) {
      matched.push(anchor);
    }
  }
  return matched.length > 0 ? { matched, symbolMatched } : null;
}

/** Rank a matched chunk into an evidence tier (see EvidenceTier). */
function tierOf(file: string, symbolMatched: boolean, changed: Set<string>): EvidenceTier {
  if (TEST_FILE_RE.test(file)) return EvidenceTier.Test;
  if (symbolMatched) return EvidenceTier.SymbolMatch;
  const isDoc = DOC_FILE_RE.test(file);
  const isChanged = changed.has(file);
  if (isChanged) return isDoc ? EvidenceTier.ChangedDoc : EvidenceTier.ChangedCode;
  return isDoc ? EvidenceTier.Doc : EvidenceTier.Code;
}

interface EvidenceCandidate {
  chunk: CodeChunk;
  /** All anchors the chunk carries, in the claim's anchor priority order. */
  anchors: string[];
  tier: EvidenceTier;
  matchCount: number;
}

/**
 * A single pass over `repoChunks` for the best evidence chunk: highest tier,
 * then most distinct anchors matched, keeping the FIRST such chunk in traversal
 * order (a stable, deterministic tiebreak). Chunks from `claimFile` are skipped
 * so a doc never cites itself as its own evidence.
 */
function scanForEvidence(
  anchors: string[],
  claimFile: string,
  repoChunks: CodeChunk[],
  changed: Set<string>,
  compare: (s: string) => string,
): EvidenceCandidate | null {
  let best: EvidenceCandidate | null = null;
  for (const chunk of repoChunks) {
    if (chunk.metadata.file === claimFile) continue;
    const m = matchChunk(chunk, anchors, compare);
    if (!m) continue;
    const tier = tierOf(chunk.metadata.file, m.symbolMatched, changed);
    const matchCount = m.matched.length;
    if (best && (tier < best.tier || (tier === best.tier && matchCount <= best.matchCount))) {
      continue; // strictly-better replaces only; ties keep the earlier chunk
    }
    best = { chunk, anchors: m.matched, tier, matchCount };
  }
  return best;
}

const IDENTITY = (s: string): string => s;
const LOWER = (s: string): string => s.toLowerCase();

/** Cap `text` to `max` chars, centered on `needleIndex` with ellipses when cut. */
function capCentered(text: string, needleIndex: number, max: number): string {
  if (text.length <= max) return text;
  const start = Math.min(Math.max(0, needleIndex - Math.floor(max / 2)), text.length - max);
  const excerpt = text.slice(start, start + max);
  return `${start > 0 ? '…' : ''}${excerpt}${start + max < text.length ? '…' : ''}`;
}

/** How many of `anchors` appear on one line (compare-mode aware). */
function anchorsOnLine(line: string, anchors: string[], compare: (s: string) => string): number {
  const l = compare(line);
  let n = 0;
  for (const a of anchors) if (l.includes(compare(a))) n++;
  return n;
}

/**
 * Build the excerpt for a located chunk: a ~6-line window centered on the line
 * that carries the MOST of the claim's anchors (not merely the first one). A
 * chunk can mention a generic anchor near its top and the load-bearing cluster
 * (e.g. the retired-key list the claim omits) lower down; centering on the
 * densest line lands the excerpt on the region the claim is actually about.
 * Capped at MAX_EVIDENCE_CHARS (re-centered on an anchor when the window itself
 * is too long). Any ``` is defanged so it can't break the renderer's fence.
 */
function buildExcerpt(
  chunk: CodeChunk,
  anchors: string[],
  compare: (s: string) => string,
): { startLine: number; excerpt: string; anchor: string } {
  const lines = chunk.content.split('\n');
  let bestIdx = 0;
  let bestCount = -1;
  lines.forEach((line, i) => {
    const count = anchorsOnLine(line, anchors, compare);
    if (count > bestCount) {
      bestCount = count;
      bestIdx = i;
    }
  });

  const from = Math.max(0, bestIdx - EVIDENCE_LINES_BEFORE);
  const window = lines.slice(from, bestIdx + EVIDENCE_LINES_AFTER + 1).join('\n');
  const cmpWindow = compare(window);
  const anchor = anchors.find(a => cmpWindow.includes(compare(a))) ?? anchors[0];
  const needleIndex = Math.max(0, cmpWindow.indexOf(compare(anchor)));
  const capped = capCentered(window, needleIndex, MAX_EVIDENCE_CHARS);
  return {
    startLine: chunk.metadata.startLine + from,
    excerpt: capped.replace(/```/g, "'''"),
    anchor,
  };
}

/**
 * Locate the code (or sibling doc) a single claim describes. Tries a
 * case-sensitive pass first (identifiers/keys are case-bearing), then a
 * case-insensitive fallback. Returns undefined when no anchor resolves or
 * there is no repo index to search.
 */
export function findClaimEvidence(
  claim: DocClaim,
  repoChunks: CodeChunk[] | undefined,
  changed: Set<string>,
): DocClaimEvidence | undefined {
  if (!repoChunks || repoChunks.length === 0) return undefined;
  const anchors = extractAnchors(claim.claimText);
  if (anchors.length === 0) return undefined;

  // Case-sensitive first (identifiers/keys are case-bearing); the whole
  // selection then uses that one compare mode, so the excerpt re-finds the
  // anchor consistently. Only fall back to case-insensitive when nothing
  // matched verbatim anywhere.
  const caseSensitive = scanForEvidence(anchors, claim.file, repoChunks, changed, IDENTITY);
  const candidate =
    caseSensitive ?? scanForEvidence(anchors, claim.file, repoChunks, changed, LOWER);
  if (!candidate) return undefined;

  const compare = caseSensitive ? IDENTITY : LOWER;
  const built = buildExcerpt(candidate.chunk, candidate.anchors, compare);
  return {
    file: candidate.chunk.metadata.file,
    startLine: built.startLine,
    excerpt: built.excerpt,
    anchor: built.anchor,
    fromDoc: DOC_FILE_RE.test(candidate.chunk.metadata.file),
  };
}

/**
 * Attach located evidence to each claim (up to the render cap — evidence for
 * claims that would be dropped is never computed). Returns a new array; input
 * claims are not mutated. Exposed for testing.
 */
export function attachEvidence(claims: DocClaim[], context: ReviewContext): DocClaim[] {
  const repoChunks = context.repoChunks;
  const changed = collectChangedFiles(context);
  return claims.map((claim, i) => {
    if (i >= MAX_CLAIMS) return claim; // beyond the render cap — evidence would never show
    const evidence = findClaimEvidence(claim, repoChunks, changed);
    return evidence ? { ...claim, evidence } : claim;
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const DOC_CLAIMS_HEADER =
  'Pre-computed: behavioral/structural claims this PR added to its touched ' +
  'guidance/doc surfaces (ADRs, site guides, changesets, CLAUDE.md, hooks). ' +
  'This is the doc-truth discovery step done for you — do NOT skip it; it is ' +
  'your primary claim inventory. The scan can miss claims and can list prose ' +
  'that is merely descriptive, so also skim the touched hunks for any not here. ' +
  'Most entries carry an `evidence` excerpt: the code (or a sibling doc, for ' +
  'omission claims) the claim describes, located deterministically for you — ' +
  'COMPARE the claim against that excerpt. The locator can pick the wrong site, ' +
  'so first confirm the excerpt IS the described code; then: if it CONFIRMS the ' +
  'claim, stay silent; if it CONTRADICTS the claim — or the diff changed the ' +
  'behavior and left the prose describing the OLD behavior — emit a doc-truth ' +
  'finding that QUOTES the claim and cites the falsifying fact. For an entry ' +
  'with NO evidence, locate the code yourself using material already in your ' +
  'prompt (the diff hunks, <changed_functions>, and get_files_context on the ' +
  'described symbols — it reads indexed chunks, so it works even when ' +
  'grep_codebase/read_file are blind); if it is a genuine behavioral claim you ' +
  'still cannot locate, report a warning "unverifiable behavioral claim in ' +
  'touched prose". An entry that is plainly descriptive prose (not a ' +
  'falsifiable claim about this code) needs no finding — do NOT report ' +
  'wording/style nits or manufacture a contradiction the code does not support.';

/** The no-evidence pointer appended to a claim the locator could not resolve. */
const NO_EVIDENCE_HINT =
  '  (evidence: none located — find the described code yourself via get_files_context on the named symbols/files)';

/**
 * Render one claim entry's lines: the `file: "claim"` header, then either its
 * located evidence excerpt (as a fenced block) or the no-evidence hint. Evidence
 * is suppressed with an inline note once `remaining` budget can't hold it, so
 * the claim inventory itself never gets dropped for an excerpt.
 */
function renderClaimEntry(claim: DocClaim, remaining: number): string[] {
  const header = `- ${claim.file}: "${claim.claimText}"`;
  if (!claim.evidence) return [header, NO_EVIDENCE_HINT];

  const { file, startLine, excerpt, fromDoc } = claim.evidence;
  const label = fromDoc ? 'evidence (sibling doc)' : 'evidence';
  const block = [`  ${label} — ${file}:${startLine}:`, '  ```', excerpt, '  ```'].join('\n');
  if (block.length > remaining) {
    return [
      header,
      '  (evidence located but omitted to respect the input budget — see the diff/index)',
    ];
  }
  return [header, block];
}

/**
 * Render the doc-claims worklist as a `<doc_claims>` block for the agent's
 * initial message. Returns '' when there are no claims so callers can append
 * unconditionally. Caps at MAX_CLAIMS with an explicit omission note; drops
 * per-entry evidence (never a whole claim) once MAX_DOC_CLAIMS_CHARS is hit.
 */
export function renderDocClaims(claims: DocClaim[]): string {
  if (claims.length === 0) return '';

  const lines: string[] = ['<doc_claims>', DOC_CLAIMS_HEADER];
  let used = lines.join('\n').length;
  for (const c of claims.slice(0, MAX_CLAIMS)) {
    const entry = renderClaimEntry(c, MAX_DOC_CLAIMS_CHARS - used);
    for (const line of entry) {
      lines.push(line);
      used += line.length + 1;
    }
  }
  if (claims.length > MAX_CLAIMS) {
    lines.push(
      `- [+${claims.length - MAX_CLAIMS} more claim(s) omitted to respect the input budget — skim the touched doc hunks for any not listed]`,
    );
  }
  lines.push('</doc_claims>');
  return lines.join('\n');
}

/**
 * Build the `<doc_claims>` section from the review context. Returns '' when
 * there is no diff or no changed guidance/doc surface with a claim-shaped line.
 * Each rendered claim carries a deterministically-located code/sibling-doc
 * evidence excerpt when one is found in the repo index.
 */
export function renderDocClaimsSection(context: ReviewContext): string {
  const patches = context.pr?.patches;
  if (!patches || patches.size === 0) return '';
  return renderDocClaims(attachEvidence(extractDocClaims(patches), context));
}
