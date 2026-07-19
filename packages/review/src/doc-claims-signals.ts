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
 *
 * `citedPath` (issue #749) handles the doc-that-cites-its-own-source shape: on
 * PR #748, 3 of 4 doc-truth findings were the model flagging "the code proving
 * this could not be located" against prose that named its own evidence file
 * (e.g. "see `packages/review/src/defaults.ts` for the source of truth") — the
 * evidence pre-fetch never treated the citation as an anchor, so the model
 * never saw the file and flagged absence-of-verification as if it were
 * falsehood. When a claim's own excerpt names a repo file, that citation
 * outranks every other evidence tier (a claim that ships its own pointer
 * should arrive pre-verified), and a citation that does NOT resolve gets a
 * one-line "not found" note instead — a stale citation is itself doc-truth
 * signal, not something to search around.
 *
 * `collectClaimSources`/`addedCodeCommentLines` widen extraction to changed CODE files (not just
 * guidance/doc surfaces) — motivated by pr658's Finding A, the canonical case
 * this widening exists to catch: the stale `embeddings.enabled` doc COMMENT
 * in `packages/core/src/config/schema.ts`, an ordinary source file that
 * `collectGuidanceSurfaceChanges` never looks at, so the claim was never
 * LISTED for any contract (v1's open findings list or v2's per-claim one) to
 * force engagement with. The scan stays tight to the same claim-shaped-prose
 * discipline as the doc-surface scan, but the LINE shape narrows further: a
 * changed code file's added line only counts when it reads as a comment,
 * docstring, or description-valued string literal (`.describe(...)`,
 * `description: "..."` — the zod/JSON-schema shape) — ordinary code is never
 * scanned. TODOs, attribution lines, and doc-comment tags (`@param`, …) are
 * excluded before classification even though they're comment-shaped: a TODO
 * describes intended/future work, not a claim about current behavior (see
 * `extractCommentProse`). Claims mined this way share the render/render-cap
 * pipeline with doc-surface claims but are capped separately
 * (`MAX_CODE_CLAIMS`) so a comment-heavy code diff can't crowd out the
 * doc-surface claims that are the historically reliable signal.
 *
 * `findCitedPathDiffEvidence` widens evidence PREFETCH for a claim's own file
 * citation (`DocClaim.citedPath`) to the PR's own diff, not just the indexed
 * `repoChunks`. Motivated by PR #811's own review: a doc claim cited
 * `.github/workflows/lien-review.yml`, which WAS part of that PR's diff but
 * is not an AST-analyzable language, so it never appears in `repoChunks` —
 * the doc-truth pass reported "not available in the review material… before
 * budget exhaustion" instead of comparing against the one hunk that would
 * have settled it in one read. When a citation names a file that's part of
 * THIS PR, its diff hunk is fetched directly (byte-capped like every other
 * signal) in preference to any indexed excerpt — the diff is the more
 * PR-relevant material and needs no index entry to exist. Falls back to the
 * existing indexed-chunk lookup when the cited file isn't part of the diff,
 * and to the existing "not found" note (now naming both sources checked)
 * when neither resolves — degrading loudly rather than silently omitting.
 */

import type { CodeChunk } from '@liendev/parser';
import type { ReviewContext } from './plugin-types.js';
import { collectGuidanceSurfaceChanges, isGuidanceSurface } from './guidance-surface-signals.js';
import { filterAnalyzableFiles } from './analysis.js';

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
  /**
   * True when this entry is a one-line "cited file not found" note rather
   * than a located excerpt — the claim named its own evidence file (see
   * `DocClaim.citedPath`) but that file resolves against neither the PR's
   * own diff nor `repoChunks`. `file` carries the cited (unresolved) path;
   * `excerpt` is unused. A stale citation is itself doc-truth signal (issue
   * #749).
   */
  citedPathMissing?: boolean;
  /**
   * True when this evidence is the cited file's raw PR diff hunk (referenced-
   * file evidence prefetch) rather than an indexed chunk excerpt — the file
   * is part of THIS PR's diff but was not necessarily analyzable/indexed
   * (e.g. a workflow YAML, see PR #811). Always false alongside `fromDoc`
   * (a diff hunk isn't chunk-sourced).
   */
  fromDiff?: boolean;
}

/**
 * An explicit repo-file citation found in a claim's own excerpt — "see
 * `packages/review/src/defaults.ts`" — plus, when present, an adjacent
 * backticked identifier in the same excerpt that narrows which chunk of that
 * file is the described one (issue #749). See `extractCitedPath`.
 */
export interface DocClaimCitedPath {
  /** The path token as it appeared in the claim excerpt (repo-relative). */
  path: string;
  /** An adjacent backticked identifier in the same excerpt, if any. */
  symbol?: string;
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
   * An explicit file citation the claim's own excerpt names, if any. When
   * present it takes priority over every other evidence tier — see
   * `findClaimEvidence`.
   */
  citedPath?: DocClaimCitedPath;
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
/**
 * Separate, smaller cap on claims mined from changed CODE files (comments/
 * docstrings/description literals — see `claimsFromSource`). Kept apart
 * from `MAX_CLAIMS` so a comment-heavy code diff cannot crowd out doc-surface
 * claims, the historically reliable signal, from the render cap above.
 */
const MAX_CODE_CLAIMS = 10;
/** Per-claim character cap — a claim line is a pointer, not the whole hunk. */
const MAX_CLAIM_CHARS = 200;
/** Per-claim evidence excerpt cap — enough to carry the described code, not a hunk. */
const MAX_EVIDENCE_CHARS = 400;
/** Lines of context above / below the anchor line in an evidence excerpt (~6-line window).
 *  Exported for reuse by docs-drift-signals.ts's own excerpt/tier windowing. */
export const EVIDENCE_LINES_BEFORE = 2;
export const EVIDENCE_LINES_AFTER = 3;
/**
 * Total budget for the whole `<doc_claims>` block. Evidence excerpts are
 * dropped (with an inline note) before any claim is dropped, so the worklist
 * itself always survives even on a doc-heavy PR.
 */
const MAX_DOC_CLAIMS_CHARS = 8_000;

const HUNK_META_RE = /^(?:\+\+\+|---)/;
/** A fenced code block opener/closer — claims are prose, not code samples. Exported for reuse
 *  by docs-drift-signals.ts, which tracks fence state over a plain doc chunk the same way this
 *  module tracks it over a diff's post-image lines. */
export const FENCE_RE = /^(?:```|~~~)/;

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

/** Return the first matching claim shape for a prose line, or null. Exported (behavior-neutral)
 *  for reuse as docs-drift-signals.ts's Tier-1 behavioral-claim detector — see that module. */
export function classifyClaim(text: string): { shape: DocClaimShape; matchIndex: number } | null {
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

/** Extract classified claim lines already reduced to candidate prose (either a doc surface's
 *  added prose lines, or a code file's added comment/docstring/description lines — see the two
 *  callers below). */
function extractClaims(file: string, lines: string[]): DocClaim[] {
  const claims: DocClaim[] = [];
  for (const raw of lines) {
    const text = stripLinkTargets(raw);
    const match = classifyClaim(text);
    if (!match) continue;
    const claimText = toClaimText(text, match.matchIndex);
    // Extract the citation from the FULL line, not the windowed claimText:
    // match-centered capping routinely cuts a trailing "see path/to/file.ts"
    // out of the excerpt, which is exactly where citations live (found by
    // replaying the fix against PR #748, the issue's motivating case).
    const citedPath = extractCitedPath(text);
    claims.push({ file, claimText, shape: match.shape, ...(citedPath && { citedPath }) });
  }
  return claims;
}

// ---------------------------------------------------------------------------
// Code-file comment/docstring/description-literal extraction (widened
// claim-discovery surface — see this module's header for the pr658 motivation)
// ---------------------------------------------------------------------------

/** A `//` or `#` line comment — NOT a Rust/C++ doc-comment (`///`/`//!`, handled separately so
 *  that convention stays visually distinguishable) or a shebang/preprocessor directive
 *  (`#!`, `#include`, `#pragma`, `#region`/`#endregion`) — those aren't prose. */
const LINE_COMMENT_RE = /^(?:\/\/(?![!/])|#(?!!|include\b|pragma\b|region\b|endregion\b))\s?(.*)$/;
/** A Rust/C++ doc-comment: `///` (outer) or `//!` (inner). */
const DOC_COMMENT_RE = /^\/\/[!/]\s?(.*)$/;
/** A JSDoc/block-comment CONTINUATION line: a leading `*` that is not the comment's closing line. */
const BLOCK_CONT_RE = /^\*(?!\/)\s?(.*)$/;
/** A block-comment opener (`/**` or `/*`), with any same-line trailing text. The trailing
 *  optional group strips a same-line CLOSING marker off a single-line block comment so it
 *  doesn't leak into the captured prose — `\*+` (one or more stars) so a closer with extra
 *  stars (e.g. a doc-comment ending in a doubled star before the slash) is stripped in full
 *  rather than leaving a stray star behind; a multi-line opener with no closer on this line
 *  (just trailing text) still captures correctly since that group is optional. */
const BLOCK_OPEN_RE = /^\/\*\*?\s?(.*?)(?:\s*\*+\/)?$/;
/** A Python/Rust-style triple-quoted docstring delimiter, with any same-line trailing text. Same
 *  optional-trailing-closer handling as `BLOCK_OPEN_RE`, for a same-line one-liner docstring. */
const TRIPLE_QUOTE_RE = /^(?:"""|''')\s?(.*?)(?:"""|''')?$/;

/** Comment/docstring line shapes, most-specific first (first match wins). */
const COMMENT_LINE_MATCHERS: readonly RegExp[] = [
  DOC_COMMENT_RE,
  LINE_COMMENT_RE,
  BLOCK_CONT_RE,
  BLOCK_OPEN_RE,
  TRIPLE_QUOTE_RE,
];

/** A zod-style `.describe('...')` call — the config-schema-description shape (Finding A's
 *  sibling case: a description string rather than a doc COMMENT). Single-line only (KISS) — a
 *  description string that wraps onto its own line inside a multi-line `.describe(\n  '...'\n)`
 *  call is not extracted; the canonical, acceptance-tested case (pr658's schema.ts) is a plain
 *  comment line, not this shape. The alternation's first branch (`\\.`) consumes an escaped char
 *  (e.g. `\'`) as a pair so the string doesn't appear to close early on an escaped quote. */
const DESCRIBE_CALL_RE = /\.describe\(\s*(['"`])((?:\\.|(?!\1).)*)\1/;
/** A `description: '...'` object-literal key — the JSON-schema-description shape. Same
 *  single-line-only scope and escaped-delimiter handling as `DESCRIBE_CALL_RE`. */
const DESCRIPTION_KEY_RE = /\bdescription\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/;

/**
 * Comment-shaped lines that are NOT the claim-shaped prose this scan wants, excluded before
 * classification (the "when in doubt, exclude" discipline this module's header calls for on the
 * newly-widened, noisier code-comment surface):
 *  - a TODO/FIXME/XXX/HACK note — describes INTENDED/future work, not current behavior, so a
 *    claim-shaped TODO ("TODO: should default to 32") would otherwise false-classify as a claim
 *    about what the code does NOW;
 *  - an attribution/authorship line;
 *  - a doc-comment TAG (`@param`, `@returns`, `@example`, …) — structural metadata, not a
 *    behavioral sentence, even though some tags read as imperative prose.
 */
const NOISE_LINE_RE = /^(?:TODO|FIXME|XXX|HACK)\b[:.]?/i;
const ATTRIBUTION_RE = /^(?:copyright\b|co-authored-by|signed-off-by)/i;
const TAG_LINE_RE = /^@\w+\b/;

/**
 * Apply the shared claim-candidate noise filter (TODO/attribution/doc-tag — see the constants
 * above) to already-extracted comment/docstring prose, returning the trimmed text or undefined
 * when it's empty or noise. Split out of `extractCommentProse` so the multi-line CONTINUATION
 * path in `addedCodeCommentLines` (see `OpenComment` below) can apply the identical exclusion
 * rules to a line that never goes through `extractCommentProse`'s own single-line matchers.
 */
function filterNoiseProse(text: string): string | undefined {
  const trimmed = text.trim();
  if (
    !trimmed ||
    NOISE_LINE_RE.test(trimmed) ||
    ATTRIBUTION_RE.test(trimmed) ||
    TAG_LINE_RE.test(trimmed)
  ) {
    return undefined;
  }
  return trimmed;
}

/**
 * Extract claim-candidate prose from one line of a code file's patch, or undefined when the line
 * is not a comment/docstring/description-literal shape (ordinary code) or is noise (see above). A
 * `.describe(...)`/`description: "..."` match is checked FIRST since those lines are otherwise
 * ordinary code; everything else must additionally read as a comment/docstring line. Exposed for
 * testing.
 */
export function extractCommentProse(rawLine: string): string | undefined {
  const line = rawLine.trim();
  if (!line) return undefined;

  const described = DESCRIBE_CALL_RE.exec(line) ?? DESCRIPTION_KEY_RE.exec(line);
  const prose = described
    ? described[2]
    : COMMENT_LINE_MATCHERS.map(re => re.exec(line)?.[1]).find(p => p !== undefined);
  if (prose === undefined) return undefined;

  return filterNoiseProse(prose);
}

/**
 * Which multi-line comment/docstring construct is still open after a line, carried forward to
 * the NEXT line — `null` when not inside one. Tracking this (over `newFileLines`' full context +
 * added view, mirroring `addedProseLines`' own `inFence` tracking) is what closes the deferred
 * gap from PR #814 (CodeRabbit, "Heavy lift"): `extractCommentProse`'s per-line matchers require
 * an interior line to repeat a marker (a leading `*` for a block comment, a `"""`/`'''` for a
 * docstring) — so an UNMARKED continuation line, or a docstring's un-decorated body lines, match
 * nothing and were silently dropped even though they're unambiguously still inside the comment.
 */
type OpenComment = { kind: 'block' } | { kind: 'docstring'; delim: '"""' | "'''" };

/** A block-comment closer anywhere at the END of a (trimmed) line: one-or-more `*` then `/`,
 *  optionally followed by trailing whitespace — the same shape `BLOCK_OPEN_RE`'s own optional
 *  trailing group matches, reused here to detect a same-line close on a FRESH opener line and an
 *  eventual close on a CONTINUATION line. */
const BLOCK_CLOSE_AT_END_RE = /\*+\/\s*$/;

/** Strip a conventional (optional) leading `*` continuation marker so a continuation line reads
 *  the same whether or not it follows the JSDoc `* prose` convention — the fix must not REQUIRE
 *  the marker, but a line that still carries it shouldn't leak a stray `*` into the prose. */
function stripBlockMarker(text: string): string {
  return text.replace(/^\*\s?/, '');
}

/**
 * Does a FRESH (non-continuation) trimmed line OPEN a block-comment/docstring construct WITHOUT
 * also closing it on the same line — i.e., is this the first line of a genuinely multi-line
 * construct whose interior lines need continuation tracking? Returns the construct to carry
 * forward, or null when the line isn't an opener at all, or opens and closes on one line (the
 * pre-existing single-line-block/docstring shapes `extractCommentProse` already handles fully).
 */
function detectOpen(text: string): OpenComment | null {
  if (BLOCK_OPEN_RE.test(text)) return BLOCK_CLOSE_AT_END_RE.test(text) ? null : { kind: 'block' };
  for (const delim of ['"""', "'''"] as const) {
    if (text.startsWith(delim)) {
      return text.slice(delim.length).includes(delim) ? null : { kind: 'docstring', delim };
    }
  }
  return null;
}

/**
 * Does a CONTINUATION line (reached while `open` is already active) close its construct on this
 * line, and if so, what's the prose BEFORE the closer? Returns undefined when the line does NOT
 * close — the caller then treats the whole line as interior prose and keeps `open` active.
 */
function closingProse(text: string, open: OpenComment): string | undefined {
  if (open.kind === 'block') {
    const m = /^(.*?)\*+\/\s*$/.exec(text);
    return m ? stripBlockMarker(m[1]).trim() : undefined;
  }
  const idx = text.indexOf(open.delim);
  return idx === -1 ? undefined : text.slice(0, idx).trim();
}

/**
 * The candidate-claim prose lines of one changed CODE file's patch: ADDED lines whose text is a
 * comment, docstring, or description-valued string literal (see `extractCommentProse`) — never
 * arbitrary code. This is the widened surface pr658's Finding A motivated: a JSDoc comment on a
 * `LienConfig` field in `packages/core/src/config/schema.ts`, an ordinary source file the
 * doc-surface-only scan could never see.
 *
 * Tracks `OpenComment` state across the patch's full NEW-file view (context + added, like
 * `addedProseLines`' fence tracking) so an interior CONTINUATION line — whether or not it repeats
 * a `*`/triple-quote marker, and even when the construct's OPENING line was unmodified context —
 * still contributes its prose (the multi-line gap this widening closes; see `OpenComment`).
 * Exposed for testing.
 */
export function addedCodeCommentLines(patch: string): string[] {
  const out: string[] = [];
  let open: OpenComment | null = null;

  for (const { text, isAdded } of newFileLines(patch)) {
    const trimmed = text.trim();
    let prose: string | undefined;

    if (open) {
      const closed = closingProse(trimmed, open);
      prose = filterNoiseProse(
        closed ?? (open.kind === 'block' ? stripBlockMarker(trimmed) : trimmed),
      );
      if (closed !== undefined) open = null;
    } else {
      prose = extractCommentProse(text);
      open = detectOpen(trimmed);
    }

    if (isAdded && prose) out.push(prose);
  }

  return out;
}

/** One claim source to scan: a changed file's patch, tagged with which line-extraction mode
 *  applies (`addedProseLines` for a guidance/doc surface, `addedCodeCommentLines` for code). */
interface ClaimSource {
  file: string;
  patch: string;
  mode: 'guidance' | 'code';
}

/**
 * Every changed file worth scanning for claims — guidance/doc surfaces (`collectGuidanceSurfaceChanges`)
 * PLUS non-guidance changed files with an analyzable code extension (`filterAnalyzableFiles`,
 * the same "code file" definition `review-pr.ts` uses) — merged into ONE smallest-hunk-first
 * order. A single fairness ordering (rather than "all doc surfaces, then all code files") means a
 * small, surgical code-comment change (pr658's schema.ts: one line) ranks ahead of a large
 * doc-surface rewrite purely on hunk size, the same budget-fairness rationale
 * `collectGuidanceSurfaceChanges` already documents.
 */
function collectClaimSources(patches: Map<string, string>): ClaimSource[] {
  const guidance: ClaimSource[] = collectGuidanceSurfaceChanges(patches).map(c => ({
    ...c,
    mode: 'guidance',
  }));
  const codeFiles = filterAnalyzableFiles([...patches.keys()]).filter(f => !isGuidanceSurface(f));
  const code: ClaimSource[] = codeFiles.map(file => ({
    file,
    patch: patches.get(file) ?? '',
    mode: 'code',
  }));
  return [...guidance, ...code].sort((a, b) => a.patch.length - b.patch.length);
}

/** Extract every candidate claim for one source — no cap, no dedup (see `extractDocClaims`,
 *  which applies both, in that order, AFTER extraction so a duplicate never spends code-claim
 *  budget it never needed). Split out of `extractDocClaims` purely to keep that function's own
 *  branching shallow. */
function claimsFromSource(source: ClaimSource): DocClaim[] {
  const lines =
    source.mode === 'guidance'
      ? addedProseLines(source.patch)
      : addedCodeCommentLines(source.patch);
  return extractClaims(source.file, lines);
}

/**
 * Build a per-extraction-run admit predicate: true (and records the claim as seen) iff `claim`
 * is net-new (not a duplicate already admitted) AND, for a code-derived claim, still within the
 * `MAX_CODE_CLAIMS` budget. Cap-checking runs AFTER the dedup check — not via a pre-dedup slice
 * on each source's own candidate list — so a source's own duplicate of an already-seen claim
 * (e.g. the same `.describe(...)` string copy-pasted across sibling schema files) never spends
 * code-claim budget a later, genuinely new claim could have used.
 */
function claimAdmitter(): (claim: DocClaim, mode: ClaimSource['mode']) => boolean {
  const seen = new Set<string>();
  let codeClaimCount = 0;
  return (claim, mode) => {
    if (mode === 'code' && codeClaimCount >= MAX_CODE_CLAIMS) return false;
    if (seen.has(claim.claimText)) return false;
    seen.add(claim.claimText);
    if (mode === 'code') codeClaimCount++;
    return true;
  };
}

/**
 * Collect claim-shaped lines from every changed guidance/doc surface AND changed code file
 * (comments/docstrings/description literals only — see `collectClaimSources`), smallest hunk
 * first. Identical claim lines are deduped across both sources (see `claimAdmitter`).
 * Code-derived claims are capped separately at `MAX_CODE_CLAIMS` so a comment-heavy code diff
 * cannot crowd out doc-surface claims. Returns ALL claims up to that cap (uncapped for
 * doc-surface claims — the render layer applies `MAX_CLAIMS` and notes any overflow). Exposed
 * for testing.
 */
export function extractDocClaims(patches: Map<string, string>): DocClaim[] {
  const claims: DocClaim[] = [];
  const admit = claimAdmitter();

  for (const source of collectClaimSources(patches)) {
    for (const claim of claimsFromSource(source)) {
      if (admit(claim, source.mode)) claims.push(claim);
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
// Cited-path extraction (issue #749)
// ---------------------------------------------------------------------------

/**
 * A repo-file-shaped token: a path/filename ending in a recognized source or
 * doc extension. Not anchored to `/` on purpose — a bare cited filename
 * (`defaults.ts`) is still a citation, just a less specific one; resolution
 * against the corpus (see `findCitedPathEvidence`) is the real precision gate,
 * not the shape regex.
 */
const CITED_PATH_RE = /[\w./-]+\.(?:ts|tsx|js|jsx|py|go|rs|rb|php|md|yml|yaml|json)\b/;
/** A backtick span that reads as a plain identifier, not a path — used to tell
 *  an adjacent symbol citation apart from the cited path itself. */
const SYMBOL_SPAN_RE = /^[A-Za-z_$][\w$]*$/;

/**
 * Extract an explicit repo-file citation from a claim's own excerpt, plus an
 * adjacent backticked identifier in the same excerpt (if any) to narrow which
 * chunk of that file is the described one. Both the backtick form
 * ("see `packages/review/src/defaults.ts`") and the markdown-link form whose
 * display text is the path itself ("[packages/review/src/defaults.ts](../..)")
 * parse identically here, since both leave a bare path token in `text` once
 * `stripLinkTargets` and backtick delimiters are out of the way. A bare word
 * with no extension/path shape (e.g. "defaults") never matches. Exposed for
 * testing.
 */
export function extractCitedPath(text: string): DocClaimCitedPath | undefined {
  const m = CITED_PATH_RE.exec(text);
  if (!m) return undefined;
  const path = m[0].replace(/^\/+/, '');

  for (const span of text.matchAll(BACKTICK_SPAN_RE)) {
    const candidate = span[1].trim();
    if (candidate !== path && SYMBOL_SPAN_RE.test(candidate)) return { path, symbol: candidate };
  }
  return { path };
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
 * any doc. Among NON-TEST files, an exact symbolName match beats every content
 * match — that chunk is literally the named symbol. Test files always rank
 * last, even on a symbolName match: a same-named helper in a test fixture is a
 * collision, not the described behavior (see tierOf's early return).
 *
 * `SameFile` outranks everything (bar the Test demotion): for a CODE-sourced
 * claim (a comment scanned from a changed code file — see
 * `addedCodeCommentLines`), the file the comment itself lives in is the
 * described field's own declaration, the strongest possible locate. Reachable
 * only for a code claim file — `scanForEvidence` still excludes a GUIDANCE/doc
 * surface's own chunks entirely (a doc citing its own paragraph proves
 * nothing), so this tier never applies there. Bug found during Finding A's
 * re-certification (post-#814): before this tier existed, `scanForEvidence`
 * excluded the claim's own file unconditionally, so a schema.ts comment claim
 * could be corroborated against an unrelated neighbor file that happened to
 * share the same wording, instead of schema.ts's own field.
 */
const enum EvidenceTier {
  Test = 0,
  Doc = 1,
  Code = 2,
  ChangedDoc = 3,
  ChangedCode = 4,
  SymbolMatch = 5,
  SameFile = 6,
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

/** Rank a matched chunk into an evidence tier (see EvidenceTier). `claimFile` only ever equals
 *  `file` here for a CODE-sourced claim — `scanForEvidence` excludes a guidance/doc surface's own
 *  file before this is called, so `SameFile` never applies to a doc claim. */
function tierOf(
  file: string,
  claimFile: string,
  symbolMatched: boolean,
  changed: Set<string>,
): EvidenceTier {
  if (TEST_FILE_RE.test(file)) return EvidenceTier.Test;
  if (file === claimFile) return EvidenceTier.SameFile;
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
 * ONLY when `claimFile` is itself a guidance/doc surface, so a doc never cites
 * itself as its own evidence — a CODE-sourced claim's own file stays eligible
 * (and, per `tierOf`'s `SameFile` tier, wins outright) since that file is
 * exactly where the comment's described code lives.
 */
function scanForEvidence(
  anchors: string[],
  claimFile: string,
  repoChunks: CodeChunk[],
  changed: Set<string>,
  compare: (s: string) => string,
): EvidenceCandidate | null {
  const excludeSelf = isGuidanceSurface(claimFile);
  let best: EvidenceCandidate | null = null;
  for (const chunk of repoChunks) {
    if (excludeSelf && chunk.metadata.file === claimFile) continue;
    const m = matchChunk(chunk, anchors, compare);
    if (!m) continue;
    const tier = tierOf(chunk.metadata.file, claimFile, m.symbolMatched, changed);
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
 * Which chunk of a cited file is the described one: the chunk containing the
 * adjacent symbol (by exact symbolName or content match) when one was
 * captured, else the file's best keyword-overlap chunk against the claim's
 * own anchors (ties keep the first chunk in traversal order). `centerOn` is
 * always non-empty so `buildExcerpt` always has something to center on.
 */
function pickCitedChunk(
  fileChunks: CodeChunk[],
  symbol: string | undefined,
  keywordAnchors: string[],
): { chunk: CodeChunk; centerOn: string[] } {
  if (symbol) {
    const bySymbol = fileChunks.find(
      c => c.metadata.symbolName === symbol || c.content.includes(symbol),
    );
    if (bySymbol) return { chunk: bySymbol, centerOn: [symbol] };
  }

  let best = fileChunks[0];
  let bestCount = -1;
  for (const c of fileChunks) {
    const count = keywordAnchors.filter(a => c.content.includes(a)).length;
    if (count > bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return {
    chunk: best,
    centerOn: keywordAnchors.length > 0 ? keywordAnchors : [best.metadata.file],
  };
}

// ---------------------------------------------------------------------------
// Referenced-file evidence prefetch (issue: PR #811's own review)
// ---------------------------------------------------------------------------

/** Cap on a prefetched referenced-file diff-hunk excerpt. Bigger than `MAX_EVIDENCE_CHARS`
 *  since a raw hunk carries diff punctuation/context an indexed-chunk excerpt doesn't, but still
 *  bounded — mirrors `guidance-surface-signals.ts`'s own per-file cap discipline for the same
 *  shape of problem (one huge referenced file must not dominate the block). */
const MAX_DIFF_EVIDENCE_CHARS = 800;

/** The NEW-file starting line of a patch's FIRST hunk (`@@ -a,b +START,len @@`), or 0 when the
 *  header can't be parsed — best-effort, since a raw hunk (unlike an indexed chunk) carries no
 *  authoritative line-number metadata of its own. */
function firstHunkNewStartLine(patch: string): number {
  const m = /^@@ -\d+(?:,\d+)? \+(\d+)/m.exec(patch);
  return m ? Number(m[1]) : 0;
}

/** One hunk of a unified-diff patch: its raw text (header + body, verbatim) and the NEW-file
 *  starting line its header declares. */
interface DiffHunk {
  text: string;
  newStartLine: number;
}

/** A unified-diff hunk header: `@@ -a,b +START,len @@`. */
const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)/;

/**
 * Split a raw patch into its individual hunks, each starting at its own `@@ ... @@` header —
 * needed so `buildDiffEvidence` can center the excerpt on the hunk relevant to the claim instead
 * of always taking the patch's first `MAX_DIFF_EVIDENCE_CHARS` (the deferred PR #814 gap: a
 * multi-hunk file's relevant hunk can sort anywhere, and the naive head-slice can miss it
 * entirely). Falls back to treating the WHOLE patch as one hunk when no header is found
 * (defensive — every real patch has at least one).
 */
function splitHunks(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: string[] = [];
  let currentStart = 0;

  for (const line of patch.split('\n')) {
    const m = HUNK_HEADER_RE.exec(line);
    if (m) {
      if (current.length > 0) hunks.push({ text: current.join('\n'), newStartLine: currentStart });
      current = [line];
      currentStart = Number(m[1]);
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) hunks.push({ text: current.join('\n'), newStartLine: currentStart });

  return hunks.length > 0 ? hunks : [{ text: patch, newStartLine: firstHunkNewStartLine(patch) }];
}

/**
 * Pick the hunk most relevant to `anchors` (the claim's cited symbol, or its extracted keyword
 * anchors) — the hunk with the most anchor hits, ties keeping the FIRST/earliest hunk (a stable,
 * deterministic tiebreak). Falls back to the first hunk when there are no anchors to rank by,
 * preserving the pre-existing head-of-patch behavior for an anchor-less citation.
 */
function pickRelevantHunk(hunks: DiffHunk[], anchors: string[]): DiffHunk {
  if (anchors.length === 0) return hunks[0];
  let best = hunks[0];
  let bestHits = -1;
  for (const hunk of hunks) {
    const hits = anchors.reduce((n, a) => n + (hunk.text.includes(a) ? 1 : 0), 0);
    if (hits > bestHits) {
      bestHits = hits;
      best = hunk;
    }
  }
  return best;
}

/** Build diff-hunk evidence for a cited file that's part of THIS PR (see
 *  `findCitedPathDiffEvidence`): picks the hunk most relevant to `anchors` (the cited symbol, or
 *  the claim's own keyword anchors — see `pickRelevantHunk`) rather than always the patch's
 *  first bytes, then byte-caps that hunk centered on the anchor (`capCentered`, the same
 *  centering primitive `buildExcerpt` uses for indexed-chunk evidence). Tagged `fromDiff` so the
 *  renderer frames it as a diff rather than a plain source excerpt. */
function buildDiffEvidence(file: string, patch: string, anchors: string[] = []): DocClaimEvidence {
  const hunk = pickRelevantHunk(splitHunks(patch), anchors);
  const needleIndex = anchors
    .map(a => hunk.text.indexOf(a))
    .filter(i => i >= 0)
    .sort((a, b) => a - b)[0];
  const capped = capCentered(hunk.text, needleIndex ?? 0, MAX_DIFF_EVIDENCE_CHARS);
  const excerpt =
    hunk.text.length > MAX_DIFF_EVIDENCE_CHARS
      ? `${capped}\n[diff truncated to respect the input budget]`
      : capped;
  return {
    file,
    startLine: hunk.newStartLine,
    excerpt: excerpt.replace(/```/g, "'''"),
    anchor: file,
    fromDoc: false,
    fromDiff: true,
  };
}

/**
 * Resolve a claim's file citation against the PR's OWN diff (`context.pr.patches`) — the
 * referenced-file evidence prefetch this section is named for. Motivated by PR #811's own
 * review: a doc claim cited `.github/workflows/lien-review.yml`, which WAS part of that PR's
 * diff but isn't an AST-analyzable language, so it never reaches `repoChunks` and the indexed-
 * chunk lookup below can never find it — yet the exact material to verify the claim was sitting
 * in the diff the whole time. Resolution mirrors the indexed-chunk lookup's own leniency (exact
 * path, or a path this cited path is a suffix of). Returns undefined when there is no `patches`
 * map or the cited path isn't one of its keys, so the caller falls through to the indexed-chunk
 * lookup (see `findCitedPathEvidence`).
 */
/**
 * Resolve `citedPath` against `candidates`: an EXACT match always wins (checked first,
 * regardless of iteration order); otherwise a suffix match (`candidate.endsWith('/' + citedPath)`)
 * is accepted only when EXACTLY ONE candidate qualifies — a citation ambiguous between two
 * same-named files in different directories should attach to neither rather than an arbitrary
 * one. Returns undefined when nothing (or more than one suffix candidate) qualifies.
 */
function resolveExactOrUniqueSuffix(
  candidates: readonly string[],
  citedPath: string,
): string | undefined {
  const exact = candidates.find(f => f === citedPath);
  if (exact) return exact;
  const suffixMatches = candidates.filter(f => f.endsWith(`/${citedPath}`));
  return suffixMatches.length === 1 ? suffixMatches[0] : undefined;
}

function findCitedPathDiffEvidence(
  cited: DocClaimCitedPath,
  claimText: string,
  patches: Map<string, string> | undefined,
): DocClaimEvidence | undefined {
  if (!patches) return undefined;
  const matchedFile = resolveExactOrUniqueSuffix([...patches.keys()], cited.path);
  if (!matchedFile) return undefined;
  const anchors = cited.symbol ? [cited.symbol] : extractAnchors(claimText);
  return buildDiffEvidence(matchedFile, patches.get(matchedFile) ?? '', anchors);
}

/**
 * Resolve a claim's own file citation (see `DocClaim.citedPath`) against, in priority order: the
 * PR's own diff (`findCitedPathDiffEvidence` — the referenced-file evidence prefetch, preferred
 * when available since it's the more PR-relevant material and needs no index entry to exist),
 * then the repo index. A citation is authoritative — a claim that ships its own pointer should
 * arrive pre-verified — so a resolved hit from EITHER source is returned directly, bypassing the
 * generic anchor/tier scan entirely (it outranks every tier). When the cited path resolves
 * against NEITHER, returns a one-line `citedPathMissing` note instead: a stale citation is itself
 * doc-truth signal, not something to search around (issue #749) — degrading loudly rather than
 * silently omitting.
 */
function findCitedPathEvidence(
  cited: DocClaimCitedPath,
  claimText: string,
  repoChunks: CodeChunk[] | undefined,
  patches: Map<string, string> | undefined,
): DocClaimEvidence {
  const diffEvidence = findCitedPathDiffEvidence(cited, claimText, patches);
  if (diffEvidence) return diffEvidence;

  const resolvedFile = repoChunks?.find(
    c => c.metadata.file === cited.path || c.metadata.file.endsWith(`/${cited.path}`),
  )?.metadata.file;

  if (!resolvedFile) {
    return {
      file: cited.path,
      startLine: 0,
      excerpt: '',
      anchor: cited.path,
      fromDoc: DOC_FILE_RE.test(cited.path),
      citedPathMissing: true,
    };
  }

  const fileChunks = repoChunks!.filter(c => c.metadata.file === resolvedFile);
  const keywordAnchors = extractAnchors(claimText).filter(a => a !== cited.symbol);
  const { chunk, centerOn } = pickCitedChunk(fileChunks, cited.symbol, keywordAnchors);
  const built = buildExcerpt(chunk, centerOn, IDENTITY);
  return {
    file: resolvedFile,
    startLine: built.startLine,
    excerpt: built.excerpt,
    anchor: built.anchor,
    fromDoc: DOC_FILE_RE.test(resolvedFile),
  };
}

/**
 * Locate the code (or sibling doc) a single claim describes. An explicit
 * self-citation (`claim.citedPath`) is resolved first — against the PR's own
 * diff, then the repo index (see `findCitedPathEvidence`) — and, when
 * present, short-circuits the rest of this function; this is the ONE path
 * that can still produce evidence with no repo index at all (a citation
 * resolving purely against `patches`). Otherwise tries a case-sensitive
 * anchor pass against `repoChunks` (identifiers/keys are case-bearing), then
 * a case-insensitive fallback. Returns undefined when no anchor resolves or
 * there is no repo index to search.
 */
export function findClaimEvidence(
  claim: DocClaim,
  repoChunks: CodeChunk[] | undefined,
  changed: Set<string>,
  patches?: Map<string, string>,
): DocClaimEvidence | undefined {
  if (claim.citedPath)
    return findCitedPathEvidence(claim.citedPath, claim.claimText, repoChunks, patches);

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
  const patches = context.pr?.patches;
  return claims.map((claim, i) => {
    if (i >= MAX_CLAIMS) return claim; // beyond the render cap — evidence would never show
    const evidence = findClaimEvidence(claim, repoChunks, changed, patches);
    return evidence ? { ...claim, evidence } : claim;
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const DOC_CLAIMS_HEADER =
  'Pre-computed: behavioral/structural claims this PR added to its touched ' +
  'guidance/doc surfaces (ADRs, site guides, changesets, CLAUDE.md, hooks) AND ' +
  'to comments/docstrings/description strings in changed CODE files. This is ' +
  'the doc-truth discovery step done for you — do NOT skip it; it is ' +
  'your primary claim inventory. The scan can miss claims and can list prose ' +
  'that is merely descriptive, so also skim the touched hunks for any not here. ' +
  'Most entries carry an `evidence` excerpt: the code (or a sibling doc, for ' +
  'omission claims, or — when the claim cites a file that is itself part of ' +
  "this PR — that file's own diff hunk) the claim describes, located " +
  'deterministically for you — ' +
  'COMPARE the claim against that excerpt. The locator can pick the wrong site, ' +
  'so first confirm the excerpt IS the described code; then: if it CONFIRMS the ' +
  'claim, stay silent; if it CONTRADICTS the claim — or the diff changed the ' +
  'behavior and left the prose describing the OLD behavior — emit a doc-truth ' +
  'finding that QUOTES the claim and cites the falsifying fact. For an entry ' +
  'with NO evidence, locate the code yourself using material already in your ' +
  'prompt (the diff hunks, <changed_functions>, and get_files_context on the ' +
  'described symbols — it reads indexed chunks, so it works even when ' +
  'grep_codebase/read_file are blind); if, after that genuine attempt, you ' +
  'still cannot locate it, stay silent — an unconfirmed claim is not evidence ' +
  'of a false one, and reporting "I could not verify this" as a finding is ' +
  'noise, not a catch. An entry that is plainly descriptive prose (not a ' +
  'falsifiable claim about this code) needs no finding — do NOT report ' +
  'wording/style nits or manufacture a contradiction the code does not support.';

/** The no-evidence pointer appended to a claim the locator could not resolve. */
const NO_EVIDENCE_HINT =
  '  (evidence: none located — find the described code yourself via get_files_context on the named symbols/files)';

/**
 * Render one claim entry's lines: the `file: "claim"` header, then either its
 * located evidence excerpt (as a fenced block), the one-line "cited file not
 * found" note (see `DocClaimEvidence.citedPathMissing`), or the no-evidence
 * hint. Evidence is suppressed with an inline note once `remaining` budget
 * can't hold it, so the claim inventory itself never gets dropped for an
 * excerpt.
 */
function renderClaimEntry(claim: DocClaim, remaining: number): string[] {
  const header = `- ${claim.file}: "${claim.claimText}"`;
  if (!claim.evidence) return [header, NO_EVIDENCE_HINT];
  if (claim.evidence.citedPathMissing) {
    return [
      header,
      `  (evidence: the cited file "${claim.evidence.file}" was not found in the index or PR diff — the citation itself may be stale)`,
    ];
  }

  const { file, startLine, excerpt, fromDoc, fromDiff } = claim.evidence;
  const label = fromDiff ? 'evidence (PR diff)' : fromDoc ? 'evidence (sibling doc)' : 'evidence';
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
