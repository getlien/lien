/**
 * Deterministic "removed public export" signal for PR reviews.
 *
 * Two rules share this signal:
 *  - structural-analysis, whose prompt used to tell the model to
 *    "grep_codebase for EACH removed symbol" — the grep-and-reason
 *    anti-pattern CLAUDE.md's design principle warns against; and
 *  - boundary-change, which needs to cross-check a removed public export
 *    against what the PR's changeset claims (a removal a changeset calls
 *    "unchanged" is a contradiction — the real escape on PR #711).
 *
 * This module pre-computes the structural facts instead, mirroring the
 * `<stale_literal_candidates>` / `<doc_claims>` precedents: parse each
 * file's diff for exported symbols the PR REMOVES (minus any re-added
 * anywhere — a moved/renamed-file export is not a removal), then scan the
 * indexed head corpus for chunks that STILL reference each removed symbol
 * outside its own file. A surviving reference is a near-certain breaking
 * change; a removed export a changeset describes as unchanged is a
 * documentation contradiction. Both facts are injected as a
 * `<removed_exports>` block so the agent confirms a handed-to-it worklist
 * rather than discovering it via blind grep.
 *
 * Scope is deliberately TS/JS (this repo's surface) plus a cheap Rust
 * `pub` shape (the structural-analysis canary is a Rust testbed file).
 */

import type { CodeChunk } from '@liendev/parser';
import type { ReviewContext } from './plugin-types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A symbol this PR removes from a module's exported surface. */
export interface RemovedExport {
  /** Public export name; a default export is recorded as `default (X)`. */
  symbol: string;
  /** First file the diff removed this symbol from. */
  file: string;
}

/** A surviving occurrence of a removed export, outside its own file. */
export interface ExportReference {
  file: string;
  line: number;
}

/** A removed export with its surviving references and any changeset mention. */
export interface RemovedExportContext {
  symbol: string;
  file: string;
  survivingReferences: ExportReference[];
  /** The `.changeset/*.md` file that mentions this symbol, or null. */
  changesetFile: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max removed exports listed — keeps the block compact. */
const MAX_ENTRIES = 15;
/** Max surviving references listed per symbol. */
const MAX_REFS_PER_SYMBOL = 5;
/** Total block character budget. */
const MAX_BLOCK_CHARS = 4_000;

/** Files whose diffs we parse for export declarations (this repo's code surface). */
const CODE_FILE_RE = /\.(?:[cm]?[jt]sx?|rs)$/;
/** A top-level changeset entry (public-API claims live here). */
const CHANGESET_FILE_RE = /(?:^|\/)\.changeset\/[^/]+\.md$/;

const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(.*)$/;
/** An `export {` / `export type {` list opener (the brace right after export). */
const EXPORT_LIST_OPEN_RE = /\bexport\s+(?:type\s+)?\{/;
const DEFAULT_PREFIX = 'default (';

// ---------------------------------------------------------------------------
// Declaration / member parsing
// ---------------------------------------------------------------------------

const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

/**
 * Parse the members of an `export { ... }` body (the text between braces, or
 * one bare member line). Each member's PUBLIC name is taken — the alias for
 * `A as B` (and `default as B`), the bare name otherwise; a leading `type`
 * modifier is stripped. Non-identifier fragments are dropped.
 */
function parseMemberList(body: string): string[] {
  const out: string[] = [];
  for (const raw of body.split(',')) {
    const cleaned = raw.trim().replace(/^type\s+/, '');
    if (!cleaned) continue;
    const parts = cleaned.split(/\s+as\s+/);
    const name = parts[parts.length - 1].trim();
    if (IDENT_RE.test(name)) out.push(name);
  }
  return out;
}

/**
 * The exported symbol(s) a single declaration line publishes, or [] when the
 * line is not an export declaration. Handles the TS/JS shapes (function,
 * class, const/let/var, interface, type alias, enum, inline `export { … }`
 * list, `export * as X`, `export default function/class X`) plus a cheap Rust
 * `pub` item shape. The leading `+`/`-` must already be stripped.
 */
function extractExportSymbolsFromDeclLine(code: string): string[] {
  const t = code.trim();

  const inlineList = t.match(/^export\s+(?:type\s+)?\{([^}]*)\}/);
  if (inlineList) return parseMemberList(inlineList[1]);

  const patterns: Array<[RegExp, (name: string) => string]> = [
    [/^export\s+default\s+(?:async\s+)?(?:function\*?|class)\s+([A-Za-z_$][\w$]*)/, defaultName],
    [/^export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from/, identity],
    [/^export\s+(?:declare\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/, identity],
    [/^export\s+(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, identity],
    [/^export\s+(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, identity],
    [/^export\s+(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, identity],
    [/^export\s+(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/, identity],
    [/^export\s+(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)/, identity],
    // Rust: module-level `pub` items are the crate's exported surface.
    [/^pub\s+(?:async\s+|unsafe\s+|const\s+)*fn\s+([A-Za-z_][\w]*)/, identity],
    [/^pub\s+(?:struct|enum|trait|type|const|static)\s+([A-Za-z_][\w]*)/, identity],
  ];

  for (const [re, format] of patterns) {
    const m = t.match(re);
    if (m) return [format(m[1])];
  }
  return [];
}

function identity(name: string): string {
  return name;
}
function defaultName(name: string): string {
  return `${DEFAULT_PREFIX}${name})`;
}

/**
 * Update `inList` (are we inside a multi-line `export { … }` block?) for one
 * code line. Only an `export {`-shaped opener starts a block (a function body's
 * bare `{` must not), and any `}` closes it. Deliberately brace-count-free —
 * export member bodies don't nest braces.
 */
function updateListState(inList: boolean, code: string): boolean {
  if (inList) return !code.includes('}');
  if (!EXPORT_LIST_OPEN_RE.test(code)) return false;
  // Opener only counts if the list isn't also closed on the same line.
  const braceIdx = code.indexOf('{', code.search(EXPORT_LIST_OPEN_RE));
  return !code.includes('}', braceIdx);
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

interface PatchExportScan {
  removed: RemovedExport[];
  added: Set<string>;
}

/** A line's export symbols in the given block state, updating that state. */
function symbolsForLine(code: string, inList: boolean): { symbols: string[]; inList: boolean } {
  const decl = extractExportSymbolsFromDeclLine(code);
  const symbols = decl.length > 0 ? decl : inList ? parseMemberList(stripCloser(code)) : [];
  return { symbols, inList: updateListState(inList, code) };
}

/** Drop a trailing `}`/`} from '…'` so a closer line's members parse cleanly. */
function stripCloser(code: string): string {
  const brace = code.indexOf('}');
  return brace === -1 ? code : code.slice(0, brace);
}

/**
 * Walk one file's unified-diff patch, collecting exported symbols the diff
 * removes (`-` lines) and adds (`+` lines). The old-file view (context + `-`)
 * and new-file view (context + `+`) each track their own `export { … }` block
 * state so a bare member line is only read as an export inside a list.
 */
interface ScanState {
  removed: RemovedExport[];
  added: Set<string>;
  inListOld: boolean;
  inListNew: boolean;
}

/** Apply a removed (`-`) line: collect its export symbols, advance old state. */
function applyRemovedLine(state: ScanState, code: string, file: string): void {
  const r = symbolsForLine(code, state.inListOld);
  for (const s of r.symbols) state.removed.push({ symbol: s, file });
  state.inListOld = r.inList;
}

/** Apply an added (`+`) line: collect its export symbols, advance new state. */
function applyAddedLine(state: ScanState, code: string): void {
  const r = symbolsForLine(code, state.inListNew);
  for (const s of r.symbols) state.added.add(s);
  state.inListNew = r.inList;
}

/** Apply a context line: advances both views' block state identically. */
function applyContextLine(state: ScanState, code: string): void {
  const next = updateListState(state.inListOld, code);
  state.inListOld = next;
  state.inListNew = next;
}

/** Route one raw diff line to the matching state transition. */
function processDiffLine(state: ScanState, raw: string, file: string): void {
  if (raw.startsWith('+++') || raw.startsWith('---')) return;

  const hunk = raw.match(HUNK_HEADER_RE);
  if (hunk) {
    state.inListOld = state.inListNew = updateListState(false, hunk[1]);
    return;
  }

  if (raw.startsWith('-')) applyRemovedLine(state, raw.slice(1), file);
  else if (raw.startsWith('+')) applyAddedLine(state, raw.slice(1));
  else applyContextLine(state, raw.startsWith(' ') ? raw.slice(1) : raw);
}

function scanPatchExports(file: string, patch: string): PatchExportScan {
  const state: ScanState = { removed: [], added: new Set(), inListOld: false, inListNew: false };
  for (const raw of patch.split('\n')) processDiffLine(state, raw, file);
  return { removed: state.removed, added: state.added };
}

/**
 * Collect every exported symbol this PR removes, minus any re-added on a `+`
 * export line ANYWHERE in the PR (a moved/renamed-file export is not a
 * removal). Deduped by symbol, keeping the first file it was removed from.
 * Skips non-code files. Exposed for testing.
 */
export function extractRemovedExports(patches: Map<string, string>): RemovedExport[] {
  const removedRaw: RemovedExport[] = [];
  const added = new Set<string>();

  for (const [file, patch] of patches) {
    if (!CODE_FILE_RE.test(file)) continue;
    const scan = scanPatchExports(file, patch);
    removedRaw.push(...scan.removed);
    for (const s of scan.added) added.add(s);
  }

  const out: RemovedExport[] = [];
  const seen = new Set<string>();
  for (const entry of removedRaw) {
    if (added.has(entry.symbol) || seen.has(entry.symbol)) continue;
    seen.add(entry.symbol);
    out.push(entry);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Surviving-reference scan
// ---------------------------------------------------------------------------

/** The bare name to search for, or null for a default export (no stable name). */
function searchableName(symbol: string): string | null {
  return symbol.startsWith(DEFAULT_PREFIX) ? null : symbol;
}

function wordBoundaryRe(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`);
}

interface SymbolSpec {
  symbol: string;
  file: string;
  re: RegExp;
}

/** Record word-boundary matches of one symbol within one chunk (capped). */
function addLineRefs(
  chunk: CodeChunk,
  spec: SymbolSpec,
  refsBySymbol: Map<string, ExportReference[]>,
  seen: Set<string>,
): void {
  const refs = refsBySymbol.get(spec.symbol) ?? [];
  const lines = chunk.content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (refs.length >= MAX_REFS_PER_SYMBOL) break;
    if (!spec.re.test(lines[i])) continue;
    const line = chunk.metadata.startLine + i;
    const key = `${chunk.metadata.file}:${line}:${spec.symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ file: chunk.metadata.file, line });
  }
  refsBySymbol.set(spec.symbol, refs);
}

/** Scan one chunk for every not-yet-capped symbol not removed from this file. */
function collectRefsFromChunk(
  chunk: CodeChunk,
  specs: SymbolSpec[],
  refsBySymbol: Map<string, ExportReference[]>,
  seen: Set<string>,
): void {
  const file = chunk.metadata.file;
  let content: string | undefined;
  for (const spec of specs) {
    if (spec.file === file) continue; // its own removal site is not a survivor
    const refs = refsBySymbol.get(spec.symbol);
    if (refs && refs.length >= MAX_REFS_PER_SYMBOL) continue;
    content ??= chunk.content;
    if (!content.includes(spec.symbol)) continue; // fast reject before per-line regex
    addLineRefs(chunk, spec, refsBySymbol, seen);
  }
}

/**
 * For each removed export, find chunks in the head corpus that STILL reference
 * it (word-boundary) outside the file it was removed from — the breakage
 * candidates. Default exports are skipped (no stable importable name). Exposed
 * for testing.
 */
export function findSurvivingReferences(
  removed: RemovedExport[],
  repoChunks: CodeChunk[] | undefined,
): Map<string, ExportReference[]> {
  const refsBySymbol = new Map<string, ExportReference[]>();
  if (!repoChunks || repoChunks.length === 0) return refsBySymbol;

  const specs: SymbolSpec[] = [];
  for (const r of removed) {
    const name = searchableName(r.symbol);
    if (name) specs.push({ symbol: r.symbol, file: r.file, re: wordBoundaryRe(name) });
  }
  if (specs.length === 0) return refsBySymbol;

  const seen = new Set<string>();
  for (const chunk of repoChunks) collectRefsFromChunk(chunk, specs, refsBySymbol, seen);
  return refsBySymbol;
}

// ---------------------------------------------------------------------------
// Changeset cross-check
// ---------------------------------------------------------------------------

/**
 * For each removed export, the `.changeset/*.md` file (if any) whose ADDED
 * lines mention the symbol — the claim-vs-reality angle for boundary-change.
 * Exposed for testing.
 */
export function changesetMentions(
  removed: RemovedExport[],
  patches: Map<string, string>,
): Map<string, string> {
  const mentions = new Map<string, string>();
  const changesets: Array<{ file: string; added: string[] }> = [];
  for (const [file, patch] of patches) {
    if (!CHANGESET_FILE_RE.test(file)) continue;
    const added = patch.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
    changesets.push({ file, added });
  }
  if (changesets.length === 0) return mentions;

  for (const r of removed) {
    const name = searchableName(r.symbol);
    if (!name) continue;
    const re = wordBoundaryRe(name);
    const hit = changesets.find(cs => cs.added.some(l => re.test(l)));
    if (hit) mentions.set(r.symbol, hit.file);
  }
  return mentions;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * The `<removed_exports>` worklist for a review: removed exports, each with its
 * surviving references and any changeset mention. Sorted breakage-first
 * (most surviving references first), then changeset-mentioned, then the rest;
 * ties broken by symbol name for determinism. Returns [] when no diff.
 */
export function computeRemovedExportContexts(context: ReviewContext): RemovedExportContext[] {
  const patches = context.pr?.patches;
  if (!patches || patches.size === 0) return [];

  const removed = extractRemovedExports(patches);
  if (removed.length === 0) return [];

  const refs = findSurvivingReferences(removed, context.repoChunks);
  const mentions = changesetMentions(removed, patches);

  const contexts = removed.map(r => ({
    symbol: r.symbol,
    file: r.file,
    survivingReferences: refs.get(r.symbol) ?? [],
    changesetFile: mentions.get(r.symbol) ?? null,
  }));

  contexts.sort((a, b) => {
    const byRefs = b.survivingReferences.length - a.survivingReferences.length;
    if (byRefs !== 0) return byRefs;
    const byChangeset = Number(!!b.changesetFile) - Number(!!a.changesetFile);
    if (byChangeset !== 0) return byChangeset;
    return a.symbol.localeCompare(b.symbol);
  });

  return contexts;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const HEADER =
  'Pre-computed by a deterministic diff scan — the removed-symbol discovery ' +
  'AND the reference sweep are done for you; do NOT re-grep these. Each entry ' +
  "is a symbol this PR removes from a module's exported surface, with any " +
  'SURVIVING references found in the head corpus. A surviving reference is a ' +
  'near-certain breaking change — verify and report it (structural-analysis). ' +
  'A removed export that a changeset describes as unchanged/non-breaking is a ' +
  'contradiction (boundary-change). No surviving references + accurate ' +
  'changeset = likely intentional; stay silent.';

/** Render one removed-export entry line. */
function renderEntry(c: RemovedExportContext): string {
  const refs = c.survivingReferences;
  const refList =
    refs.length > 0
      ? refs.map(r => `${r.file}:${r.line}`).join(', ')
      : 'none found in the head corpus';
  const changeset = c.changesetFile ? `; described in changeset ${c.changesetFile}` : '';
  return `- ${c.symbol} (removed from ${c.file}) — ${refs.length} surviving reference(s): ${refList}${changeset}`;
}

/**
 * Render removed-export contexts as a `<removed_exports>` block for the agent's
 * initial message. Returns '' when there are none so callers can append
 * unconditionally. Caps at MAX_ENTRIES and MAX_BLOCK_CHARS with an explicit
 * omission note. Exposed for testing.
 */
export function renderRemovedExports(contexts: RemovedExportContext[]): string {
  if (contexts.length === 0) return '';

  const lines: string[] = ['<removed_exports>', HEADER];
  let used = lines.join('\n').length;
  let rendered = 0;

  for (const c of contexts.slice(0, MAX_ENTRIES)) {
    const entry = renderEntry(c);
    if (used + entry.length + 1 > MAX_BLOCK_CHARS) break;
    lines.push(entry);
    used += entry.length + 1;
    rendered++;
  }

  const omitted = contexts.length - rendered;
  if (omitted > 0) {
    lines.push(
      `- [+${omitted} more removed export(s) omitted to respect the input budget — inspect the diff for the rest]`,
    );
  }

  lines.push('</removed_exports>');
  return lines.join('\n');
}

/**
 * Build the `<removed_exports>` section from the review context. Returns ''
 * when the PR removes no exported symbols (or there is no diff).
 */
export function renderRemovedExportsSection(context: ReviewContext): string {
  return renderRemovedExports(computeRemovedExportContexts(context));
}
