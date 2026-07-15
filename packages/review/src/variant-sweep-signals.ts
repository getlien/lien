/**
 * Deterministic "enum/union-variant consumer sweep" signal for PR reviews.
 *
 * Provenance: the omission-pass design doc (`.wip/omission-pass-design.md`,
 * §6 item 2) names this as the most promising, ready-to-build v1 item —
 * `incomplete-handling`'s prompt today just tells the agent to "grep for all
 * consumers" of a newly-added field/variant (`rules.ts`, the
 * `INCOMPLETE_HANDLING` rule) — the exact grep-and-reason anti-pattern
 * CLAUDE.md's design principle warns against, and the same anti-pattern
 * `removed-export-signals.ts` and `catch-discrimination-signals.ts` already
 * replaced for their own shapes (PR #770's catch-discrimination signal is
 * the direct template for this module's wiring).
 *
 * The shape: a PR ADDS a member to an enum, a new arm to a union type, or a
 * new key to a `const X = {...} as const` value-map — and a switch/if-chain/
 * mapping-table elsewhere that enumerates the family's OTHER (pre-existing)
 * members was never updated to cover it. This module pre-computes both
 * halves of that fact deterministically:
 *   1. `computeAddedVariants` — parse each changed file's diff for a member
 *      added to an EXISTING enum/union/const-object declaration (a brand
 *      new declaration has no prior consumers to go stale, so it's not a
 *      candidate).
 *   2. `computeVariantSweepContexts` — for each added variant, resolve the
 *      family's full current (post-PR) membership from the changed-file
 *      chunk, then sweep the head corpus (`repoChunks`) for a switch/
 *      if-chain/mapping site that references >= 2 of the family's OTHER
 *      members but never mentions the new one.
 *
 * Conservative by design: a consumer must reference at least two EXISTING
 * members to count as "enumerating the family" — a single reference is far
 * too common a coincidence (e.g. one specific case handled on purpose,
 * unrelated identifier reuse) to be worth an agent's attention. Silence is
 * the correct default; the agent's own judgment (documented/intentional,
 * heuristic false positive) is the backstop for the rest, exactly per the
 * design doc's §2 "LLM judgment's job."
 *
 * v1 scope, stated honestly:
 *  - TS/JS only (this repo's own surface).
 *  - Three family shapes: `enum X { ... }`, `type X = A | B | C` (single- or
 *    simple multi-line pipe-style, arms that are bare string/numeric
 *    literals or plain identifiers only — an inline object-shaped arm like
 *    `{ kind: 'x' }` is NOT parsed, a documented gap), and `const X = {
 *    ...} as const` value-maps (the `as const` suffix is REQUIRED — an
 *    ordinary object literal without it is deliberately never treated as a
 *    variant family, so a coincidental object literal with keys that happen
 *    to match some other family's member names is never misread as one;
 *    this directly satisfies the "non-enum object literals" case).
 *  - Consumer detection requires a DOT-QUALIFIED reference (`TypeName.
 *    Member`) for enum/const-object members — the idiomatic, high-precision
 *    form (`case Color.Red:`, `x === Color.Red`, `[Color.Red]: ...`). Union
 *    members (string/numeric literals, no natural qualifier) fall back to
 *    the bare quoted/keyed literal value, which is lower precision by
 *    construction — documented, not papered over.
 *  - A consumer site is only ever a `case` label, an equality comparison
 *    (`===`/`==`/`!==`/`!=`), an `instanceof` check (union-of-identifier
 *    arms), or an object-literal key (bare or computed `[Type.Member]`) —
 *    not a full control-flow/exhaustiveness analysis. A family member
 *    referenced only through a helper function is invisible to this scan,
 *    same caveat `catch-discrimination-signals.ts` documents for its own
 *    shallow textual check.
 *  - Brace/body extraction for enum and const-object bodies stops at the
 *    FIRST unmatched-depth `}` via simple depth counting with string/
 *    comment skipping — a member whose VALUE itself contains a nested
 *    object is not expected for these idiomatic shapes and is a documented
 *    limitation, not a crash.
 */

import type { CodeChunk } from '@liendev/parser';
import type { ReviewContext } from './plugin-types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VariantFamilyKind = 'enum' | 'union' | 'const-object';

/** A member/arm/key this PR adds to an existing enum, union, or const-object family. */
export interface AddedVariant {
  typeName: string;
  variant: string;
  file: string;
  kind: VariantFamilyKind;
}

/** A site elsewhere in the head corpus that enumerates the family but omits the new variant. */
export interface VariantConsumerSite {
  file: string;
  line: number;
  /** The family's OTHER (pre-existing) members this site was found to reference. */
  handledVariants: string[];
}

/** One added variant with the stale consumer sites found for it. */
export interface VariantSweepContext {
  typeName: string;
  variant: string;
  file: string;
  kind: VariantFamilyKind;
  consumers: VariantConsumerSite[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max (typeName, variant) entries rendered — keeps the block compact. */
const MAX_ENTRIES = 12;
/** Max consumer sites listed per added variant. */
const MAX_CONSUMERS_PER_VARIANT = 5;
/** Max existing-variant names listed per consumer site ("handles: A, B, ..."). */
const MAX_HANDLED_LISTED = 6;
/** Total block character budget. */
const MAX_BLOCK_CHARS = 4_000;
/** A consumer must reference at least this many EXISTING members to count as "enumerating the family". */
const MIN_EXISTING_REFERENCES = 2;

/** Files whose diffs/chunks we scan (this repo's TS/JS surface — v1 scope). */
const TS_JS_FILE_RE = /\.(?:[cm]?[jt]sx?)$/;

const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

const VALID_IDENT_RE = /^[A-Za-z_$][\w$]*$/;

const ENUM_HEADER_RE =
  /\b(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)\s*\{/g;
const CONST_OBJECT_HEADER_RE =
  /\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)(?:\s*:\s*[^=\n]+)?\s*=\s*\{/g;
const UNION_HEADER_RE = /\b(?:export\s+)?type\s+([A-Za-z_$][\w$]*)(?:\s*<[^=\n]*>)?\s*=\s*/g;

// ---------------------------------------------------------------------------
// Low-level text utilities
// ---------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Skip a quoted string/template literal (`'`, `"`, or `` ` ``), returning the index after it. */
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

/** If `text[i]` starts a string/template literal or a `//`/`/* *‍/` comment, its span; else null. */
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

/**
 * Replace every span `shouldMask` accepts with same-length whitespace
 * (preserving newlines, so line numbers computed from the result still
 * match the original); spans it rejects are copied through unchanged.
 * Shared by {@link maskComments} (strings kept — union member values are
 * quoted literals) and {@link maskCommentsAndStrings} (used only to locate
 * declaration HEADERS safely, since a docstring/fixture string quoting
 * `enum Foo {` as prose must never be read as a real declaration).
 */
function maskSpans(text: string, shouldMask: (kind: Span['kind']) => boolean): string {
  let i = 0;
  let out = '';
  while (i < text.length) {
    const span = classifySpan(text, i);
    if (span === null) {
      out += text[i];
      i++;
      continue;
    }
    if (shouldMask(span.kind)) {
      for (let k = i; k < span.end; k++) out += text[k] === '\n' ? '\n' : ' ';
    } else {
      out += text.slice(i, span.end);
    }
    i = span.end;
  }
  return out;
}

function maskComments(text: string): string {
  return maskSpans(text, kind => kind === 'comment');
}

function maskCommentsAndStrings(text: string): string {
  return maskSpans(text, () => true);
}

/**
 * Find the index of the `}` matching the `{` at `openIdx`, skipping string
 * literals. Depth-aware. Callers pass comment-MASKED text (comments are
 * blanked to same-length whitespace upstream), so no comment span can hide a
 * stray brace here — only strings need skipping.
 */
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

/**
 * Find the index of the top-level `;` starting from `startIdx`, respecting
 * bracket nesting and skipping string literals. -1 if none. Callers pass
 * comment-masked text (see {@link findMatchingBraceFrom}).
 */
function findTopLevelSemicolon(content: string, startIdx: number): number {
  let depth = 0;
  let i = startIdx;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipStringLike(content, i);
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
    if (depth === 0 && ch === ';') return i;
    i++;
  }
  return -1;
}

interface Segment {
  text: string;
  offset: number;
}

/**
 * Split `text` on top-level occurrences of `sep` (a single character),
 * respecting `{}`/`()`/`[]` nesting and skipping string/template literals.
 * Each returned segment carries its start offset within `text` (before
 * trimming) so callers can compute line numbers.
 */
function splitTopLevel(text: string, sep: string): Segment[] {
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
    if (depth === 0 && ch === sep) {
      segments.push({ text: text.slice(start, i), offset: start });
      start = i + 1;
      i++;
      continue;
    }
    i++;
  }
  segments.push({ text: text.slice(start), offset: start });
  return segments;
}

function countNewlines(text: string, upTo: number): number {
  let n = 0;
  for (let i = 0; i < upTo; i++) {
    if (text[i] === '\n') n++;
  }
  return n;
}

/** The offset of the first non-whitespace character in `text` (its length if all whitespace). */
function leadingWhitespaceLength(text: string): number {
  return text.length - text.trimStart().length;
}

// ---------------------------------------------------------------------------
// Family declaration extraction (static, post-PR chunk content)
// ---------------------------------------------------------------------------

interface FamilyMember {
  name: string;
  line: number;
}

interface FamilyDeclaration {
  typeName: string;
  kind: VariantFamilyKind;
  members: FamilyMember[];
  declStartLine: number;
  declEndLine: number;
}

/** Extract a member's line number given the declaration body's start offset/line and a segment. */
function memberLine(content: string, baseLine: number, bodyStart: number, seg: Segment): number {
  const idx = bodyStart + seg.offset + leadingWhitespaceLength(seg.text);
  return baseLine + countNewlines(content, idx);
}

function findEnumDeclarations(content: string, baseLine: number): FamilyDeclaration[] {
  const out: FamilyDeclaration[] = [];
  const headerMask = maskCommentsAndStrings(content);
  const commentMasked = maskComments(content);
  for (const m of headerMask.matchAll(ENUM_HEADER_RE)) {
    const typeName = m[1];
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = findMatchingBraceFrom(commentMasked, openIdx);
    if (closeIdx === -1) continue;

    const bodyStart = openIdx + 1;
    const body = commentMasked.slice(bodyStart, closeIdx);
    const members: FamilyMember[] = [];
    for (const seg of splitTopLevel(body, ',')) {
      const t = seg.text.trim();
      if (!t) continue;
      const nm = t.match(/^([A-Za-z_$][\w$]*)/);
      if (!nm) continue;
      members.push({ name: nm[1], line: memberLine(content, baseLine, bodyStart, seg) });
    }

    out.push({
      typeName,
      kind: 'enum',
      members,
      declStartLine: baseLine + countNewlines(content, m.index),
      declEndLine: baseLine + countNewlines(content, closeIdx),
    });
  }
  return out;
}

/** Does `content` starting right after `closeIdx` read as `as const` (allowing whitespace)? */
function hasAsConstMarker(content: string, closeIdx: number): boolean {
  return /^\s*as\s+const\b/.test(content.slice(closeIdx + 1, closeIdx + 40));
}

function findConstObjectDeclarations(content: string, baseLine: number): FamilyDeclaration[] {
  const out: FamilyDeclaration[] = [];
  const headerMask = maskCommentsAndStrings(content);
  const commentMasked = maskComments(content);
  for (const m of headerMask.matchAll(CONST_OBJECT_HEADER_RE)) {
    const typeName = m[1];
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = findMatchingBraceFrom(commentMasked, openIdx);
    if (closeIdx === -1) continue;
    // The `as const` suffix is the confidence marker that this object literal
    // is meant as a variant family, not an ordinary config/options object —
    // see the module doc's "non-enum object literals" note.
    if (!hasAsConstMarker(content, closeIdx)) continue;

    const bodyStart = openIdx + 1;
    const body = commentMasked.slice(bodyStart, closeIdx);
    const members: FamilyMember[] = [];
    for (const seg of splitTopLevel(body, ',')) {
      const t = seg.text.trim();
      if (!t) continue;
      const key = t.match(/^(?:['"]([^'"]+)['"]|([A-Za-z_$][\w$]*))\s*:/);
      if (!key) continue;
      members.push({ name: key[1] ?? key[2], line: memberLine(content, baseLine, bodyStart, seg) });
    }

    out.push({
      typeName,
      kind: 'const-object',
      members,
      declStartLine: baseLine + countNewlines(content, m.index),
      declEndLine: baseLine + countNewlines(content, closeIdx),
    });
  }
  return out;
}

/** Extract the variant name from a trimmed union arm, or null for an unsupported (complex/object) arm. */
function unionArmVariant(armText: string): string | null {
  const strLit = armText.match(/^['"]([^'"]*)['"]$/);
  if (strLit) return strLit[1];
  if (VALID_IDENT_RE.test(armText)) return armText;
  return null;
}

function findUnionDeclarations(content: string, baseLine: number): FamilyDeclaration[] {
  const out: FamilyDeclaration[] = [];
  const headerMask = maskCommentsAndStrings(content);
  const commentMasked = maskComments(content);
  for (const m of headerMask.matchAll(UNION_HEADER_RE)) {
    const typeName = m[1];
    const bodyStart = m.index + m[0].length;
    const semiIdx = findTopLevelSemicolon(commentMasked, bodyStart);
    if (semiIdx === -1) continue;

    const body = commentMasked.slice(bodyStart, semiIdx);
    const members: FamilyMember[] = [];
    for (const seg of splitTopLevel(body, '|')) {
      const t = seg.text.trim();
      if (!t) continue;
      const variant = unionArmVariant(t);
      if (variant === null) continue;
      members.push({ name: variant, line: memberLine(content, baseLine, bodyStart, seg) });
    }

    out.push({
      typeName,
      kind: 'union',
      members,
      declStartLine: baseLine + countNewlines(content, m.index),
      declEndLine: baseLine + countNewlines(content, semiIdx),
    });
  }
  return out;
}

/** All enum/union/const-object family declarations found in one chunk's (TS/JS) content. */
function findFamilyDeclarations(content: string, baseLine: number): FamilyDeclaration[] {
  return [
    ...findEnumDeclarations(content, baseLine),
    ...findConstObjectDeclarations(content, baseLine),
    ...findUnionDeclarations(content, baseLine),
  ];
}

// ---------------------------------------------------------------------------
// Diff-side: which new-file lines did this PR add, and what did it remove?
// ---------------------------------------------------------------------------

interface FileDiffFacts {
  /** New-file line numbers this PR added (`+` lines). */
  addedLines: Set<number>;
  /** Concatenated text of every `-` line — used both to tell a pure addition
   *  from a same-identifier value edit ({@link isGenuinelyNew}) and to tell a
   *  brand-new declaration from an existing one rewritten on one physical
   *  line ({@link existedBefore}). */
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

/**
 * A member is a genuine ADDITION (not a same-identifier value edit) when its
 * identifier never appears on a removed line of this file's patch. A rename
 * (old identifier removed, new one added) still counts as an addition here —
 * intentional; a stale consumer that only knows the old name is a real gap
 * whether or not `rename-sweep-signals.ts` also flags it (the design doc's
 * §4 explicitly accepts this overlap between signals).
 */
function isGenuinelyNew(name: string, removedText: string): boolean {
  return !new RegExp(`\\b${escapeRegExp(name)}\\b`).test(removedText);
}

/** The header regex for one family kind, as a fresh instance (matchAll needs its own `lastIndex`). */
function headerRegexFor(kind: VariantFamilyKind): RegExp {
  if (kind === 'enum') return new RegExp(ENUM_HEADER_RE.source, 'g');
  if (kind === 'const-object') return new RegExp(CONST_OBJECT_HEADER_RE.source, 'g');
  return new RegExp(UNION_HEADER_RE.source, 'g');
}

/** Does this file's removed text contain a header for this exact (kind, typeName)? */
function headerWasRemoved(kind: VariantFamilyKind, typeName: string, removedText: string): boolean {
  const masked = maskCommentsAndStrings(removedText);
  for (const m of masked.matchAll(headerRegexFor(kind))) {
    if (m[1] === typeName) return true;
  }
  return false;
}

/**
 * Did this declaration exist BEFORE this PR? True whenever its header line
 * was NOT itself added — the common case, whether the header sits far above
 * the touched member (untouched, not even in the diff's context window) or
 * right next to it (an unchanged context line). The one case where the
 * header line IS an added line but the declaration still pre-existed is a
 * single-line declaration rewritten wholesale (header and arms share one
 * physical line, e.g. `type X = A | B;` -> `type X = A | B | C;`) — there,
 * the OLD header text survives in a REMOVED line, so that's the fallback
 * check.
 */
function existedBefore(decl: FamilyDeclaration, facts: FileDiffFacts): boolean {
  if (!facts.addedLines.has(decl.declStartLine)) return true;
  return headerWasRemoved(decl.kind, decl.typeName, facts.removedText);
}

// ---------------------------------------------------------------------------
// computeAddedVariants
// ---------------------------------------------------------------------------

/**
 * Evaluate every family declaration found in one chunk against this file's
 * diff facts, pushing an {@link AddedVariant} for each genuinely-new member
 * whose line the diff touched. Split out of {@link computeAddedVariants} so
 * its own loop stays flat (mirrors `collectCandidatesFromChunk` in
 * `catch-discrimination-signals.ts`).
 */
function collectAddedVariantsFromChunk(
  chunk: CodeChunk,
  file: string,
  facts: FileDiffFacts,
  seen: Set<string>,
  out: AddedVariant[],
): void {
  for (const decl of findFamilyDeclarations(chunk.content, chunk.metadata.startLine)) {
    // A brand-new family this PR introduces has no prior consumers to go
    // stale — only a member added to an ALREADY-existing declaration counts.
    if (!existedBefore(decl, facts)) continue;

    for (const member of decl.members) {
      if (!facts.addedLines.has(member.line)) continue;
      if (!isGenuinelyNew(member.name, facts.removedText)) continue;

      const key = `${decl.kind}:${decl.typeName}:${member.name}:${file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ typeName: decl.typeName, variant: member.name, file, kind: decl.kind });
    }
  }
}

/**
 * Find every enum member / union arm / const-object-as-const key this PR
 * adds to an EXISTING family declaration (a brand-new declaration has no
 * prior consumers, so it's never a candidate). Exposed for testing.
 */
export function computeAddedVariants(context: ReviewContext): AddedVariant[] {
  const patches = context.pr?.patches;
  if (!patches || patches.size === 0) return [];
  const chunks = context.chunks;
  if (!chunks || chunks.length === 0) return [];

  const out: AddedVariant[] = [];
  const seen = new Set<string>();

  for (const [file, patch] of patches) {
    if (!TS_JS_FILE_RE.test(file)) continue;
    const facts = computeFileDiffFacts(patch);
    if (facts.addedLines.size === 0) continue;

    for (const chunk of chunks) {
      if (chunk.metadata.file === file)
        collectAddedVariantsFromChunk(chunk, file, facts, seen, out);
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Resolving a family's full (post-PR) membership
// ---------------------------------------------------------------------------

interface ResolvedFamily {
  existingVariants: string[];
  declStartLine: number;
  declEndLine: number;
}

/**
 * Re-locate the family's current (post-PR) declaration in the changed
 * file's chunks and return its members MINUS every variant this PR added to
 * it (`addedNames`) — i.e. the pre-existing membership a consumer would
 * have been written against. Null when the declaration can't be found
 * (defensive; the diff-side scan and this static re-scan use the same
 * parser, so this should only miss on exotic formatting). Exposed for
 * testing.
 */
export function resolveFamilyExisting(
  context: ReviewContext,
  file: string,
  kind: VariantFamilyKind,
  typeName: string,
  addedNames: Set<string>,
): ResolvedFamily | null {
  for (const chunk of context.chunks ?? []) {
    if (chunk.metadata.file !== file) continue;
    for (const decl of findFamilyDeclarations(chunk.content, chunk.metadata.startLine)) {
      if (decl.kind !== kind || decl.typeName !== typeName) continue;
      return {
        existingVariants: decl.members.map(m => m.name).filter(n => !addedNames.has(n)),
        declStartLine: decl.declStartLine,
        declEndLine: decl.declEndLine,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Consumer-site token patterns
// ---------------------------------------------------------------------------

interface TokenPatterns {
  /** `case X:` / equality-comparison / `instanceof X` style references. */
  references: RegExp[];
  /** Object-literal key style references (bare or computed). */
  mappingKeys: RegExp[];
}

/** Enum / const-object members are referenced dot-qualified: `TypeName.Member`. */
function buildQualifiedTokenPatterns(typeName: string, variant: string): TokenPatterns {
  const dot = `\\b${escapeRegExp(typeName)}\\.${escapeRegExp(variant)}\\b`;
  return {
    references: [
      new RegExp(`\\bcase\\s+${dot}\\s*:`),
      new RegExp(`${dot}\\s*(?:===|==|!==|!=)`),
      new RegExp(`(?:===|==|!==|!=)\\s*${dot}`),
    ],
    mappingKeys: [new RegExp(`\\[\\s*${dot}\\s*\\]\\s*:`)],
  };
}

/**
 * Union members (string/numeric literals or plain identifiers) have no
 * dot-qualifier — fall back to the bare quoted/keyed literal value, plus
 * `instanceof` for identifier arms (union-of-classes). Lower precision than
 * the qualified form by construction; documented in the module doc.
 */
function buildUnionTokenPatterns(variant: string): TokenPatterns {
  const v = escapeRegExp(variant);
  const quoted = `['"]${v}['"]`;
  const references = [
    new RegExp(`\\bcase\\s+${quoted}\\s*:`),
    new RegExp(`${quoted}\\s*(?:===|==|!==|!=)`),
    new RegExp(`(?:===|==|!==|!=)\\s*${quoted}`),
  ];
  const mappingKeys = [new RegExp(`${quoted}\\s*:`)];
  if (VALID_IDENT_RE.test(variant)) {
    references.push(new RegExp(`\\binstanceof\\s+${v}\\b`));
    mappingKeys.push(new RegExp(`\\b${v}\\s*:`));
  }
  return { references, mappingKeys };
}

function buildTokenPatterns(
  kind: VariantFamilyKind,
  typeName: string,
  variant: string,
): TokenPatterns {
  return kind === 'union'
    ? buildUnionTokenPatterns(variant)
    : buildQualifiedTokenPatterns(typeName, variant);
}

/** For each variant in `tokenMap` that has a matching reference in `content`, its first matching line (0-based). */
function collectMatchesInChunk(
  content: string,
  tokenMap: Map<string, TokenPatterns>,
): Map<string, number> {
  const masked = maskComments(content);
  const lines = masked.split('\n');
  const found = new Map<string, number>();

  for (const [variant, patterns] of tokenMap) {
    const all = [...patterns.references, ...patterns.mappingKeys];
    for (let i = 0; i < lines.length; i++) {
      if (all.some(re => re.test(lines[i]))) {
        found.set(variant, i);
        break;
      }
    }
  }

  return found;
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Cheap pre-check before running per-variant regexes against a chunk. */
function chunkMightReferenceFamily(
  chunk: CodeChunk,
  kind: VariantFamilyKind,
  typeName: string,
  allVariantNames: string[],
): boolean {
  if (kind !== 'union') return chunk.content.includes(typeName);
  return allVariantNames.some(v => chunk.content.includes(v));
}

// ---------------------------------------------------------------------------
// computeVariantSweepContexts
// ---------------------------------------------------------------------------

interface AddedVariantGroup {
  kind: VariantFamilyKind;
  typeName: string;
  file: string;
  variants: string[];
}

function groupAddedVariants(added: AddedVariant[]): AddedVariantGroup[] {
  const groups = new Map<string, AddedVariantGroup>();
  for (const a of added) {
    const key = `${a.kind}:${a.typeName}:${a.file}`;
    const g = groups.get(key);
    if (g) g.variants.push(a.variant);
    else
      groups.set(key, { kind: a.kind, typeName: a.typeName, file: a.file, variants: [a.variant] });
  }
  return [...groups.values()];
}

/** Sweep the head corpus for consumer sites of one added-variant group, split out to keep the orchestrator flat. */
function buildFamilyTokenMap(
  group: AddedVariantGroup,
  family: ResolvedFamily,
): Map<string, TokenPatterns> {
  const tokenMap = new Map<string, TokenPatterns>();
  for (const name of [...family.existingVariants, ...group.variants]) {
    tokenMap.set(name, buildTokenPatterns(group.kind, group.typeName, name));
  }
  return tokenMap;
}

/** Is `chunk` the family's own declaration site (never a consumer of itself)? */
function isDeclarationSite(
  chunk: CodeChunk,
  group: AddedVariantGroup,
  family: ResolvedFamily,
): boolean {
  return (
    chunk.metadata.file === group.file &&
    rangesOverlap(
      chunk.metadata.startLine,
      chunk.metadata.endLine,
      family.declStartLine,
      family.declEndLine,
    )
  );
}

/**
 * Evaluate one chunk against one added-variant group: if it enumerates
 * enough of the family's existing members, record a consumer site for each
 * added variant it does NOT also reference. Split out of
 * {@link sweepGroupConsumers} so its own loop stays flat.
 */
function recordChunkConsumers(
  chunk: CodeChunk,
  group: AddedVariantGroup,
  existingSet: Set<string>,
  tokenMap: Map<string, TokenPatterns>,
  byVariant: Map<string, VariantConsumerSite[]>,
  seenSite: Set<string>,
): void {
  const matches = collectMatchesInChunk(chunk.content, tokenMap);
  const matchedExisting = [...matches.keys()].filter(k => existingSet.has(k));
  if (matchedExisting.length < MIN_EXISTING_REFERENCES) return;

  const line = chunk.metadata.startLine + Math.min(...matchedExisting.map(v => matches.get(v)!));
  const handled = [...matchedExisting].sort();

  for (const variant of group.variants) {
    if (matches.has(variant)) continue; // this consumer already handles the new variant
    const siteKey = `${variant}:${chunk.metadata.file}:${line}`;
    if (seenSite.has(siteKey)) continue;
    seenSite.add(siteKey);
    const list = byVariant.get(variant) ?? [];
    list.push({ file: chunk.metadata.file, line, handledVariants: handled });
    byVariant.set(variant, list);
  }
}

function sweepGroupConsumers(
  context: ReviewContext,
  group: AddedVariantGroup,
  family: ResolvedFamily,
): Map<string, VariantConsumerSite[]> {
  const tokenMap = buildFamilyTokenMap(group, family);
  const existingSet = new Set(family.existingVariants);
  const allNames = [...family.existingVariants, ...group.variants];

  const byVariant = new Map<string, VariantConsumerSite[]>();
  const seenSite = new Set<string>();

  for (const chunk of context.repoChunks ?? []) {
    if (isDeclarationSite(chunk, group, family)) continue;
    if (!chunkMightReferenceFamily(chunk, group.kind, group.typeName, allNames)) continue;
    recordChunkConsumers(chunk, group, existingSet, tokenMap, byVariant, seenSite);
  }

  return byVariant;
}

/**
 * Build the (uncapped) `VariantSweepContext` list for one added-variant
 * group — resolve its pre-existing membership, sweep for consumers, and
 * emit one context per added variant that has at least one stale site.
 * Split out of {@link computeVariantSweepContexts} so its own loop, and this
 * one, both stay flat.
 */
function buildContextsForGroup(
  context: ReviewContext,
  group: AddedVariantGroup,
): VariantSweepContext[] {
  const addedNames = new Set(group.variants);
  const family = resolveFamilyExisting(context, group.file, group.kind, group.typeName, addedNames);
  if (!family || family.existingVariants.length === 0) return [];

  const byVariant = sweepGroupConsumers(context, group, family);
  const out: VariantSweepContext[] = [];

  for (const variant of group.variants) {
    const consumers = byVariant.get(variant);
    if (!consumers || consumers.length === 0) continue;
    consumers.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    out.push({
      typeName: group.typeName,
      variant,
      file: group.file,
      kind: group.kind,
      consumers: consumers.slice(0, MAX_CONSUMERS_PER_VARIANT),
    });
  }

  return out;
}

/** Most-consumers-affected first, then deterministic tie-breaks by type/variant name. */
function compareContexts(a: VariantSweepContext, b: VariantSweepContext): number {
  const byCount = b.consumers.length - a.consumers.length;
  if (byCount !== 0) return byCount;
  const byType = a.typeName.localeCompare(b.typeName);
  if (byType !== 0) return byType;
  return a.variant.localeCompare(b.variant);
}

/**
 * The full `<variant_sweep_candidates>` worklist: every enum/union/
 * const-object variant this PR added, paired with the (capped) consumer
 * sites found to enumerate the family's other members without it. Only
 * variants with at least one such site are included — there's nothing for
 * the agent to check otherwise. Exposed for testing.
 */
export function computeVariantSweepContexts(context: ReviewContext): VariantSweepContext[] {
  const added = computeAddedVariants(context);
  if (added.length === 0) return [];
  if (!context.repoChunks || context.repoChunks.length === 0) return [];

  const results = groupAddedVariants(added).flatMap(group => buildContextsForGroup(context, group));
  results.sort(compareContexts);
  return results;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const HEADER =
  'Pre-computed by a deterministic diff scan — the added-variant discovery AND ' +
  'the consumer sweep are done for you; do not re-grep for consumers. Each entry ' +
  'is an enum member / union arm / const-object key this PR ADDED to an existing ' +
  "family, with consumer site(s) elsewhere that reference >= 2 of the family's " +
  'OTHER members (a switch/if-chain/mapping enumerating the type) but never ' +
  'mention the new one. Confirm before reporting: if the consumer genuinely needs ' +
  "to handle this variant and doesn't (e.g. it isn't just an intentional catch-all " +
  'default, and the gap is not already disclosed in this PR), report it under ' +
  'incomplete-handling. If the omission is a deliberate fallback or already handled ' +
  'some other way, stay silent.';

function renderHandled(names: string[]): string {
  const shown = names.slice(0, MAX_HANDLED_LISTED);
  const omitted = names.length - shown.length;
  return omitted > 0 ? `${shown.join(', ')}, +${omitted} more` : shown.join(', ');
}

function renderContextEntry(c: VariantSweepContext): string {
  const sites = c.consumers
    .map(site => `${site.file}:${site.line} (handles: ${renderHandled(site.handledVariants)})`)
    .join('; ');
  return `- ${c.typeName}.${c.variant} (added in ${c.file}) — ${c.consumers.length} consumer site(s) not updated: ${sites}`;
}

/**
 * Render variant-sweep contexts as a `<variant_sweep_candidates>` block for
 * the agent's initial message. Returns '' when there are none so callers
 * can append unconditionally. Caps at MAX_ENTRIES and MAX_BLOCK_CHARS with
 * an explicit omission note — never truncates silently. Exposed for testing.
 */
export function renderVariantSweepCandidates(contexts: VariantSweepContext[]): string {
  if (contexts.length === 0) return '';

  const lines: string[] = ['<variant_sweep_candidates>', HEADER];
  let used = lines.join('\n').length;
  let rendered = 0;

  for (const c of contexts.slice(0, MAX_ENTRIES)) {
    const entry = renderContextEntry(c);
    if (used + entry.length + 1 > MAX_BLOCK_CHARS) break;
    lines.push(entry);
    used += entry.length + 1;
    rendered++;
  }

  const omitted = contexts.length - rendered;
  if (omitted > 0) {
    lines.push(
      `- [+${omitted} more added variant(s) omitted to respect the input budget — inspect the diff for the rest]`,
    );
  }

  lines.push('</variant_sweep_candidates>');
  return lines.join('\n');
}

/**
 * Build the `<variant_sweep_candidates>` section from the review context.
 * Returns '' when the PR adds no enum/union/const-object variant with a
 * stale consumer, or there's no diff/repo index to check against.
 */
export function renderVariantSweepSection(context: ReviewContext): string {
  return renderVariantSweepCandidates(computeVariantSweepContexts(context));
}
