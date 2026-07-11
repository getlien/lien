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

/** A claim-shaped line the diff added to a guidance/doc surface. */
export interface DocClaim {
  /** Repo-relative path of the guidance/doc surface the claim was added to. */
  file: string;
  /** The added line, trimmed and capped (see MAX_CLAIM_CHARS). */
  claimText: string;
  /** Which claim shape matched — most-specific-first (see CLAIM_SHAPES). */
  shape: DocClaimShape;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cap the worklist so the prompt stays compact (protects the input budget). */
const MAX_CLAIMS = 20;
/** Per-claim character cap — a claim line is a pointer, not the whole hunk. */
const MAX_CLAIM_CHARS = 200;

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
// Rendering
// ---------------------------------------------------------------------------

const DOC_CLAIMS_HEADER =
  'Pre-computed: behavioral/structural claims this PR added to its touched ' +
  'guidance/doc surfaces (ADRs, site guides, changesets, CLAUDE.md, hooks). ' +
  'This is the doc-truth discovery step done for you — do NOT skip it; it is ' +
  'your primary claim inventory. The scan can miss claims and can list prose ' +
  'that is merely descriptive, so also skim the touched hunks for any not here. ' +
  'For EACH entry: locate the code it describes using material already in your ' +
  'prompt (the diff hunks, <changed_functions>, and get_files_context on the ' +
  'described symbols — it reads indexed chunks, so it works even when ' +
  'grep_codebase/read_file are blind). Then: if the code CONFIRMS the claim, ' +
  'stay silent on it; if the code CONTRADICTS it — or the diff changed the ' +
  'behavior and left the prose describing the OLD behavior — emit a doc-truth ' +
  'finding that QUOTES the claim and cites the falsifying code fact; if the ' +
  'entry is a genuine behavioral claim you cannot locate the code for, report ' +
  'it as a warning "unverifiable behavioral claim in touched prose". An entry ' +
  'that is plainly descriptive prose (not a falsifiable claim about this code) ' +
  'needs no finding — do NOT report wording/style nits or manufacture a ' +
  'contradiction the code does not support.';

/**
 * Render the doc-claims worklist as a `<doc_claims>` block for the agent's
 * initial message. Returns '' when there are no claims so callers can append
 * unconditionally. Caps at MAX_CLAIMS with an explicit omission note (never a
 * silent drop).
 */
export function renderDocClaims(claims: DocClaim[]): string {
  if (claims.length === 0) return '';

  const lines: string[] = ['<doc_claims>', DOC_CLAIMS_HEADER];
  for (const c of claims.slice(0, MAX_CLAIMS)) {
    lines.push(`- ${c.file}: "${c.claimText}"`);
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
 */
export function renderDocClaimsSection(context: ReviewContext): string {
  const patches = context.pr?.patches;
  if (!patches || patches.size === 0) return '';
  return renderDocClaims(extractDocClaims(patches));
}
