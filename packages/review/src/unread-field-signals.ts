/**
 * Deterministic "unread field" signal for PR reviews — incomplete-handling's
 * THIRD omission shape.
 *
 * Provenance: the per-rule-loops design review (`.wip/per-rule-loops-design.md`,
 * gating-matrix row for `incomplete-handling`) names this as the one shape with
 * ZERO signal coverage today: `variant-sweep-signals.ts` covers added enum/
 * union/const-object VARIANTS, `sibling-surface-signals.ts` covers a feature
 * silently missing from a FAMILY MEMBER file — but a plain interface member /
 * type-literal property / class field that's declared and never read anywhere
 * ("the plumbing to the consumer was forgotten") has no precomputed candidate
 * list; the rule's own prompt (`rules.ts`, `INCOMPLETE_HANDLING`) just tells
 * the agent to "grep for all consumers" — the exact grep-and-reason anti-
 * pattern CLAUDE.md's design principle warns against, and this module's own
 * motivating example (`RuleTriggers.filePatterns`, `rules.ts`'s `example`
 * field) is EXACTLY this shape.
 *
 * The shape: a PR adds a member to an EXISTING or brand-new interface / type
 * literal / class (TS/JS v1 scope) that has no dot-access, bracket-access, or
 * destructuring reference anywhere else in the indexed corpus — only its own
 * declaration. Two steps, both deterministic:
 *   1. `computeAddedFields` — parse each changed file's diff for a genuinely
 *      new interface member / type-literal property / class field.
 *   2. `computeUnreadFieldCandidates` — for each added field, sweep the full
 *      indexed corpus (`repoChunks`) for a read site; keep only fields with
 *      none.
 *
 * ## Precision instrument, not recall instrument
 *
 * This is a "prove absence" signal, the hardest kind — a single missed read
 * pattern anywhere in a multi-hundred-chunk corpus is a false positive. Every
 * design choice below errs toward silence over a wrong candidate, per the
 * design brief: "when in doubt, suppress the candidate — the rule's LLM
 * judgment still exists without the signal."
 *
 *  - **Wholesale consumption (spread / `JSON.stringify` / serialization /
 *    shorthand-property hand-off).** If a `: TypeName` annotation has a
 *    spread (`...x`), `JSON.stringify(`, or — see below — a shorthand-
 *    property object-literal reference to the SAME annotated variable,
 *    within `WHOLESALE_PROXIMITY_CHARS` characters after it anywhere in the
 *    corpus, every field of that type is suppressed — we can't prove the
 *    field isn't consumed as part of a whole-object pass-through, so we
 *    don't claim it is unread. Deliberately type-level, not field-level (a
 *    narrower per-field check would need real data-flow tracking this module
 *    doesn't attempt), and proximity-based rather than a bare co-occurrence
 *    check: an earlier version matched the type name and a spread/stringify
 *    ANYWHERE in the same chunk, which false-fired on this module's OWN doc
 *    comment naming `RuleTriggers` (found via dogfooding) — requiring an
 *    actual type annotation, with comments masked out first, fixes that
 *    specific false-suppression while keeping the check textual (not real
 *    data-flow: the nearby spread/stringify need not touch the same
 *    variable the annotation introduced).
 *    The shorthand-property case is narrower and DOES tie back to the
 *    annotated variable's own name (mining sweep, hono #4451 ground truth):
 *    `app.fetch(req, { event, requestContext, context })` hands the whole
 *    `requestContext` value (typed `LatticeRequestContextV2`, carrying the
 *    PR's new `serviceNetworkArn` field) opaquely to another consumer via a
 *    bare shorthand property — not a spread, not `JSON.stringify`, so the
 *    original check missed it and flagged a real, actively-consumed field as
 *    unread. `{ requestContext }` reads as "hand off the CURRENT value of
 *    variable `requestContext`" the same way `...requestContext` would, so
 *    it counts as the same wholesale evidence — scoped to the specific
 *    variable name captured from the type annotation (`varName: TypeName`),
 *    not "any object literal with 2+ shorthand keys anywhere nearby".
 *  - **JSX attribute usage (`<div tw="...">`).** Read detection also
 *    recognizes the field name appearing as a JSX attribute on any element —
 *    invisible to the dot/bracket/destructure patterns above, since a JSX
 *    attribute is compiled to a prop key, never a `.field`/`['field']`
 *    access or a destructured binding in the SOURCE text. Motivating case
 *    (mining sweep, zod's OG-image generator): Satori's custom JSX renderer
 *    reads `HTMLAttributes.tw` (an inline-Tailwind escape hatch) exclusively
 *    via `<div tw="...">`-shaped call sites. Bounded to a fixed character
 *    window after the opening `<Tag` (mirrors the wholesale check's
 *    proximity design, and — per #810's ReDoS-hardening precedent —
 *    deliberately uses a BOUNDED quantifier rather than an unbounded `*`, so
 *    a minified file dense with `<`/`>` comparison operators can't make this
 *    pattern's worst case anything other than linear).
 *  - **Exported "public API" types.** A field on a type that's re-exported by
 *    an `index.ts`/`index.js` barrel is suppressed — its real consumers may
 *    live outside this indexed corpus (an external SDK consumer, or another
 *    package this review run didn't index). Two ways in: a NAMED export
 *    statement mentioning the type directly, or a wildcard `export * from
 *    '<specifier>'` whose specifier's basename matches the declaring file's
 *    own basename. That basename match is required, not optional — an
 *    earlier version treated ANY wildcard barrel found ANYWHERE in the
 *    corpus as evidence, which (found via dogfooding) suppressed every
 *    candidate in the entire codebase the moment a single, wholly unrelated
 *    package had its own ordinary `export * from './foo.js'` barrel — nearly
 *    universal in real code, and fatal to the signal's recall. It's still a
 *    coarse, corpus-wide textual check, not a per-package public-surface
 *    resolution: it can't tell a PUBLISHED package's real npm-facing barrel
 *    from a PRIVATE monorepo package's own internal `index.ts` (both look
 *    identical texturally), and a same-basename file in an unrelated
 *    directory can still false-match the wildcard form — so it still
 *    over-suppresses sometimes, just no longer catastrophically. A
 *    documented false-negative-prone simplification, not a bug: fewer
 *    candidates, never a wrong one.
 *  - **Test-fixture files.** A field declared in a file matching the test-path
 *    convention (`*.test.ts`, `__tests__/`, etc.) is skipped entirely — test
 *    fixture objects routinely carry properties the test itself never reads
 *    back out, and that's not a production bug.
 *  - **Generated `.d.ts` declaration files.** A field declared in a `.d.ts`
 *    file whose name carries a codegen marker (`-bundle`, `-generated`/
 *    `.generated.`, `.gen.`) or whose leading content carries a generator
 *    marker comment (`@generated`, `DO NOT EDIT`, "automatically generated")
 *    is skipped the same way a test-fixture file is. Motivating case (mining
 *    sweep, drizzle-kit): `grammar.ohm-bundle.d.ts`, an Ohm.js-generated
 *    grammar action-dictionary type listing EVERY grammar rule as an
 *    optional handler property — the exact same "declared, most never
 *    populated/read by any one consumer" shape as a test fixture, just for
 *    generated parser code instead. Deliberately narrow: a HAND-WRITTEN
 *    `.d.ts` (an ambient module declaration a person authored) carries
 *    neither signal and is NOT suppressed — blindly suppressing every
 *    `.d.ts` would hide real gaps in hand-authored type-only files.
 *  - **Dynamic/bracket access.** Read detection covers `obj.field`,
 *    `obj['field']`/`obj["field"]` (bracket string-literal key access), and
 *    both destructuring shapes (`const { field } = x`, `function f({ field })`)
 *    — not just the naive dot-access form other signals use for qualified
 *    enum/const-object references. A TRULY dynamic key (`obj[someVar]` where
 *    `someVar` happens to equal the field name at runtime) is undetectable
 *    statically and stays a documented gap.
 *
 * ## v1 scope, stated honestly
 *
 *  - TS/JS only (this repo's own surface, mirrors every other TS/JS-scoped
 *    signal in this file set).
 *  - Three declaration shapes: `interface X { field: T; }`, `type X = { field:
 *    T; }` (a DIRECT object-type-literal assignment only — `type X = A & {
 *    field: T }` or a generic-wrapped object type is not parsed, a documented
 *    gap, same tradeoff `variant-sweep-signals.ts` makes for its union shape),
 *    and a single-physical-line TYPED class property (`private readonly
 *    field: T;`, `field?: T;`, `field: T = default;`) — an untyped inferred
 *    field (`field = value;`, no `:`), a decorator-prefixed field
 *    (`@Input() field: T;`), or a multi-line field type are not detected;
 *    narrowing scope here trades recall for never misreading a getter/setter/
 *    method as a field (see `CLASS_PROPERTY_LINE_RE`'s doc for why).
 *  - Unlike `variant-sweep-signals.ts`, the containing declaration does NOT
 *    need to have existed before this PR — a brand-new interface whose field
 *    nobody reads is the same bug shape (the rule's own `RuleTriggers`
 *    example could plausibly have introduced `filePatterns` alongside a
 *    brand-new interface, not just added it to an old one).
 *  - This module does not verify the field is ever POPULATED (an object
 *    literal setting it, or a `.field = value` assignment) — it fires purely
 *    on "declared + never read". A field that's also never populated is
 *    arguably a smaller bug (dead code) than one that's silently populated
 *    and dropped, but distinguishing the two needs a construction-site trace
 *    this module doesn't attempt; left to the agent's own judgment.
 *  - A member is a genuine ADDITION using the same `isGenuinelyNew` technique
 *    `variant-sweep-signals.ts` uses: its identifier must not appear on a
 *    REMOVED line of this file's diff. A rename (old field removed, new one
 *    added) still counts as an addition — the same accepted overlap with
 *    `rename-sweep-signals.ts` variant-sweep documents for its own shape.
 */

import type { CodeChunk } from '@liendev/parser';
import type { ReviewContext } from './plugin-types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UnreadFieldKind = 'interface' | 'type-literal' | 'class';

/** A field this PR adds to an interface / type literal / class with no read site found. */
export interface UnreadFieldCandidate {
  typeName: string;
  field: string;
  file: string;
  line: number;
  kind: UnreadFieldKind;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max candidates rendered — keeps the block compact, mirrors comparison-change/stale-literal. */
const MAX_CANDIDATES = 10;
/** Total block character budget. */
const MAX_BLOCK_CHARS = 3_000;

/** Files whose diffs/chunks we scan (this repo's TS/JS surface — v1 scope). */
const TS_JS_FILE_RE = /\.(?:[cm]?[jt]sx?)$/;

/**
 * Broader than a leading-slash-only test regex — matches a root-level
 * `tests/` directory and languages that keep tests alongside source (mirrors
 * `sibling-surface-signals.ts`'s own `TEST_PATH_RE`, same rationale).
 */
const TEST_PATH_RE =
  /(^|\/)(tests?|specs?|__tests__)(\/|$)|\.(test|spec)\.|_test\.\w+$|_spec\.\w+$|[A-Z]\w*Test\.\w+$/;

/** An `index.ts`/`index.js` (or `.tsx`/`.jsx`) barrel file anywhere in the corpus. */
const INDEX_BARREL_RE = /(^|\/)index\.[cm]?[jt]sx?$/;

/** A TypeScript declaration file. */
const DTS_FILE_RE = /\.d\.ts$/;

/**
 * A `.d.ts` filename stem carrying a common codegen marker: `-bundle`/`.bundle.` (this mining
 * sweep's own drizzle-kit ground truth, `grammar.ohm-bundle.d.ts`), `-generated`/`.generated.`/
 * `_generated`, or `.gen.`. Checked against the basename only — see {@link isGeneratedDeclarationFile}.
 */
const GENERATED_DTS_STEM_RE = /[.\-_](?:bundle|generated|gen)(?:[.\-_]|$)/i;

/** A leading generator-marker comment (`@generated`, `DO NOT EDIT`, "automatically generated"). */
const GENERATED_MARKER_RE = /@generated\b|\bDO NOT EDIT\b|\bautomatically generated\b/i;
/** Only scan the file's own leading characters for a generator marker — a match deep inside a
 *  large file is not reliable evidence the WHOLE file is generated. */
const GENERATED_MARKER_SCAN_CHARS = 500;

const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

const INTERFACE_HEADER_RE =
  /\b(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)(?:\s*<[^{]*>)?(?:\s+extends\s+[^{]+)?\s*\{/g;
const TYPE_LITERAL_HEADER_RE =
  /\b(?:export\s+)?type\s+([A-Za-z_$][\w$]*)(?:\s*<[^=\n]*>)?\s*=\s*\{/g;
const CLASS_HEADER_RE =
  /\b(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)(?:\s*<[^{]*>)?(?:\s+extends\s+[^{]+)?(?:\s+implements\s+[^{]+)?\s*\{/g;

/** A single interface/type-literal member: `field: Type` or `field?: Type`, never a call/construct/index signature. */
const INTERFACE_MEMBER_RE = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:\s*[\s\S]+$/;

/**
 * A single PHYSICAL LINE typed class property. Requires the type annotation
 * colon (excludes an untyped inferred field like `field = value;` — a
 * documented v1 gap) and forbids `{`/`}` in the type (excludes an inline
 * multi-line object-type field and prevents matching into a method's body by
 * accident). No `get`/`set` in the modifier list is intentional: a getter/
 * setter's name is followed by `(`, never `:`, so it can never match this
 * pattern regardless — the same reasoning that already excludes a method
 * signature (`foo(): T {`) without needing an explicit exclusion for it.
 */
const CLASS_PROPERTY_LINE_RE =
  /^\s*(?:public\s+|private\s+|protected\s+|readonly\s+|static\s+|abstract\s+|override\s+|declare\s+)*([A-Za-z_$][\w$]*)\??\s*:\s*[^;\n{}]+;\s*$/;

/** A spread of an identifier, or a `JSON.stringify(` call — coarse wholesale-consumption evidence. */
const WHOLESALE_RE = /\bJSON\.stringify\s*\(|\.\.\.\s*[A-Za-z_$]/;
/** How close (chars) a spread/`JSON.stringify(` must be AFTER a `: typeName` annotation to count — see {@link chunkHasWholesaleConsumption}. */
const WHOLESALE_PROXIMITY_CHARS = 400;

/**
 * How many repetitions of {@link JSX_ATTR_GAP} to scan after a JSX tag's opening `<Tag` for the
 * field name used as an attribute — see {@link buildJsxAttrReadPattern}. Each repetition is
 * either one ordinary character or one whole balanced `{...}` expression container, so this
 * bounds attribute COUNT more than raw character count — but it is still a fixed bound (not an
 * unbounded `*` repetition), so a minified file dense with `<`/`>` comparison operators, or with
 * many brace-expression attributes, can't make this pattern's worst case anything other than
 * linear (#810's ReDoS-hardening precedent).
 */
const JSX_ATTR_SCAN_CHARS = 240;

// ---------------------------------------------------------------------------
// Low-level text utilities (masking/brace-matching, mirrors variant-sweep-signals.ts)
// ---------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

interface Span {
  end: number;
  kind: 'string' | 'comment';
}

function classifySpan(text: string, i: number): Span | null {
  const ch = text[i];
  if (ch === '"' || ch === "'" || ch === '`')
    return { end: skipStringLike(text, i), kind: 'string' };
  if (ch === '/' && text[i + 1] === '/') {
    const end = text.indexOf('\n', i);
    return { end: end === -1 ? text.length : end, kind: 'comment' };
  }
  if (ch === '/' && text[i + 1] === '*') {
    const end = text.indexOf('*/', i + 2);
    return { end: end === -1 ? text.length : end + 2, kind: 'comment' };
  }
  return null;
}

/** Replace every span `shouldMask` accepts with same-length whitespace (newlines kept, so line numbers still match). */
function maskSpans(
  text: string,
  shouldMask: (span: Span, start: number, text: string) => boolean,
): string {
  let i = 0;
  let out = '';
  while (i < text.length) {
    const span = classifySpan(text, i);
    if (span === null) {
      out += text[i];
      i++;
      continue;
    }
    if (shouldMask(span, i, text)) {
      for (let k = i; k < span.end; k++) out += text[k] === '\n' ? '\n' : ' ';
    } else {
      out += text.slice(i, span.end);
    }
    i = span.end;
  }
  return out;
}

function maskComments(text: string): string {
  return maskSpans(text, span => span.kind === 'comment');
}

function maskCommentsAndStrings(text: string): string {
  return maskSpans(text, () => true);
}

function prevNonSpace(text: string, i: number): string {
  let k = i - 1;
  while (k >= 0 && /\s/.test(text[k])) k--;
  return k >= 0 ? text[k] : '';
}

function nextNonSpace(text: string, i: number): string {
  let k = i;
  while (k < text.length && /\s/.test(text[k])) k++;
  return k < text.length ? text[k] : '';
}

/** Is this string span a bracket-index key (`obj['field']`) rather than a free-standing prose string? */
function isBracketIndexString(span: Span, start: number, text: string): boolean {
  return prevNonSpace(text, start) === '[' && nextNonSpace(text, span.end) === ']';
}

/**
 * Mask comments and prose strings, but NOT a bracket-index key — needed so
 * `obj['field']` read detection still sees the quoted key, mirroring
 * `variant-sweep-signals.ts`'s `maskCommentsAndProseStrings`.
 */
function maskCommentsAndProseStrings(text: string): string {
  return maskSpans(
    text,
    (span, start, t) =>
      span.kind === 'comment' || (span.kind === 'string' && !isBracketIndexString(span, start, t)),
  );
}

function findMatchingBraceFrom(content: string, openIdx: number): number {
  let depth = 0;
  let i = openIdx;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipStringLike(content, i);
      continue;
    }
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

interface Segment {
  text: string;
  offset: number;
}

/** Split `text` on top-level `;`, respecting `{}`/`()`/`[]` nesting and skipping string/template literals. */
function splitTopLevelSemicolons(text: string): Segment[] {
  const segments: Segment[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipStringLike(text, i);
      continue;
    }
    if ('{(['.includes(ch)) {
      depth++;
      i++;
      continue;
    }
    if ('})]'.includes(ch)) {
      depth--;
      i++;
      continue;
    }
    if (depth === 0 && ch === ';') {
      segments.push({ text: text.slice(start, i), offset: start });
      start = i + 1;
      i++;
      continue;
    }
    i++;
  }
  const rest = text.slice(start);
  if (rest.trim().length > 0) segments.push({ text: rest, offset: start });
  return segments;
}

function countNewlines(text: string, upTo: number): number {
  let n = 0;
  for (let i = 0; i < upTo; i++) {
    if (text[i] === '\n') n++;
  }
  return n;
}

function leadingWhitespaceLength(text: string): number {
  return text.length - text.trimStart().length;
}

// ---------------------------------------------------------------------------
// Type declaration extraction (static, post-PR chunk content)
// ---------------------------------------------------------------------------

interface FieldMember {
  name: string;
  line: number;
}

interface TypeDeclaration {
  typeName: string;
  kind: UnreadFieldKind;
  fields: FieldMember[];
  declStartLine: number;
  declEndLine: number;
}

function memberLine(content: string, baseLine: number, bodyStart: number, seg: Segment): number {
  const idx = bodyStart + seg.offset + leadingWhitespaceLength(seg.text);
  return baseLine + countNewlines(content, idx);
}

/** Shared body-member extraction for `interface`/type-literal declarations (both use `;`-separated members). */
function findBraceBodyDeclarations(
  content: string,
  baseLine: number,
  headerRe: RegExp,
  kind: UnreadFieldKind,
): TypeDeclaration[] {
  const out: TypeDeclaration[] = [];
  const headerMask = maskCommentsAndStrings(content);
  const commentMasked = maskComments(content);
  for (const m of headerMask.matchAll(headerRe)) {
    const typeName = m[1];
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = findMatchingBraceFrom(commentMasked, openIdx);
    if (closeIdx === -1) continue;

    const bodyStart = openIdx + 1;
    const body = commentMasked.slice(bodyStart, closeIdx);
    const fields: FieldMember[] = [];
    for (const seg of splitTopLevelSemicolons(body)) {
      const t = seg.text.trim();
      if (!t) continue;
      const mem = t.match(INTERFACE_MEMBER_RE);
      if (!mem) continue;
      fields.push({ name: mem[1], line: memberLine(content, baseLine, bodyStart, seg) });
    }

    out.push({
      typeName,
      kind,
      fields,
      declStartLine: baseLine + countNewlines(content, m.index),
      declEndLine: baseLine + countNewlines(content, closeIdx),
    });
  }
  return out;
}

function findInterfaceDeclarations(content: string, baseLine: number): TypeDeclaration[] {
  return findBraceBodyDeclarations(content, baseLine, new RegExp(INTERFACE_HEADER_RE), 'interface');
}

function findTypeLiteralDeclarations(content: string, baseLine: number): TypeDeclaration[] {
  return findBraceBodyDeclarations(
    content,
    baseLine,
    new RegExp(TYPE_LITERAL_HEADER_RE),
    'type-literal',
  );
}

/** Net bracket-depth change from one line — `{`/`(`/`[` open, `}`/`)`/`]` close. */
function depthDelta(line: string): number {
  let delta = 0;
  for (const ch of line) {
    if (ch === '{' || ch === '(' || ch === '[') delta++;
    else if (ch === '}' || ch === ')' || ch === ']') delta--;
  }
  return delta;
}

/**
 * Class member scan: a plain top-level `;`-split (like interfaces use) breaks
 * on a class body, since a method's `}` isn't followed by a `;` — a method
 * immediately followed by a property would merge into one unsplit segment
 * spanning both, hiding the property from `INTERFACE_MEMBER_RE`. Scan
 * line-by-line with brace-depth tracking instead: only test a line against
 * {@link CLASS_PROPERTY_LINE_RE} when depth is 0 (top level of the class
 * body, not inside a method's own body/params).
 */
function findClassPropertyMembers(
  content: string,
  baseLine: number,
  bodyStart: number,
  bodyEnd: number,
): FieldMember[] {
  const body = content.slice(bodyStart, bodyEnd);
  const bodyStartLine = baseLine + countNewlines(content, bodyStart);
  const lines = body.split('\n');
  const out: FieldMember[] = [];
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (depth === 0) {
      const m = line.match(CLASS_PROPERTY_LINE_RE);
      if (m) out.push({ name: m[1], line: bodyStartLine + i });
    }
    depth += depthDelta(line);
  }
  return out;
}

function findClassDeclarations(content: string, baseLine: number): TypeDeclaration[] {
  const out: TypeDeclaration[] = [];
  const headerMask = maskCommentsAndStrings(content);
  const commentMasked = maskComments(content);
  for (const m of headerMask.matchAll(new RegExp(CLASS_HEADER_RE))) {
    const typeName = m[1];
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = findMatchingBraceFrom(commentMasked, openIdx);
    if (closeIdx === -1) continue;

    out.push({
      typeName,
      kind: 'class',
      fields: findClassPropertyMembers(content, baseLine, openIdx + 1, closeIdx),
      declStartLine: baseLine + countNewlines(content, m.index),
      declEndLine: baseLine + countNewlines(content, closeIdx),
    });
  }
  return out;
}

/** All interface/type-literal/class declarations found in one chunk's (TS/JS) content. */
function findTypeDeclarations(content: string, baseLine: number): TypeDeclaration[] {
  return [
    ...findInterfaceDeclarations(content, baseLine),
    ...findTypeLiteralDeclarations(content, baseLine),
    ...findClassDeclarations(content, baseLine),
  ];
}

// ---------------------------------------------------------------------------
// Diff-side: which new-file lines did this PR add, and what did it remove?
// ---------------------------------------------------------------------------

interface FileDiffFacts {
  addedLines: Set<number>;
  removedText: string;
}

function computeFileDiffFacts(patch: string): FileDiffFacts {
  const addedLines = new Set<number>();
  const removedParts: string[] = [];
  let newLine = 0;

  for (const raw of patch.split('\n')) {
    const hunk = raw.match(HUNK_HEADER_RE);
    if (hunk) {
      newLine = parseInt(hunk[1], 10);
      continue;
    }
    if (raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('\\')) continue;

    if (raw.startsWith('+')) {
      addedLines.add(newLine);
      newLine++;
    } else if (raw.startsWith('-')) {
      removedParts.push(raw.slice(1));
    } else {
      newLine++;
    }
  }

  return { addedLines, removedText: removedParts.join('\n') };
}

/** Same technique `variant-sweep-signals.ts` uses: a rename still counts as an addition. */
function isGenuinelyNew(name: string, removedText: string): boolean {
  return !new RegExp(`\\b${escapeRegExp(name)}\\b`).test(removedText);
}

// ---------------------------------------------------------------------------
// computeAddedFields
// ---------------------------------------------------------------------------

/** One field this PR genuinely added, with its containing declaration. */
export interface AddedField {
  typeName: string;
  field: string;
  file: string;
  line: number;
  kind: UnreadFieldKind;
}

interface AddedFieldEntry {
  decl: TypeDeclaration;
  field: FieldMember;
  file: string;
}

function collectAddedFieldsFromChunk(
  chunk: CodeChunk,
  file: string,
  facts: FileDiffFacts,
  seen: Set<string>,
  out: AddedFieldEntry[],
): void {
  for (const decl of findTypeDeclarations(chunk.content, chunk.metadata.startLine)) {
    for (const field of decl.fields) {
      if (!facts.addedLines.has(field.line)) continue;
      if (!isGenuinelyNew(field.name, facts.removedText)) continue;

      const key = `${decl.kind}:${decl.typeName}:${field.name}:${file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ decl, field, file });
    }
  }
}

/** One changed file's worth of added-field collection, split out to keep {@link computeAddedFields} flat. */
function collectAddedFieldsForFile(
  file: string,
  patch: string,
  chunks: CodeChunk[],
  seen: Set<string>,
  out: AddedFieldEntry[],
): void {
  const facts = computeFileDiffFacts(patch);
  if (facts.addedLines.size === 0) return;

  for (const chunk of chunks) {
    if (chunk.metadata.file === file) collectAddedFieldsFromChunk(chunk, file, facts, seen, out);
  }
}

// ---------------------------------------------------------------------------
// File-level skip checks (test fixtures, generated declaration files)
// ---------------------------------------------------------------------------

/**
 * The chunk most likely to hold `file`'s own leading lines (smallest `startLine`) — a generator
 * marker comment near the top of the file wouldn't be visible from a later, non-head chunk if
 * the file was split across several.
 */
function headChunkContent(file: string, chunks: CodeChunk[]): string {
  let head: CodeChunk | undefined;
  for (const chunk of chunks) {
    if (chunk.metadata.file !== file) continue;
    if (!head || chunk.metadata.startLine < head.metadata.startLine) head = chunk;
  }
  return head?.content ?? '';
}

/**
 * Is `file` a GENERATED `.d.ts` declaration file — skipped the same way a test-fixture file is
 * (module doc's "Generated `.d.ts` declaration files" note)? Deliberately narrow: a HAND-WRITTEN
 * `.d.ts` carries neither a codegen filename marker nor a leading generator-marker comment and
 * is NOT skipped by this check.
 */
function isGeneratedDeclarationFile(file: string, chunks: CodeChunk[]): boolean {
  if (!DTS_FILE_RE.test(file)) return false;
  const base = file.slice(file.lastIndexOf('/') + 1);
  if (GENERATED_DTS_STEM_RE.test(base)) return true;
  const head = headChunkContent(file, chunks).slice(0, GENERATED_MARKER_SCAN_CHARS);
  return GENERATED_MARKER_RE.test(head);
}

/**
 * Find every interface member / type-literal property / class field this PR
 * genuinely adds (unlike `variant-sweep-signals.ts`, the containing
 * declaration need NOT have existed before this PR — see module doc). Exposed
 * for testing.
 */
export function computeAddedFields(context: ReviewContext): AddedField[] {
  const patches = context.pr?.patches;
  if (!patches || patches.size === 0) return [];
  const chunks = context.chunks;
  if (!chunks || chunks.length === 0) return [];

  const entries: AddedFieldEntry[] = [];
  const seen = new Set<string>();

  for (const [file, patch] of patches) {
    if (!TS_JS_FILE_RE.test(file)) continue;
    if (TEST_PATH_RE.test(file)) continue; // FP trap: test-fixture files
    if (isGeneratedDeclarationFile(file, chunks)) continue; // FP trap: generated .d.ts
    collectAddedFieldsForFile(file, patch, chunks, seen, entries);
  }

  return entries.map(e => ({
    typeName: e.decl.typeName,
    field: e.field.name,
    file: e.file,
    line: e.field.line,
    kind: e.decl.kind,
  }));
}

// ---------------------------------------------------------------------------
// Suppression: exported "public API" barrel reachability + wholesale consumption
// ---------------------------------------------------------------------------

const WILDCARD_EXPORT_RE = /export\s*\*\s*from\s*['"]([^'"]+)['"]/g;

/** File basename with its extension (and any TS/JS suffix on the specifier side) stripped. */
function baseNameNoExt(file: string): string {
  const base = file.slice(file.lastIndexOf('/') + 1);
  return base.replace(/\.(?:[cm]?[jt]sx?)$/, '');
}

/**
 * Does a wildcard `export * from '<specifier>'` module specifier plausibly
 * point at the declaring file — i.e. does its last path segment (extension
 * stripped) match the file's own basename? A barrel's wildcard target is
 * usually a relative specifier (`./foo.js`, `../bar/foo.js`) whose basename
 * mirrors the real file it re-exports; requiring that match is what stops
 * an ENTIRELY UNRELATED barrel elsewhere in the corpus (any package's own
 * `export * from './something-else.js'`) from suppressing every type in the
 * whole codebase — the bug an earlier, unscoped version of this check hit
 * during dogfooding (a schemas barrel in a different package suppressed a
 * field on an unrelated type in another package entirely).
 */
function wildcardSpecifierMatchesFile(specifier: string, fileBase: string): boolean {
  return baseNameNoExt(specifier) === fileBase;
}

/**
 * Is `typeName`, declared in `file`, re-exported by an `index.ts`/`index.js`
 * barrel found anywhere in the corpus? Two ways in: a wildcard `export *
 * from` whose specifier's basename matches `file`'s own basename (we can't
 * resolve real module paths without a resolver, so a basename match is the
 * scoped proxy — see {@link wildcardSpecifierMatchesFile}), or a named
 * export statement that mentions `typeName` directly. See module doc's
 * "Exported public API types" note for the remaining over-suppression
 * tradeoff (a same-basename file in an unrelated directory can still
 * false-match the wildcard form).
 */
function isReachableFromIndexBarrel(
  typeName: string,
  file: string,
  repoChunks: CodeChunk[],
): boolean {
  const fileBase = baseNameNoExt(file);
  const nameRe = new RegExp(`\\bexport\\b[^;\\n]*\\b${escapeRegExp(typeName)}\\b`);
  for (const chunk of repoChunks) {
    if (!INDEX_BARREL_RE.test(chunk.metadata.file)) continue;
    const masked = maskComments(chunk.content);
    for (const m of masked.matchAll(new RegExp(WILDCARD_EXPORT_RE.source, 'g'))) {
      if (wildcardSpecifierMatchesFile(m[1], fileBase)) return true;
    }
    if (nameRe.test(masked)) return true;
  }
  return false;
}

/**
 * Matches `varName: TypeName` / `varName?: TypeName` (capturing `varName` when present) or a
 * bare `: TypeName` with no preceding identifier at all (a return-type annotation, a generic
 * wrapper, etc.) — the capture group is OPTIONAL specifically so this still matches every shape
 * the original bare `:\s*typeName\b` check did; see {@link chunkHasWholesaleConsumption}.
 */
function typedAnnotationRegex(typeName: string): RegExp {
  return new RegExp(`([A-Za-z_$][\\w$]*)?\\??\\s*:\\s*${escapeRegExp(typeName)}\\b`, 'g');
}

/**
 * A destructured function PARAMETER where the `{...}` is the FIRST thing after the opening `(`
 * (only whitespace between) — `function f({ name }: T)` / `({ name }) =>`. Deliberately
 * STRICTER than {@link destructuringParamPattern} (which also matches `foo(a, { name })`, a
 * call passing an object-literal argument AFTER another argument): requiring `{` to
 * IMMEDIATELY follow `(` is what separates a lone/first destructured parameter from the hono
 * #4451 hand-off shape this fix targets, `app.fetch(req, { event, name, context })` — there,
 * `req, ` sits between `(` and `{`, so this pattern does NOT match it. `destructuringParamPattern`
 * itself is deliberately NOT reused here (unlike the assignment exclusion below): it cannot tell
 * `function f({ name })` from `foo(a, { name })` by text alone, and reusing it would exclude the
 * exact wholesale hand-off shape this module is trying to detect. A single-argument hand-off call
 * shaped exactly like a lone destructured parameter (`render({ name })`) remains a documented
 * residual — genuinely ambiguous from pure text, and rare next to the multi-argument shape the
 * real ground truth showed.
 */
function destructuringFirstParamPattern(name: string): RegExp {
  const esc = escapeRegExp(name);
  return new RegExp(`\\(\\s*\\{[^{}]*\\b${esc}\\b[^{}]*\\}`);
}

/**
 * A destructured `for`-loop binding: `for (const { name } of items)` / `for (let { name } in
 * obj)`. A third destructuring BINDING shape (alongside assignment and parameter) that a bare
 * `[{,]\s*name\s*[,}]` scan can't distinguish from a value-position shorthand hand-off — flagged
 * as a residual gap on this PR's own review (lien-stats summary for commit 15af218) after the
 * assignment/parameter cases were fixed.
 */
function destructuringForLoopPattern(name: string): RegExp {
  const esc = escapeRegExp(name);
  return new RegExp(
    `\\bfor\\s*\\(\\s*(?:const|let|var)\\s*\\{[^{}]*\\b${esc}\\b[^{}]*\\}\\s*(?:of|in)\\b`,
  );
}

/**
 * Matches a `{...}` group that opens in an EXPRESSION/VALUE position — immediately (whitespace
 * aside) after `=`, `(`, `,`, `[`, `:`, `=>`, or `return` — capturing its inner (single-level)
 * content. This is what an object LITERAL's opening brace looks like, as opposed to a function/
 * block body's opening brace, which instead typically follows `)` (a parameter list) or is a
 * bare top-level statement — see {@link hasShorthandHandoff}'s doc for why this distinction
 * matters.
 */
const OBJECT_LITERAL_GROUP_RE = /(?:=|\(|,|\[|:|=>|\breturn)\s*\{([^{}]*)\}/g;

/**
 * Blank out every bracket/paren-delimited span — `[...]`/`(...)`, at any nesting depth — with
 * same-length whitespace (newlines kept). Used to hide an array element or call argument that is
 * merely a NESTED VALUE inside an object literal's property (`{ event, arr: [a, varName, b] }`)
 * from {@link hasShorthandHandoff}'s top-level shorthand-property scan — flagged on this PR's own
 * review (lien-stats summary for commit db8966d) as a variant of the array/call-argument gap
 * already fixed there, this time nested one level inside a genuine object literal instead of
 * standing alone.
 */
function maskBracketsAndParens(text: string): string {
  const blank = (span: string) => [...span].map(c => (c === '\n' ? '\n' : ' ')).join('');
  let out = text;
  let next = out.replace(/\[[^[\]]*\]|\([^()]*\)/g, blank);
  // Peel one nesting level per pass — an innermost, bracket-free span always matches first, so
  // repeating until nothing changes handles arbitrary nesting without depth-tracking branches.
  while (next !== out) {
    out = next;
    next = out.replace(/\[[^[\]]*\]|\([^()]*\)/g, blank);
  }
  return out;
}

/**
 * Does `varName` appear as a bare shorthand property inside an object literal (`{ event,
 * varName, context }`) within `window` — a VALUE-position hand-off, not a BINDING? A shorthand
 * property hands off the CURRENT value of `varName` wholesale to whatever consumes the new
 * object — the same "can't prove the field isn't part of a whole-object pass-through" evidence a
 * spread or `JSON.stringify` gives, just via different syntax (mining sweep, hono #4451 ground
 * truth: `app.fetch(req, { event, requestContext, context })`).
 *
 * Multi-step check, not a single `[{,]\s*varName\s*[,}]` scan: flagged on this PR's own review
 * (lien-stats summaries for commits b5e3f88 and db8966d) that a bare adjacent-delimiter scan
 * can't tell an OBJECT literal from an ARRAY literal, a plain call's argument list, the enclosing
 * FUNCTION/BLOCK body itself, or a NESTED array/call inside one of the object's own property
 * VALUES (`{ arr: [a, varName, b] }`) — all of these can put a `,` immediately on either side of
 * `varName` with no TOP-LEVEL object-literal shorthand actually present. Step 1 requires
 * `varName` to sit inside a `{...}` group that {@link OBJECT_LITERAL_GROUP_RE} confirms opens in
 * an expression position, not a block/function body. Step 2 blanks out any nested `[...]`/`(...)`
 * within that group's own captured content ({@link maskBracketsAndParens}), so a value nested
 * inside a property isn't visible to the final check. Step 3, against the masked content,
 * requires `varName` to sit directly between `{`/`,` and `,`/`}` with no colon after it (so an
 * ordinary `varName: something` key-value pair inside the SAME object, or a `.varName` access, is
 * not mistaken for a shorthand hand-off).
 *
 * Excludes the three shapes where `{ varName }` is a destructuring BINDING, not a value hand-off
 * (CodeRabbit's review on this PR's own #818, `const { o } = x;` false-firing as if `o: Options`
 * were spread): a destructuring assignment ({@link destructuringAssignmentPattern}, shared
 * verbatim with {@link buildFieldReadPatterns} so the two checks can never disagree on that
 * shape), a destructured function parameter ({@link destructuringFirstParamPattern} — its own,
 * stricter pattern; see that function's doc for why it is NOT the shared one), and a destructured
 * `for`-loop binding ({@link destructuringForLoopPattern}).
 */
function hasShorthandHandoff(varName: string, window: string): boolean {
  if (destructuringAssignmentPattern(varName).test(window)) return false;
  if (destructuringFirstParamPattern(varName).test(window)) return false;
  if (destructuringForLoopPattern(varName).test(window)) return false;
  const shorthandWithinBraces = new RegExp(`[{,]\\s*${escapeRegExp(varName)}\\s*[,}]`);
  // `matchAll` clones its regex internally, so reusing the shared global-flagged constant here
  // is safe and doesn't leak `lastIndex` state across calls.
  for (const m of window.matchAll(OBJECT_LITERAL_GROUP_RE)) {
    if (shorthandWithinBraces.test(`{${maskBracketsAndParens(m[1])}}`)) return true;
  }
  return false;
}

/**
 * Char-offset `[start, end)` ranges of every interface/type-literal BODY in `content` (reusing
 * the same header regexes and brace matcher {@link findTypeDeclarations} does, without needing
 * its member-extraction work). Used by {@link chunkHasWholesaleConsumption} to recognize when a
 * `name: TypeName`-shaped match is actually a PROPERTY declaration inside one of these bodies,
 * not a variable annotation — flagged on this PR's own review: an unrelated interface's own
 * property (`interface Wrapper { option: Options; }`) would otherwise be captured as if `option`
 * were a real variable, and a coincidental shorthand reference to that name elsewhere could then
 * wrongly count as a wholesale hand-off of `Options`.
 *
 * Deliberately does NOT include class bodies, unlike {@link findTypeDeclarations}'s own kind
 * enumeration — flagged as a follow-up finding on this PR's own review (lien-stats summary for
 * commit 8196028): an interface/type-literal body is ALWAYS pure property territory (no method
 * BODIES, only signatures), but a class body also contains full method bodies with their own
 * genuine parameters and local variables — treating the WHOLE class body as property territory
 * would wrongly exclude those from the shorthand-handoff check too. A genuine class FIELD
 * declaration (`class Foo { bar: SomeType; }`) keeps the same pre-existing, narrower imprecision
 * this function targets for interfaces/type-literals specifically — accepted as a smaller,
 * localized residual rather than reintroducing the broader class-method-body bug.
 */
function declarationBodyRanges(content: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const headerRe of [INTERFACE_HEADER_RE, TYPE_LITERAL_HEADER_RE]) {
    for (const m of content.matchAll(new RegExp(headerRe.source, 'g'))) {
      const openIdx = m.index + m[0].length - 1;
      const closeIdx = findMatchingBraceFrom(content, openIdx);
      if (closeIdx !== -1) ranges.push({ start: openIdx, end: closeIdx });
    }
  }
  return ranges;
}

/** Does `index` fall inside any of `ranges`? */
function isWithinAnyRange(index: number, ranges: Array<{ start: number; end: number }>): boolean {
  return ranges.some(r => index >= r.start && index < r.end);
}

/**
 * Does a `: typeName` type annotation appear with a spread, `JSON.stringify(`, or a shorthand-
 * property hand-off of the SAME annotated variable, within {@link WHOLESALE_PROXIMITY_CHARS}
 * characters AFTER it, anywhere in this chunk? Requiring the annotation — not just the bare type
 * name — matters: a doc comment or an unrelated field merely NAMING the type
 * (`RuleTriggers.filePatterns` in a docstring, `triggers: RuleTriggers` three unrelated fields
 * away from someone else's spread) is not evidence any VALUE of this type is ever spread/
 * serialized/handed off. Comments are masked first, so a prose mention can't itself count as the
 * annotation. Still coarse (proximity, not real data-flow — the nearby spread/stringify need not
 * touch the SAME variable the annotation introduced), but far tighter than "the type name and a
 * spread anywhere in the same file", which false-fired on this module's OWN doc comment
 * mentioning `RuleTriggers` during dogfooding. The shorthand-property check is scoped tighter
 * still — it only fires for a shorthand reference to the SPECIFIC variable the annotation named,
 * not "any object literal with shorthand keys nearby" (see {@link hasShorthandHandoff}) — and
 * never treats a captured name as a variable at all when the match sits inside an interface/
 * type-literal BODY ({@link declarationBodyRanges}), where `name: TypeName` is a property
 * declaration, not a variable annotation (deliberately NOT class bodies — see that function's
 * doc for why).
 */
function chunkHasWholesaleConsumption(typeName: string, content: string): boolean {
  const masked = maskComments(content);
  const declRanges = declarationBodyRanges(masked);
  const typedRe = typedAnnotationRegex(typeName);
  for (const m of masked.matchAll(typedRe)) {
    const varName = m[1];
    const isPropertyDeclaration = varName !== undefined && isWithinAnyRange(m.index, declRanges);
    const windowStart = m.index + m[0].length;
    const window = masked.slice(windowStart, windowStart + WHOLESALE_PROXIMITY_CHARS);
    if (WHOLESALE_RE.test(window)) return true;
    if (varName && !isPropertyDeclaration && hasShorthandHandoff(varName, window)) return true;
  }
  return false;
}

/** Does any corpus chunk show wholesale consumption evidence for `typeName`? */
function hasWholesaleConsumption(typeName: string, repoChunks: CodeChunk[]): boolean {
  for (const chunk of repoChunks) {
    if (!chunk.content.includes(typeName)) continue;
    if (chunkHasWholesaleConsumption(typeName, chunk.content)) return true;
  }
  return false;
}

function isSuppressedType(
  typeName: string,
  file: string,
  repoChunks: CodeChunk[],
  cache: Map<string, boolean>,
): boolean {
  const key = `${file}:${typeName}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const suppressed =
    isReachableFromIndexBarrel(typeName, file, repoChunks) ||
    hasWholesaleConsumption(typeName, repoChunks);
  cache.set(key, suppressed);
  return suppressed;
}

// ---------------------------------------------------------------------------
// Read-site detection
// ---------------------------------------------------------------------------

/**
 * The "gap" between a JSX tag's opening `<Tag` and the attribute name this pattern is looking
 * for: either an ordinary non-`<`/`>`/`{`/`}` character, OR one WHOLE single-level `{...}`
 * expression container consumed as one unit. The latter is what stops a PRIOR attribute's brace
 * expression from being scanned character-by-character — CodeRabbit's review on this PR's own
 * #818 found `<div className={ timeout }>` false-matched field `timeout` as if it were an
 * attribute NAME, because the naive `[^<>]*` gap could wander INSIDE that expression and land on
 * the local variable `timeout` used as its VALUE. Consuming a `{...}` group in one bite means the
 * scan can only ever test a candidate match at a position that is a genuine attribute-name slot,
 * never partway through a value expression. No ambiguity between the two alternatives at any
 * position (a `{` can only start the second branch, everything else can only match the first),
 * so this doesn't reintroduce catastrophic-backtracking risk — see {@link JSX_ATTR_SCAN_CHARS}.
 */
const JSX_ATTR_GAP = `(?:[^<>{}]|\\{[^{}]*\\})`;

/**
 * A JSX attribute usage of `name` on any element (`<div name="...">`, `<Foo name />`,
 * `<Foo name={expr}>`) — see module doc's "JSX attribute usage" note. Requires whitespace
 * directly before the name (so a longer identifier merely ENDING in `name`, e.g. `className`
 * for field `name`, can't match) and `=`/whitespace/a (self-)closing `>` directly after (so a
 * longer identifier STARTING with `name` can't match either). Bounded to
 * {@link JSX_ATTR_SCAN_CHARS} REPETITIONS of {@link JSX_ATTR_GAP} (not an unbounded `*`), so
 * this pattern's worst case stays linear regardless of input size.
 */
function buildJsxAttrReadPattern(name: string): RegExp {
  const esc = escapeRegExp(name);
  return new RegExp(
    `<[A-Za-z](?:${JSX_ATTR_GAP}){0,${JSX_ATTR_SCAN_CHARS}}\\s${esc}\\b(?:=|\\s|/?>)`,
  );
}

/**
 * Destructuring-assignment shape for `name`: `const { name } = obj;` / `const { name }: T = obj;`
 * / `({ name } = obj)`. Shared with {@link hasShorthandHandoff}'s exclusion check — see that
 * function's doc for why.
 */
function destructuringAssignmentPattern(name: string): RegExp {
  const esc = escapeRegExp(name);
  return new RegExp(`\\{[^{}]*\\b${esc}\\b[^{}]*\\}\\s*(?::\\s*[\\w.<>[\\],\\s]+)?=(?!=)`);
}

/**
 * Destructuring function-parameter shape for `name`: `function f({ name }: T)` / `({ name }) =>`.
 * Shared with {@link hasShorthandHandoff}'s exclusion check — see that function's doc for why.
 */
function destructuringParamPattern(name: string): RegExp {
  const esc = escapeRegExp(name);
  return new RegExp(`\\([^()]*\\{[^{}]*\\b${esc}\\b[^{}]*\\}`);
}

/**
 * Read patterns for one field name. Excludes only a PLAIN simple assignment
 * (`.field = value`, the pure-write/population shape) — compound assignment
 * (`+=`) and increment/decrement (`++`/`--`) read-then-write, so they count
 * as reads, same as an equality comparison (`===`).
 */
function buildFieldReadPatterns(name: string): RegExp[] {
  const esc = escapeRegExp(name);
  const notPlainWrite = `(?!\\s*=(?!=))`;
  return [
    // Dot-access read: `obj.field`, excluding `obj.field = value`.
    new RegExp(`\\.${esc}\\b${notPlainWrite}`),
    // Bracket string-literal access read: `obj['field']`/`obj["field"]`, excluding `obj['field'] = value`.
    new RegExp(`\\[\\s*['"\`]${esc}['"\`]\\s*\\]${notPlainWrite}`),
    // Destructuring assignment: `const { field } = obj;` / `const { field }: T = obj;`.
    destructuringAssignmentPattern(name),
    // Destructuring function parameter: `function f({ field }: T)` / `({ field }) =>`.
    destructuringParamPattern(name),
    // JSX attribute usage: `<div field="...">` / `<Foo field />` / `<Foo field={expr}>`.
    buildJsxAttrReadPattern(name),
  ];
}

function isDeclarationSite(chunk: CodeChunk, file: string, decl: TypeDeclaration): boolean {
  return (
    chunk.metadata.file === file &&
    chunk.metadata.startLine <= decl.declEndLine &&
    decl.declStartLine <= chunk.metadata.endLine
  );
}

/** Is there any read site for `fieldName` in the corpus, outside the declaring type's own chunk(s)? */
function hasReadSite(
  fieldName: string,
  file: string,
  decl: TypeDeclaration,
  repoChunks: CodeChunk[],
): boolean {
  const patterns = buildFieldReadPatterns(fieldName);
  for (const chunk of repoChunks) {
    if (isDeclarationSite(chunk, file, decl)) continue;
    if (!chunk.content.includes(fieldName)) continue;
    const masked = maskCommentsAndProseStrings(chunk.content);
    if (patterns.some(re => re.test(masked))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// computeUnreadFieldCandidates
// ---------------------------------------------------------------------------

/**
 * Re-derive each changed file's declarations, keyed by `kind:typeName:file`,
 * for the read-site exclusion — cheap (bounded by the small number of changed
 * files), and keeps `AddedField`'s public shape free of internal
 * declaration-range bookkeeping. Split out to keep
 * {@link computeUnreadFieldCandidates} flat.
 */
function buildDeclarationIndex(context: ReviewContext): Map<string, TypeDeclaration> {
  const declByKey = new Map<string, TypeDeclaration>();
  for (const file of context.pr?.patches?.keys() ?? []) {
    if (!TS_JS_FILE_RE.test(file) || TEST_PATH_RE.test(file)) continue;
    if (isGeneratedDeclarationFile(file, context.chunks)) continue; // FP trap: generated .d.ts
    for (const chunk of context.chunks) {
      if (chunk.metadata.file !== file) continue;
      for (const decl of findTypeDeclarations(chunk.content, chunk.metadata.startLine)) {
        declByKey.set(`${decl.kind}:${decl.typeName}:${file}`, decl);
      }
    }
  }
  return declByKey;
}

/** Keep only added fields whose type isn't suppressed and which have no read site. Split out to keep {@link computeUnreadFieldCandidates} flat. */
function filterUnreadCandidates(
  added: AddedField[],
  declByKey: Map<string, TypeDeclaration>,
  repoChunks: CodeChunk[],
): UnreadFieldCandidate[] {
  const suppressionCache = new Map<string, boolean>();
  const out: UnreadFieldCandidate[] = [];

  for (const a of added) {
    const decl = declByKey.get(`${a.kind}:${a.typeName}:${a.file}`);
    if (!decl) continue;
    if (isSuppressedType(a.typeName, a.file, repoChunks, suppressionCache)) continue;
    if (hasReadSite(a.field, a.file, decl, repoChunks)) continue;
    out.push({ typeName: a.typeName, field: a.field, file: a.file, line: a.line, kind: a.kind });
  }

  return out;
}

/**
 * The full `<unread_field_candidates>` worklist: every interface member /
 * type-literal property / class field this PR added that has no read site
 * anywhere else in the indexed corpus. Exposed for testing.
 */
export function computeUnreadFieldCandidates(context: ReviewContext): UnreadFieldCandidate[] {
  const added = computeAddedFields(context);
  if (added.length === 0) return [];
  const repoChunks = context.repoChunks;
  if (!repoChunks || repoChunks.length === 0) return [];

  const declByKey = buildDeclarationIndex(context);
  const out = filterUnreadCandidates(added, declByKey, repoChunks);
  out.sort((x, y) => x.file.localeCompare(y.file) || x.line - y.line);
  return out;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const HEADER =
  'Pre-computed by a deterministic diff scan — the added-field discovery AND the ' +
  'corpus-wide read-site sweep are done for you; do not re-grep for consumers. Each entry ' +
  'is an interface member / type-literal property / class field this PR ADDED with no ' +
  'dot-access, bracket-access, or destructuring reference anywhere else in the indexed ' +
  'codebase — only its own declaration. Confirm before reporting: if the field is genuinely ' +
  'never consumed by any caller, and the gap is not already disclosed in this PR or an ' +
  'intentional part of an external/public-API contract, report it under incomplete-handling. ' +
  'This is a textual match over a possibly-incomplete indexed snapshot, not a verified ' +
  'judgment, and it does NOT substitute for incomplete-handling’s get_files_context / ' +
  'read_file / grep_codebase calls on the field’s would-be consumers before deciding the ' +
  'omission is a real gap rather than an intentional, external, or already-disclosed one.';

function renderCandidateEntry(c: UnreadFieldCandidate): string {
  return `- ${c.typeName}.${c.field} (${c.kind}, added in ${c.file}:${c.line}) — no read site found anywhere in the indexed codebase`;
}

/**
 * Render unread-field candidates as an `<unread_field_candidates>` block for
 * the agent's initial message. Returns '' when there are none so callers can
 * append unconditionally. Caps at MAX_CANDIDATES and MAX_BLOCK_CHARS with an
 * explicit omission note — never truncates silently. Exposed for testing.
 */
export function renderUnreadFieldCandidates(candidates: UnreadFieldCandidate[]): string {
  if (candidates.length === 0) return '';

  const lines: string[] = ['<unread_field_candidates>', HEADER];
  let used = lines.join('\n').length;
  let rendered = 0;

  for (const c of candidates.slice(0, MAX_CANDIDATES)) {
    const entry = renderCandidateEntry(c);
    if (used + entry.length + 1 > MAX_BLOCK_CHARS) break;
    lines.push(entry);
    used += entry.length + 1;
    rendered++;
  }

  const omitted = candidates.length - rendered;
  if (omitted > 0) {
    lines.push(
      `- [+${omitted} more unread field candidate(s) omitted to respect the input budget — inspect the diff for the rest]`,
    );
  }

  lines.push('</unread_field_candidates>');
  return lines.join('\n');
}

/**
 * Build the `<unread_field_candidates>` section from the review context.
 * Returns '' when the PR adds no interface/type-literal/class field with no
 * read site, or there's no diff/repo index to check against.
 */
export function renderUnreadFieldSection(context: ReviewContext): string {
  return renderUnreadFieldCandidates(computeUnreadFieldCandidates(context));
}
