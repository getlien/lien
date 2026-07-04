/**
 * Deterministic "rename sweep" signal for PR reviews.
 *
 * A mechanical rename (`semantic_search` → `search_code` across 40 files) is the
 * failure mode that anesthetizes an LLM reviewer: the diff is huge, uniform, and
 * "obviously fine", so the agent skims it and reports nothing. But a token-swap
 * inside a comment, docstring, or string literal carries a CLAIM — "reports as
 * disabled without embeddings", "meaning-based search" — that was renamed but
 * never re-verified. PR #658 did exactly this; Lien Review found nothing while
 * CodeRabbit caught two stale-prose claims that the rename silently invalidated.
 *
 * This module pre-computes the structural fact instead of hoping the agent
 * reviews every file hard, mirroring the `<stale_literal_candidates>` /
 * `<untrusted_input_sites>` precedents: infer the identifier substitution(s) the
 * diff repeats across many files, then hand the agent two short, explicit
 * worklists per mapping:
 *   1. PROSE-TOUCHED LINES — changed lines where the swap landed inside a
 *      comment/docstring/string; each frames "verify the claim still holds".
 *   2. SURVIVORS — occurrences of the OLD name still present (the rename may be
 *      incomplete).
 *
 * It injects FACTS (mapping + file:line + the post-image sentence), never a
 * verdict — the agent still judges each item. Everything here is computed from
 * the diff (and, when available, the indexed repo chunks); ZERO LLM calls.
 */

import type { CodeChunk } from '@liendev/parser';
import type { ReviewContext } from './plugin-types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** An identifier substitution A → B the diff repeats across the PR. */
export interface RenameMapping {
  /** Old identifier (removed side). */
  from: string;
  /** New identifier (added side). */
  to: string;
  /** How many changed lines carry this exact swap. */
  occurrenceCount: number;
  /** How many distinct files carry this swap. */
  fileCount: number;
}

/** A changed line where the A → B swap landed inside prose. */
export interface ProseTouchedLine {
  file: string;
  /** New-file line number of the (post-image) changed line. */
  line: number;
  /** Where the swap sits: 'doc' (prose file) | 'comment' | 'docstring' | 'string'. */
  kind: ProseKind;
  /** The post-image line text (trimmed, capped). */
  sentence: string;
}

/** A surviving occurrence of the OLD name after the sweep. */
export interface SurvivorSite {
  file: string;
  line: number;
  snippet: string;
  /** True when found repo-wide (an untouched file), false when in the diff post-image. */
  repoWide: boolean;
}

/** The full signal for one detected rename mapping. */
export interface RenameSweepSignal {
  mapping: RenameMapping;
  proseTouched: ProseTouchedLine[];
  /** Prose lines dropped by the cap (0 when none). */
  proseOverflow: number;
  survivors: SurvivorSite[];
  /** Survivor sites dropped by the cap (0 when none). */
  survivorOverflow: number;
}

type ProseKind = 'doc' | 'comment' | 'docstring' | 'string';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * A rename is a "sweep" only when the SAME A → B substitution repeats at least
 * this many times across at least this many files. Below either bound it's an
 * ordinary edit the agent already reviews line-by-line — flagging it would be
 * noise. Tuned deliberately conservative: a real codemod trips both easily.
 */
const MIN_OCCURRENCES = 5;
const MIN_FILES = 3;

/** Max mappings reported (most-repeated first) — keeps the prompt compact. */
const MAX_MAPPINGS = 5;
/** Max prose-touched lines listed per mapping. */
const MAX_PROSE_LINES = 12;
/** Max surviving old-name sites listed per mapping. */
const MAX_SURVIVORS = 12;
/** Snippet/sentence length cap. */
const MAX_SNIPPET_CHARS = 160;

/**
 * Identifiers that are language keywords, not renameable symbols. A codemod like
 * `let`→`const` or `func`→`fn` is a real sweep but carries no prose claims and
 * its "survivors" (every remaining `let`) are pure noise, so such mappings are
 * dropped. Kept small and cross-language; the occurrence/file threshold catches
 * the rest.
 */
const KEYWORDS = new Set([
  'let',
  'const',
  'var',
  'def',
  'func',
  'fn',
  'function',
  'class',
  'struct',
  'interface',
  'type',
  'enum',
  'int',
  'str',
  'bool',
  'true',
  'false',
  'null',
  'none',
  'nil',
  'undefined',
  'if',
  'else',
  'elif',
  'for',
  'while',
  'switch',
  'case',
  'return',
  'import',
  'export',
  'from',
  'as',
  'new',
  'this',
  'self',
  'async',
  'await',
  'public',
  'private',
  'static',
  'void',
]);

/** Shortest identifier worth treating as a renamed symbol. */
const MIN_TOKEN_LENGTH = 3;

/** Splits a line into alternating [glue, identifier, glue, identifier, …]. */
const IDENTIFIER_SPLIT_RE = /([A-Za-z_][A-Za-z0-9_]*)/;
/** Quoted string spans (single/double/backtick), matching the stale-literal heuristic. */
const STRING_RE = /(['"`])((?:\\.|(?!\1).)*?)\1/g;
/** Leading comment / JSDoc / HTML-comment markers. */
const LINE_COMMENT_LEAD_RE = /^\s*(\/\/|#|\*|\/\*|<!--|--)/;
/** File extensions whose every line is prose. */
const PROSE_FILE_RE = /\.(md|mdx|markdown|txt|rst|adoc)$/i;
const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// ---------------------------------------------------------------------------
// Diff scanning
// ---------------------------------------------------------------------------

interface SwapOccurrence {
  from: string;
  to: string;
  file: string;
  /** New-file line of the added (post-image) side of the swap. */
  line: number;
  /** The post-image line text. */
  addedText: string;
}

/** One post-image (context or added) line of a changed file. */
interface PostImageLine {
  line: number;
  text: string;
}

interface DiffScan {
  occurrences: SwapOccurrence[];
  /** Post-image lines (context + added) per changed file — the survivor scan's source-1. */
  postImageByFile: Map<string, PostImageLine[]>;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `token` appears in `text` as a whole identifier (word-boundary). */
function lineHasToken(text: string, token: string): boolean {
  // Word boundaries via [A-Za-z0-9_] lookaround so `semantic_search` never
  // matches inside `semantic_search_v2`.
  const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(token)}(?![A-Za-z0-9_])`);
  return re.test(text);
}

/**
 * Infer the single identifier substitution turning `removed` into `added`, or
 * null when they differ by anything other than a consistent A → B token swap.
 *
 * Both lines are split into alternating glue/identifier segments. For a clean
 * rename: the arrays are the same length, every glue segment is identical, and
 * every differing identifier position is the SAME (from → to) pair. Anything
 * else (glue changed, a number changed, two different mappings on one line)
 * returns null — we only trust an unambiguous mechanical swap.
 */
export function inferSingleTokenSwap(
  removed: string,
  added: string,
): { from: string; to: string } | null {
  const rem = removed.split(IDENTIFIER_SPLIT_RE);
  const add = added.split(IDENTIFIER_SPLIT_RE);
  if (rem.length !== add.length) return null;

  let from: string | null = null;
  let to: string | null = null;

  for (let i = 0; i < rem.length; i++) {
    if (rem[i] === add[i]) continue;
    // Even indices are glue (punctuation/whitespace/numbers); a difference there
    // means this isn't a pure identifier swap.
    if (i % 2 === 0) return null;
    if (from === null) {
      from = rem[i];
      to = add[i];
    } else if (from !== rem[i] || to !== add[i]) {
      return null; // a second, different mapping on the same line — ambiguous
    }
  }

  if (from === null || to === null || from === to) return null;
  return { from, to };
}

/** Reject mappings that are keywords or too short to be meaningful symbols. */
function isMeaningfulRename(from: string, to: string): boolean {
  if (from.length < MIN_TOKEN_LENGTH || to.length < MIN_TOKEN_LENGTH) return false;
  if (KEYWORDS.has(from) || KEYWORDS.has(to)) return false;
  return true;
}

/**
 * Pair the removed/added lines within each change block and record every
 * consistent single-token swap, plus the post-image lines per file. A change
 * block is a maximal run of `-`/`+` lines; unified diff emits all removals then
 * all additions, so pairing removed[i] with added[i] recovers the swap.
 */
function scanDiff(patches: Map<string, string>): DiffScan {
  const occurrences: SwapOccurrence[] = [];
  const postImageByFile = new Map<string, PostImageLine[]>();

  for (const [file, patch] of patches) {
    const postImage: PostImageLine[] = [];
    let removedBuf: string[] = [];
    let addedBuf: PostImageLine[] = [];
    let newLine = 0;

    const flush = (): void => {
      const pairs = Math.min(removedBuf.length, addedBuf.length);
      for (let i = 0; i < pairs; i++) {
        const swap = inferSingleTokenSwap(removedBuf[i], addedBuf[i].text);
        if (swap && isMeaningfulRename(swap.from, swap.to)) {
          occurrences.push({
            from: swap.from,
            to: swap.to,
            file,
            line: addedBuf[i].line,
            addedText: addedBuf[i].text,
          });
        }
      }
      removedBuf = [];
      addedBuf = [];
    };

    for (const raw of patch.split('\n')) {
      const header = raw.match(HUNK_HEADER_RE);
      if (header) {
        flush();
        newLine = parseInt(header[1], 10);
        continue;
      }
      if (raw.startsWith('+++') || raw.startsWith('---')) continue;
      if (raw.startsWith('\\')) continue; // "\ No newline at end of file"

      if (raw.startsWith('+')) {
        const text = raw.slice(1);
        addedBuf.push({ line: newLine, text });
        postImage.push({ line: newLine, text });
        newLine++;
      } else if (raw.startsWith('-')) {
        removedBuf.push(raw.slice(1));
        // a removed line does not advance the new-file counter
      } else {
        flush(); // context line ends the change block
        postImage.push({ line: newLine, text: raw.startsWith(' ') ? raw.slice(1) : raw });
        newLine++;
      }
    }
    flush();

    postImageByFile.set(file, postImage);
  }

  return { occurrences, postImageByFile };
}

// ---------------------------------------------------------------------------
// Sweep detection
// ---------------------------------------------------------------------------

interface MappingGroup {
  mapping: RenameMapping;
  occurrences: SwapOccurrence[];
}

/** Group swap occurrences by (from,to) and keep those meeting the sweep threshold. */
function groupSweeps(occurrences: SwapOccurrence[]): { groups: MappingGroup[]; capped: boolean } {
  const byMapping = new Map<string, SwapOccurrence[]>();
  for (const occ of occurrences) {
    const key = `${occ.from} ${occ.to}`;
    const list = byMapping.get(key);
    if (list) list.push(occ);
    else byMapping.set(key, [occ]);
  }

  const groups: MappingGroup[] = [];
  for (const list of byMapping.values()) {
    const fileCount = new Set(list.map(o => o.file)).size;
    if (list.length < MIN_OCCURRENCES || fileCount < MIN_FILES) continue;
    groups.push({
      mapping: {
        from: list[0].from,
        to: list[0].to,
        occurrenceCount: list.length,
        fileCount,
      },
      occurrences: list,
    });
  }

  groups.sort((a, b) => b.mapping.occurrenceCount - a.mapping.occurrenceCount);
  const capped = groups.length > MAX_MAPPINGS;
  return { groups: groups.slice(0, MAX_MAPPINGS), capped };
}

/**
 * Detect rename sweeps from the diff alone. Exposed for testing — returns the
 * mappings that meet the occurrence/file threshold, most-repeated first.
 */
export function detectRenameSweeps(patches: Map<string, string>): RenameMapping[] {
  return groupSweeps(scanDiff(patches).occurrences).groups.map(g => g.mapping);
}

// ---------------------------------------------------------------------------
// Prose classification
// ---------------------------------------------------------------------------

/** Character spans of quoted-string regions on a line. */
function stringSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const m of text.matchAll(STRING_RE)) {
    if (m.index === undefined) continue;
    spans.push([m.index, m.index + m[0].length]);
  }
  return spans;
}

function indexInsideAnySpan(index: number, spans: Array<[number, number]>): boolean {
  return spans.some(([start, end]) => index >= start && index < end);
}

/** Index of the first `//` or `#` line-comment marker not inside a string, or -1. */
function commentMarkerIndex(text: string, spans: Array<[number, number]>): number {
  let best = -1;
  for (const marker of ['//', '#']) {
    let from = 0;
    for (;;) {
      const idx = text.indexOf(marker, from);
      if (idx === -1) break;
      if (!indexInsideAnySpan(idx, spans)) {
        if (best === -1 || idx < best) best = idx;
        break;
      }
      from = idx + marker.length;
    }
  }
  return best;
}

/**
 * Classify whether the `token` swap on the post-image line `text` of `file`
 * landed inside prose (comment / docstring / string / prose-file), and which.
 * Returns null when the swap is in live code.
 *
 * Heuristics (documented, deliberately not a parser):
 *  - a prose file extension (.md, .txt, …) → the whole line is prose ('doc');
 *  - a triple-quote (`"""` / `'''`) enclosing the token → 'docstring';
 *  - the token inside any quoted-string span → 'string';
 *  - a leading `//` `#` `*` `/*` `<!--` `--`, or the token sitting after a
 *    trailing `//`/`#` marker → 'comment'.
 */
export function classifyProseSwap(text: string, token: string, file: string): ProseKind | null {
  if (PROSE_FILE_RE.test(file)) return 'doc';

  const occ = new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(token)}(?![A-Za-z0-9_])`, 'g');
  const indices: number[] = [];
  for (let m = occ.exec(text); m !== null; m = occ.exec(text)) indices.push(m.index);
  if (indices.length === 0) return null;

  const spans = stringSpans(text);
  const insideString = indices.some(i => indexInsideAnySpan(i, spans));
  if (insideString) {
    // A triple-quoted region reads as a docstring; a normal quote is a string.
    return /"""|'''/.test(text) ? 'docstring' : 'string';
  }

  if (LINE_COMMENT_LEAD_RE.test(text)) return 'comment';

  const marker = commentMarkerIndex(text, spans);
  if (marker !== -1 && indices.some(i => i > marker)) return 'comment';

  return null;
}

// ---------------------------------------------------------------------------
// Survivor scan
// ---------------------------------------------------------------------------

/**
 * Find occurrences of the OLD name `from` still present after the sweep:
 *  - source 1: the post-image (context + added) lines of changed files, from the
 *    diff — always available. A renamed line carries `to`, not `from`, so any
 *    `from` hit here is a genuine survivor (missed spot or stale context).
 *  - source 2 (optional): repo chunks of files NOT in the diff — catches "swept
 *    40 files, forgot the 41st". Skipped when no repo index is present. Changed
 *    files are owned by source 1, so there's no double counting.
 *
 * Deduped by file:line. Capped, with the dropped count returned separately.
 */
function findSurvivors(
  from: string,
  postImageByFile: Map<string, PostImageLine[]>,
  changedFiles: Set<string>,
  repoChunks: CodeChunk[] | undefined,
): { sites: SurvivorSite[]; overflow: number } {
  const seen = new Set<string>();
  const all: SurvivorSite[] = [];

  const record = (file: string, line: number, text: string, repoWide: boolean): void => {
    if (!lineHasToken(text, from)) return;
    const key = `${file}:${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    all.push({ file, line, snippet: text.trim().slice(0, MAX_SNIPPET_CHARS), repoWide });
  };

  // Source 1: diff post-image of changed files.
  for (const [file, lines] of postImageByFile) {
    for (const { line, text } of lines) record(file, line, text, false);
  }

  // Source 2: repo-wide, untouched files only.
  if (repoChunks) {
    for (const chunk of repoChunks) {
      const file = chunk.metadata.file;
      if (changedFiles.has(file)) continue;
      const lines = chunk.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        record(file, chunk.metadata.startLine + i, lines[i], true);
      }
    }
  }

  const overflow = Math.max(0, all.length - MAX_SURVIVORS);
  return { sites: all.slice(0, MAX_SURVIVORS), overflow };
}

// ---------------------------------------------------------------------------
// Signal assembly
// ---------------------------------------------------------------------------

/** Collect the prose-touched lines for one mapping, deduped by file:line and capped. */
function collectProseTouched(group: MappingGroup): {
  lines: ProseTouchedLine[];
  overflow: number;
} {
  const seen = new Set<string>();
  const lines: ProseTouchedLine[] = [];
  for (const occ of group.occurrences) {
    const kind = classifyProseSwap(occ.addedText, occ.to, occ.file);
    if (!kind) continue;
    const key = `${occ.file}:${occ.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({
      file: occ.file,
      line: occ.line,
      kind,
      sentence: occ.addedText.trim().slice(0, MAX_SNIPPET_CHARS),
    });
  }
  const overflow = Math.max(0, lines.length - MAX_PROSE_LINES);
  return { lines: lines.slice(0, MAX_PROSE_LINES), overflow };
}

/**
 * Compute the rename-sweep signals from the review context. Returns [] when
 * there's no diff or no detected sweep. Mappings whose sweep was fully clean
 * (no prose claims touched, no surviving old name) are dropped — there's
 * nothing for the agent to verify.
 */
export function computeRenameSweepSignals(context: ReviewContext): RenameSweepSignal[] {
  const patches = context.pr?.patches;
  if (!patches || patches.size === 0) return [];

  const { occurrences, postImageByFile } = scanDiff(patches);
  const { groups } = groupSweeps(occurrences);
  if (groups.length === 0) return [];

  const changedFiles = new Set(patches.keys());
  const signals: RenameSweepSignal[] = [];

  for (const group of groups) {
    const prose = collectProseTouched(group);
    const survivors = findSurvivors(
      group.mapping.from,
      postImageByFile,
      changedFiles,
      context.repoChunks,
    );
    if (prose.lines.length === 0 && survivors.sites.length === 0) continue;
    signals.push({
      mapping: group.mapping,
      proseTouched: prose.lines,
      proseOverflow: prose.overflow,
      survivors: survivors.sites,
      survivorOverflow: survivors.overflow,
    });
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const LEAD = [
  'Pre-computed by a deterministic diff scan (no grep needed — done for you). This PR applies one or',
  'more MECHANICAL identifier renames across many files. The risk is not the code swaps (the agent',
  'sees those) but token-swaps that landed inside comments, docstrings, or strings: those carry CLAIMS',
  'that were renamed but never re-verified (the classic rename-sweep miss). For each mapping below:',
  '(1) for every PROSE-TOUCHED line, read the post-image sentence and confirm the claim it now makes is',
  'still TRUE of the new name — emit a finding if the sentence is now stale or false;',
  '(2) for every SURVIVOR, decide whether that old-name reference should have been renamed too — emit a',
  'finding if the rename is incomplete. Stay silent on an item only after checking it.',
].join(' ');

/**
 * Render rename-sweep signals as a `<rename_sweep>` block for the agent's
 * initial message. Returns '' when there are no signals so callers can append
 * unconditionally.
 */
export function renderRenameSweepSignals(signals: RenameSweepSignal[]): string {
  if (signals.length === 0) return '';

  const lines: string[] = [];
  lines.push('<rename_sweep>');
  lines.push(LEAD);

  for (const s of signals) {
    lines.push('');
    lines.push(
      `- Mapping \`${s.mapping.from}\` → \`${s.mapping.to}\` ` +
        `(${s.mapping.occurrenceCount} occurrences across ${s.mapping.fileCount} files):`,
    );

    if (s.proseTouched.length > 0) {
      lines.push(`  Prose-touched lines — verify each claim still holds of \`${s.mapping.to}\`:`);
      for (const p of s.proseTouched) {
        lines.push(`    - ${p.file}:${p.line} (${p.kind})  \`${p.sentence}\``);
      }
      if (s.proseOverflow > 0) {
        lines.push(
          `    - [+${s.proseOverflow} more prose-touched line(s) — scan the diff for the rest]`,
        );
      }
    }

    if (s.survivors.length > 0) {
      lines.push(
        `  Surviving \`${s.mapping.from}\` references — should these have been renamed too?`,
      );
      for (const v of s.survivors) {
        const tag = v.repoWide ? ' (untouched file)' : '';
        lines.push(`    - ${v.file}:${v.line}${tag}  \`${v.snippet}\``);
      }
      if (s.survivorOverflow > 0) {
        lines.push(
          `    - [+${s.survivorOverflow} more surviving reference(s) — grep \`${s.mapping.from}\` for the rest]`,
        );
      }
    }
  }

  lines.push('</rename_sweep>');
  return lines.join('\n');
}

/**
 * Build the `<rename_sweep>` section from the review context. Returns '' when
 * there is no diff or no rename sweep worth flagging. Callers append
 * unconditionally.
 */
export function renderRenameSweepSection(context: ReviewContext): string {
  return renderRenameSweepSignals(computeRenameSweepSignals(context));
}
