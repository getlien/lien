import type { CodeChunk } from './types.js';

/**
 * Shared matching primitives for "does an untouched doc chunk still reference
 * this token".
 *
 * Two independent consumers needed this identically when it was lifted here:
 * the review-time docs-drift pass, and an edit-time nudge in the CLI that
 * looked up which *indexed* doc chunks referenced a just-removed symbol. The
 * nudge and the index behind it have since been deleted, so the surviving
 * consumers are both inside parser:
 *
 * - `signals/docs-drift-signals.ts` — which untouched docs still name a
 *   symbol/path this PR removed, renamed or deleted.
 * - `go-root-package-signals.ts` — `isUnambiguousIdentifierShape` only.
 *
 * It stays a separate module because those two must not drift apart on what
 * counts as a token boundary, and because two other signal modules
 * (`csharp-type-reference-signals.ts`, `jvm-same-package-signals.ts`)
 * deliberately do NOT use `wordBoundaryRe` — see their own comments for why.
 */

/**
 * The characters that would extend a matched token into a DIFFERENT, longer
 * identifier or path segment — used as a negative lookaround so a token match
 * doesn't spuriously fire inside a larger token it's merely a substring of
 * (e.g. `packages/runner` inside `packages/runner-hosted`; `fetchUser` inside
 * `my-fetchUser` or `fetchUser.old`). Plain `\b` alone is insufficient: `-`
 * and `.` are non-word characters, so `\b` treats them as legitimate
 * boundaries even though identifier/path conventions use them to continue
 * the same token. `/` is deliberately NOT in this set — a leading/trailing
 * `/` is a legitimate path continuation (`packages/runner/README.md` still
 * names the same directory).
 */
const CONTINUATION_CHARS = '[A-Za-z0-9_.-]';

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A word/path-boundary regex for `token` — see `CONTINUATION_CHARS` for why
 * this is stricter than plain `\b`. Pass `flags: 'g'` for a reusable
 * global-match regex (`matchAll`).
 */
export function wordBoundaryRe(token: string, flags = ''): RegExp {
  const escaped = escapeForRegex(token);
  return new RegExp(`(?<!${CONTINUATION_CHARS})${escaped}(?!${CONTINUATION_CHARS})`, flags);
}

/**
 * A neighbor character that marks a `token` occurrence as CODE/PATH context
 * (a directory/file listing, or an inline code span) rather than ordinary
 * prose: a path separator, or the backtick markdown convention uses for a
 * bare identifier/path (e.g. `` `platform/` `` or `` `createVectorDB` ``).
 */
const CODE_CONTEXT_NEIGHBOR_RE = /[/`]/;

/** Fence delimiter: up to 3 leading spaces, then 3+ backticks or 3+ tildes (mirrors
 *  markdown-chunker.ts's own `FENCE_RE`). */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Per-line "entering this line, are we inside a fenced code block" state —
 * toggles on every fence delimiter strictly before the line (mirrors
 * `docs-drift-signals.ts`'s own `isInsideFence`, computed once per chunk
 * instead of once per query line). A multi-line fenced usage example (a
 * triple-backtick ```typescript block, or an ASCII directory-tree diagram) is
 * unambiguously code, even though no single occurrence inside it sits
 * directly against a `/` or a backtick — without this, a genuinely
 * distinctive symbol referenced only inside such a fence (its normal,
 * expected form) would wrongly read as "not distinctive" (verified against a
 * real false negative: `createVectorDB`'s own README usage examples and
 * CLAUDE.md's fenced package-structure tree).
 */
function computeFenceState(lines: string[]): boolean[] {
  const state: boolean[] = [];
  let inFence = false;
  for (const line of lines) {
    state.push(inFence);
    if (FENCE_RE.test(line.trim())) inFence = !inFence;
  }
  return state;
}

/** True iff the `tokenLength`-long occurrence starting at `index` in `line`
 *  sits directly against a `/` or a backtick on either side — i.e. reads as
 *  a path/identifier, not a word in a sentence. */
function isCodeContextOccurrence(line: string, index: number, tokenLength: number): boolean {
  const before = index > 0 ? line[index - 1] : '';
  const after = line[index + tokenLength] ?? '';
  return CODE_CONTEXT_NEIGHBOR_RE.test(before) || CODE_CONTEXT_NEIGHBOR_RE.test(after);
}

/** True iff every occurrence of `re` across `chunk`'s lines sits in
 *  code/path-context: either the whole line is inside a fenced code block
 *  (see `computeFenceState`), or the occurrence itself sits in inline
 *  code/path-context (see `isCodeContextOccurrence`). */
function everyLineIsCodeContextOnly(chunk: CodeChunk, re: RegExp, tokenLength: number): boolean {
  const lines = chunk.content.split('\n');
  const fenceState = computeFenceState(lines);
  return lines.every(
    (line, i) =>
      fenceState[i] ||
      [...line.matchAll(re)].every(
        m => m.index === undefined || isCodeContextOccurrence(line, m.index, tokenLength),
      ),
  );
}

/** A lowercase letter immediately followed by an uppercase one, or vice versa
 *  (`eV` in `createVectorDB`, `hT` in `authToken`, `yC` in `MyClass`, `Wi` in
 *  `Widget`) — the case TRANSITION that marks camelCase, PascalCase, or a
 *  single Capitalized word, as opposed to a bare ALL-CAPS acronym (`API`,
 *  `ID`, `URL`, `DB`, `UI`, `HTTP`, `TODO`), which has no lowercase letter
 *  anywhere to transition from/to. */
const CASE_TRANSITION_RE = /[a-z][A-Z]|[A-Z][a-z]/;

/** An underscore with a word character on BOTH sides (`o_b` in `foo_bar`) —
 *  an internal separator, as opposed to a purely decorative leading/trailing
 *  underscore (`_prefix`, `foo_`), which doesn't make an ordinary word any
 *  less ambiguous. */
const INTERNAL_UNDERSCORE_RE = /\w_\w/;

/**
 * True iff `token` has an internal camelCase/PascalCase case transition or an
 * internal underscore — the shape no ordinary lowercase English word has
 * (`index`, `config`, `platform`), so it CANNOT be mistaken for one no matter
 * how many plain-prose occurrences turn up in the corpus.
 *
 * Deliberately NARROWER than "contains any uppercase letter or underscore
 * anywhere": a bare ALL-CAPS acronym (`API`, `ID`, `URL`, `DB`, `UI`, `HTTP`,
 * `TODO`) is exactly the kind of ordinary, high-frequency word this gate
 * exists to catch — "call the API", "check the ID" are completely mundane
 * prose, and a removed export literally named `ID` or `API` would otherwise
 * false-fire against nearly every doc in a real corpus. A single trailing or
 * leading underscore (`foo_`, `_prefix`) is excluded for the same reason: it
 * doesn't turn an otherwise-ordinary word into an identifier the way an
 * INTERNAL separator does. False-fires are this nudge's worst failure mode
 * (an incorrect "N docs reference X" is actively misleading, whereas a missed
 * reference is merely silent) — this is why the requirement is a genuine
 * shape signal, not merely "has a capital letter somewhere." Exposed for
 * testing.
 */
export function isUnambiguousIdentifierShape(token: string): boolean {
  return CASE_TRANSITION_RE.test(token) || INTERNAL_UNDERSCORE_RE.test(token);
}

/**
 * True iff EVERY word-boundary occurrence of `token` across `docChunks` reads
 * as code/path context — never as ordinary prose describing something
 * unrelated (e.g. a bare directory named `platform` inside "supports every
 * platform", or a bare symbol named `index`/`config` inside "the index is
 * built here"). A single prose hit disqualifies the token: when in doubt,
 * suppress.
 *
 * Skipped entirely for a token with `isUnambiguousIdentifierShape` — a
 * camelCase/PascalCase identifier or an underscored name reads as code no
 * matter what surrounds it in prose, so gating it the same way a bare
 * lowercase word needs to be gated would only produce false suppressions
 * (found dogfooding: this feature's own architecture-doc writeup mentions
 * `createVectorDB` inline, un-backticked, in running prose — a real doc
 * reference that must not be thrown away). The strict corpus-driven check
 * below remains exactly as it was for a bare lowercase word (the review
 * pass's bare-top-level-directory case, `platform`/`runner`, is unaffected
 * by construction: directory names here are always lowercase).
 *
 * Corpus-driven rather than a hardcoded stopword list: a fixed word list
 * needs constant upkeep across languages/domains and still misses whatever
 * wasn't anticipated. Checking what the corpus actually does with the word
 * is self-maintaining. Chunks that don't even contain `token` trivially pass
 * (nothing to disqualify), so callers may pass either the full doc corpus or
 * an already-narrowed "chunks containing this token" set — both produce the
 * same result.
 */
export function isDistinctiveToken(token: string, docChunks: CodeChunk[]): boolean {
  if (isUnambiguousIdentifierShape(token)) return true;

  const re = wordBoundaryRe(token, 'g');
  return docChunks.every(
    chunk => !chunk.content.includes(token) || everyLineIsCodeContextOnly(chunk, re, token.length),
  );
}
