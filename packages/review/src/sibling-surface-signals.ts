/**
 * Deterministic "sibling surface" signal for PR reviews — the omission-frontier attack.
 *
 * The weakest miss shape in the 2026-07 cross-repo study was omission: a bug that
 * is what ISN'T in the diff, so no reviewer (human, Sonnet, or Kimi) reliably finds
 * it. Two concrete cases motivate this module:
 *  - guzzle #3740: adds the `on_trailers` request option, wired through
 *    `CurlFactory.php` only — the sibling `StreamHandler.php` (same directory,
 *    same "handler" family) silently ignores it. Both Sonnet and Kimi missed it.
 *  - gin #3081: adds `binding/toml.go`, whose decode function ends with a
 *    duplicated `decoder.Decode(obj)` instead of the `return validate(obj)` every
 *    sibling binding (`json.go`, `xml.go`, `yaml.go`, ...) uses.
 *
 * Both are structural facts about a directory of same-extension "family" files,
 * not something an LLM needs to reason its way to — so, mirroring
 * `stale-literal-signals.ts` / `doc-claims-signals.ts`, this module precomputes
 * two directions and hands them to the agent as a `<sibling_surfaces>` block:
 *
 *  - Direction A ("unmirrored addition"): a feature-shaped literal/identifier the
 *    diff ADDED to one family member, absent from an untouched sibling.
 *  - Direction B ("family-pattern divergence"): a call-shaped identifier most
 *    untouched siblings share, absent from the changed/new file entirely.
 *
 * Threshold notes (tuned against the real fixtures, not just the illustrative
 * "200-file directory" anti-example):
 *  - Real same-extension families run bigger than a tidy top-level guess: guzzle's
 *    `src/Handler/` has 14 members, gin's `binding/` has 16. The family-size gate
 *    exists to exclude genuinely unrelated bulk directories (rack's `lib/rack/`
 *    has 42), not to exclude realistic package directories — capped at 20.
 *  - Direction A's corpus-rarity check counts occurrences OUTSIDE every file this
 *    PR touched, not merely outside F. `on_trailers` appears in 44 chunks outside
 *    `CurlFactory.php` alone — but every one of those chunks is in a file the PR
 *    ALSO changed (RequestOptions.php, Client.php, docs, tests): expected fan-out
 *    of wiring one new feature through several files, not pre-existing generic
 *    vocabulary. Outside the whole changed-file set, the count is 0.
 *  - Direction B's "shared by siblings" is a MAJORITY, not unanimous: gin's real
 *    `validate(` call appears in 9 of 13 untouched siblings, not all 13 (a few
 *    unrelated files like `any.go` never call it). Requiring unanimity would
 *    silently kill the positive.
 *
 * A second, independent family axis covers a gap the same-directory definition
 * cannot see: MIRROR DIRECTORIES. reqwest's `blocking/request.rs` and
 * `async_impl/request.rs` are the real sibling axis for "applied to one variant,
 * forgot the other" bugs (reqwest #916/#1550), but they live in different
 * directories, so the same-dir family never pairs them. A mirror sibling for a
 * changed `<dirA>/<base>.<ext>` is `<dirB>/<base>.<ext>` where dirA and dirB
 * share at least two same-basename+extension source files (the mirror-evidence
 * gate — one coincidental shared name like `utils.rs` must not create a family)
 * and dirB actually contains the counterpart file itself. Qualifying mirror
 * directories are capped at 3 per changed file: a basename like `index.ts`
 * shared across dozens of directories is noise, not a mirror relationship, so
 * exceeding the cap discards the mirror family for that file entirely rather
 * than truncating to the first 3. Mirror siblings feed both directions exactly
 * like same-dir siblings, except Direction B with a SINGLE mirror sibling (the
 * common case — most mirror relationships are 1:1 pairs, not larger clusters)
 * swaps the cross-file majority-share rule for a within-file repetition rule:
 * the identifier must occur at least twice in that one sibling, compensating
 * for a family too small for "majority" to mean anything. Rendered entries
 * that come from this axis are labeled "mirror sibling" so the reviewer can
 * tell the relationship apart from a same-directory one.
 *
 * Provenance: ported from PR #744 (`feat/sibling-surface-signals`), parked
 * as draft/YAGNI after a blind re-screen found the module non-regressive
 * and discovery-effective but with no *measured* detection lift — the
 * study's only omission-shaped miss (guzzle#3740) turned out to be a
 * *disclosed* limitation, so the mechanism declining it was correct
 * judgment, not a gap. The 2026-07-15 omission-pass design review
 * (`.wip/omission-pass-design.md`) revisited that verdict: a mislabeled
 * fixture is not proof the mechanism fails, so this ships as a plain
 * main-pass signal rather than staying parked for a dedicated evaluation
 * that may never materialize. Module logic and tests are unchanged from
 * #744 (mirror-directory extension included); only the wiring changed —
 * see `system-prompt.ts` for the `incomplete-handling` rule gate this
 * revival adds.
 */

import type { CodeChunk } from '@liendev/parser';
import type { ReviewContext } from './plugin-types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SiblingSurfaceDirection = 'unmirrored-addition' | 'family-pattern-divergence';

export interface SiblingSurfaceEntry {
  direction: SiblingSurfaceDirection;
  /** Display form: quoted for a string literal, bare for an identifier/call. */
  display: string;
  /** The file the entry is about: where it was added (A) or where it's missing (B). */
  file: string;
  /** New-file line the identifier was added on. Direction A only. */
  line?: number;
  /** Direction A: untouched siblings LACKING it. Direction B: untouched siblings SHARING it. */
  siblings: string[];
  /** True when `siblings` are mirror-directory siblings (cross-dir, same basename+ext), not same-directory family members. */
  isMirror: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Mirrors capture-pr.ts's NATIVE_SOURCE_EXT (defined locally — this module doesn't import the harness). */
const SOURCE_EXT_RE =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|php|go|rs|java|kt|swift|rb|cs|scala|c|cpp|cc|cxx|h|hpp)$/;
/**
 * Broader than stale-literal's `TEST_PATH_RE`: that one requires a LEADING
 * slash before `test(s)/`, so it misses a root-level `tests/` directory (no
 * leading slash to match) and languages that keep tests alongside source
 * instead of in a separate directory — Go's `binding_test.go` sits right next
 * to `binding.go` in the same package dir. Both matter here: an unfiltered
 * `tests/ClientTest.php` would be treated as its own "family" of test files,
 * and unfiltered `_test.go` siblings would inflate a real family (gin's
 * `binding/` is 16 source files, not 29 once `_test.go` is counted) past
 * MAX_FAMILY_SIZE, silently discarding the family entirely.
 */
const TEST_PATH_RE =
  /(^|\/)(tests?|specs?|__tests__)(\/|$)|\.(test|spec)\.|_test\.\w+$|_spec\.\w+$|[A-Z]\w*Test\.\w+$/;

/** A directory+extension group smaller than this has no "sibling" to omit from. */
const MIN_FAMILY_SIZE = 2;
/** A group larger than this is a bulk directory, not a family (see module doc). */
const MAX_FAMILY_SIZE = 20;

/** Minimum same-basename+ext file pairs two directories must share to count as "mirror directories" — the mirror-evidence gate. */
const MIN_MIRROR_SHARED_BASENAMES = 2;
/** More mirror directories than this qualifying for one file is noise (see module doc); discard the mirror family entirely rather than truncate. */
const MAX_MIRROR_DIRS_PER_FILE = 3;

/**
 * Directory "entry point" basenames — barrel/module-init files present in
 * nearly any directory regardless of its role, in the languages this module
 * scans. Sharing one of these between two directories is not evidence of a
 * deliberate mirror relationship, so it must not count toward the
 * mirror-evidence gate above — the same failure mode the module doc's
 * `utils.rs` example warns about, just for an even more common name. Found
 * empirically: `packages/cli/src/mcp/handlers/` and `packages/parser/src/`
 * (this very repo) share `dependency-analyzer.ts` (a real caller/callee pair,
 * not a mirror) plus `index.ts` — and `index.ts` alone was enough to clear a
 * naive 2-shared-basename gate.
 */
const GENERIC_ENTRYPOINT_BASENAMES = new Set([
  'index.ts',
  'index.tsx',
  'index.js',
  'index.jsx',
  'index.mjs',
  'index.cjs',
  '__init__.py',
  'mod.rs',
  'main.rs',
  'main.go',
  'main.py',
]);

const MAX_ENTRIES_PER_FILE_PER_DIRECTION = 5;
/** Bound on raw diff-added candidates considered per file before the corpus-rarity scan. */
const MAX_RAW_CANDIDATES_PER_FILE = 30;
/** Direction A: an identifier this common outside the PR's own changed files is generic vocab. */
const MAX_RARE_OCCURRENCES = 3;
const MIN_IDENTIFIER_CHARS = 4;
/** Safety net on total entries before rendering, mirroring stale-literal's MAX_CANDIDATES. */
const MAX_TOTAL_ENTRIES = 15;
/** Total block char budget — entries beyond this are dropped with an omission note. */
const MAX_BLOCK_CHARS = 3000;

const STRING_RE = /(['"`])((?:\\.|(?!\1).)*?)\1/g;
const CAMEL_ID_RE = /\b[A-Za-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+\b/g;
const SNAKE_ID_RE = /\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b/g;
const CALL_RE = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Generic short strings with no cross-file identity — not a useful omission signal. */
const LOW_SIGNAL_STRINGS = new Set(['true', 'false', 'null', 'undefined', 'none']);

/**
 * Call-shaped tokens that are control-flow keywords or common stdlib/builtin
 * calls, not feature surface. Broader than reserved words: a bare `push(`,
 * `join(`, or `entries(` is ubiquitous across almost any set of TypeScript
 * files (array/object plumbing), so without this list Direction B's "shared
 * by a majority" check trivially fires on generic vocabulary in any family of
 * same-language files, not just genuine parallel-implementation siblings.
 */
const CALL_KEYWORD_STOPLIST = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'else',
  'elif',
  'when',
  'match',
  'select',
  'defer',
  'func',
  'def',
  'class',
  'print',
  'printf',
  'echo',
  'super',
  'this',
  'self',
  'new',
  'delete',
  'typeof',
  'instanceof',
  'void',
  'yield',
  'await',
  'async',
  'try',
  'finally',
  'with',
  'import',
  'require',
  'console',
  'throw',
  'raise',
  'assert',
  'lambda',
  'none',
  'null',
  'true',
  'false',
  'undefined',
  'return',
  'case',
  // PHP language constructs that are syntactically call-shaped.
  'declare',
  'foreach',
  'isset',
  'empty',
  'unset',
  'array',
  'list',
  'compact',
  'extract',
  // Common JS/TS/stdlib built-in methods — generic array/string/object/promise
  // plumbing present in nearly any file, not a family-specific pattern.
  'push',
  'pop',
  'shift',
  'unshift',
  'slice',
  'splice',
  'join',
  'concat',
  'flat',
  'flatmap',
  'map',
  'filter',
  'reduce',
  'foreach',
  'sort',
  'reverse',
  'includes',
  'indexof',
  'lastindexof',
  'find',
  'findindex',
  'findlast',
  'some',
  'every',
  'keys',
  'values',
  'entries',
  'fromentries',
  'assign',
  'freeze',
  'tostring',
  'valueof',
  'hasownproperty',
  'parse',
  'stringify',
  'then',
  'resolve',
  'reject',
  'apply',
  'call',
  'bind',
  'split',
  'trim',
  'trimstart',
  'trimend',
  'replace',
  'replaceall',
  'match',
  'matchall',
  'test',
  'exec',
  'tolowercase',
  'touppercase',
  'padstart',
  'padend',
  'repeat',
  'charat',
  'charcodeat',
  'fromcharcode',
  'isarray',
  'isinteger',
  'isnan',
  'isfinite',
  'log',
  'warn',
  'error',
  'info',
  'debug',
  'now',
]);

// ---------------------------------------------------------------------------
// Path / file helpers
// ---------------------------------------------------------------------------

function dirnameOf(file: string): string {
  const idx = file.lastIndexOf('/');
  return idx === -1 ? '' : file.slice(0, idx);
}

function basenameOf(file: string): string {
  const idx = file.lastIndexOf('/');
  return idx === -1 ? file : file.slice(idx + 1);
}

function joinDirBase(dir: string, base: string): string {
  return dir === '' ? base : `${dir}/${base}`;
}

function isTestFile(file: string): boolean {
  return TEST_PATH_RE.test(file);
}

function extensionOf(file: string): string | null {
  return file.match(SOURCE_EXT_RE)?.[0] ?? null;
}

function isSourceFile(file: string): boolean {
  return extensionOf(file) !== null && !isTestFile(file);
}

// ---------------------------------------------------------------------------
// Chunk grouping
// ---------------------------------------------------------------------------

function groupChunksByFile(chunks: CodeChunk[]): Map<string, CodeChunk[]> {
  const map = new Map<string, CodeChunk[]>();
  for (const chunk of chunks) {
    const file = chunk.metadata.file;
    const list = map.get(file);
    if (list) list.push(chunk);
    else map.set(file, [chunk]);
  }
  return map;
}

function fileContains(
  chunksByFile: Map<string, CodeChunk[]>,
  file: string,
  needle: string,
): boolean {
  const chunks = chunksByFile.get(file);
  return chunks ? chunks.some(c => c.content.includes(needle)) : false;
}

/**
 * Count chunks containing `value` outside every file this PR changed (not merely
 * outside the one file being analyzed) — see the module doc's rarity-threshold
 * note. Short-circuits once past the rarity cap.
 */
function countInUntouchedCorpus(
  value: string,
  repoChunks: CodeChunk[],
  changedFileSet: Set<string>,
): number {
  let count = 0;
  for (const chunk of repoChunks) {
    if (changedFileSet.has(chunk.metadata.file)) continue;
    if (chunk.content.includes(value)) {
      count++;
      if (count > MAX_RARE_OCCURRENCES) return count;
    }
  }
  return count;
}

function collectChangedFileSet(context: ReviewContext): Set<string> {
  const files = new Set<string>(context.changedFiles ?? []);
  for (const f of context.allChangedFiles ?? []) files.add(f);
  for (const f of context.pr?.patches?.keys() ?? []) files.add(f);
  return files;
}

// ---------------------------------------------------------------------------
// Family computation
// ---------------------------------------------------------------------------

/** dirname::ext -> member files (source, non-test), built once from the indexed repo's file set. */
function buildFamilyIndex(files: Iterable<string>): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const file of files) {
    if (!isSourceFile(file)) continue;
    const ext = extensionOf(file);
    const key = `${dirnameOf(file)}::${ext}`;
    const members = index.get(key);
    if (members) members.push(file);
    else index.set(key, [file]);
  }
  return index;
}

/** The sibling family for `file` (including itself), or null when no valid-size family exists. */
function familyFor(file: string, index: Map<string, string[]>): string[] | null {
  const ext = extensionOf(file);
  if (!ext) return null;
  const members = index.get(`${dirnameOf(file)}::${ext}`);
  if (!members || members.length < MIN_FAMILY_SIZE || members.length > MAX_FAMILY_SIZE) return null;
  return members;
}

// ---------------------------------------------------------------------------
// Mirror-directory computation
// ---------------------------------------------------------------------------

/** dirname -> set of source (non-test) basenames present in that directory, built once from the indexed repo's file set. */
function buildDirBasenameIndex(files: Iterable<string>): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const file of files) {
    if (!isSourceFile(file)) continue;
    const dir = dirnameOf(file);
    const base = basenameOf(file);
    const set = index.get(dir);
    if (set) set.add(base);
    else index.set(dir, new Set([base]));
  }
  return index;
}

/**
 * Count of basenames two directories share, short-circuiting once the
 * mirror-evidence gate is met. Generic entry-point basenames (index.ts and
 * equivalents) don't count as evidence — see GENERIC_ENTRYPOINT_BASENAMES.
 */
function sharedBasenameCount(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const base of a) {
    if (GENERIC_ENTRYPOINT_BASENAMES.has(base)) continue;
    if (!b.has(base)) continue;
    count++;
    if (count >= MIN_MIRROR_SHARED_BASENAMES) return count;
  }
  return count;
}

/**
 * Directories that qualify as mirror directories of `dir`: each contains a
 * same-basename+ext file (the mirror counterpart must exist) AND shares at
 * least MIN_MIRROR_SHARED_BASENAMES such files with `dir` overall (the
 * mirror-evidence gate — see module doc).
 */
function mirrorDirsFor(
  dir: string,
  base: string,
  dirBasenames: Map<string, Set<string>>,
): string[] {
  const ownBasenames = dirBasenames.get(dir);
  if (!ownBasenames) return [];

  const qualified: string[] = [];
  for (const [otherDir, basenames] of dirBasenames) {
    if (otherDir === dir || !basenames.has(base)) continue;
    if (sharedBasenameCount(ownBasenames, basenames) >= MIN_MIRROR_SHARED_BASENAMES) {
      qualified.push(otherDir);
    }
  }
  return qualified;
}

/**
 * Untouched mirror-sibling file paths for `file`, one per qualifying mirror
 * directory — or [] when there's no mirror relationship, or more than
 * MAX_MIRROR_DIRS_PER_FILE directories qualify (noise, not a mirror family).
 */
function mirrorSiblingsFor(
  file: string,
  dirBasenames: Map<string, Set<string>>,
  changedFileSet: Set<string>,
): string[] {
  if (!isSourceFile(file)) return [];

  const base = basenameOf(file);
  const qualifiedDirs = mirrorDirsFor(dirnameOf(file), base, dirBasenames);
  if (qualifiedDirs.length === 0 || qualifiedDirs.length > MAX_MIRROR_DIRS_PER_FILE) return [];

  return qualifiedDirs
    .map(d => joinDirBase(d, base))
    .filter(s => s !== file && !changedFileSet.has(s))
    .sort();
}

// ---------------------------------------------------------------------------
// Direction A: unmirrored addition
// ---------------------------------------------------------------------------

/** Half-open [start, end) character range of a matched string literal on a line. */
interface StringSpan {
  start: number;
  end: number;
}

/** Extract string-literal tokens from a line into `out`; returns their spans. */
function collectStringTokens(text: string, out: Map<string, string>): StringSpan[] {
  const spans: StringSpan[] = [];
  for (const m of text.matchAll(STRING_RE)) {
    const start = m.index ?? 0;
    spans.push({ start, end: start + m[0].length });
    const inner = m[2];
    const trimmed = inner.trim();
    if (trimmed.length < MIN_IDENTIFIER_CHARS) continue;
    if (LOW_SIGNAL_STRINGS.has(trimmed.toLowerCase())) continue;
    const key = `s:${inner}`;
    if (!out.has(key)) out.set(key, `${m[1]}${inner}${m[1]}`);
  }
  return spans;
}

/** Extract camelCase/snake_case identifier tokens, skipping matches inside a string span
 * (otherwise a quoted `'on_trailers'` double-counts as both a string and a bare identifier). */
function collectIdentifierTokens(
  text: string,
  spans: StringSpan[],
  out: Map<string, string>,
): void {
  for (const re of [CAMEL_ID_RE, SNAKE_ID_RE]) {
    for (const m of text.matchAll(re)) {
      const index = m.index ?? 0;
      if (spans.some(s => index >= s.start && index < s.end)) continue;
      const key = `i:${m[0]}`;
      if (!out.has(key)) out.set(key, m[0]);
    }
  }
}

/** A candidate token extracted from a diff line: dedup key -> display form. */
function collectTokens(text: string, out: Map<string, string>): void {
  const spans = collectStringTokens(text, out);
  collectIdentifierTokens(text, spans, out);
}

interface PatchTokens {
  /** key -> { display, line } for tokens seen on a `+` line, first occurrence. */
  added: Map<string, { display: string; line: number }>;
  /** keys seen on a context or `-` line (the pre-image) — these are not "new". */
  preImage: Set<string>;
}

/** `+++`/`---` file headers and "\ No newline at end of file" — not content lines. */
const SKIP_LINE_RE = /^(?:\+\+\+|---|\\)/;

/** Record an added line's tokens (first occurrence per key wins). */
function recordAddedLine(line: string, newLine: number, added: PatchTokens['added']): void {
  const tokens = new Map<string, string>();
  collectTokens(line, tokens);
  for (const [key, display] of tokens)
    if (!added.has(key)) added.set(key, { display, line: newLine });
}

/** Classify and record one non-header, non-skip patch line. Returns the line counter after it. */
function processPatchLine(
  raw: string,
  newLine: number,
  added: PatchTokens['added'],
  preImage: Map<string, string>,
): number {
  if (raw.startsWith('+')) {
    recordAddedLine(raw.slice(1), newLine, added);
    return newLine + 1;
  }
  if (raw.startsWith('-')) {
    collectTokens(raw.slice(1), preImage);
    return newLine;
  }
  collectTokens(raw.startsWith(' ') ? raw.slice(1) : raw, preImage);
  return newLine + 1;
}

/** Walk one file's unified-diff patch, splitting tokens into added-only vs. pre-image. */
function scanFilePatchForCandidates(patch: string): PatchTokens {
  const added: PatchTokens['added'] = new Map();
  const preImageDisplay = new Map<string, string>();
  let newLine = 0;

  for (const raw of patch.split('\n')) {
    const header = raw.match(HUNK_HEADER_RE);
    if (header) {
      newLine = parseInt(header[1], 10);
      continue;
    }
    if (SKIP_LINE_RE.test(raw)) continue;
    newLine = processPatchLine(raw, newLine, added, preImageDisplay);
  }

  return { added, preImage: new Set(preImageDisplay.keys()) };
}

/** Raw added-not-pre-image candidates for one file, capped before the corpus-rarity scan. */
function rawCandidates(patch: string): { key: string; display: string; line: number }[] {
  const { added, preImage } = scanFilePatchForCandidates(patch);
  const out: { key: string; display: string; line: number }[] = [];
  for (const [key, { display, line }] of added) {
    if (preImage.has(key)) continue;
    out.push({ key, display, line });
    if (out.length >= MAX_RAW_CANDIDATES_PER_FILE) break;
  }
  return out;
}

function extractUnmirroredAdditions(
  file: string,
  patch: string,
  repoChunks: CodeChunk[],
  chunksByFile: Map<string, CodeChunk[]>,
  changedFileSet: Set<string>,
  untouchedSiblings: string[],
  isMirror = false,
): SiblingSurfaceEntry[] {
  const entries: SiblingSurfaceEntry[] = [];

  for (const { key, display, line } of rawCandidates(patch)) {
    if (entries.length >= MAX_ENTRIES_PER_FILE_PER_DIRECTION) break;
    const value = key.slice(2); // strip the 's:'/'i:' kind tag
    if (countInUntouchedCorpus(value, repoChunks, changedFileSet) > MAX_RARE_OCCURRENCES) continue;

    const lacking = untouchedSiblings.filter(s => !fileContains(chunksByFile, s, value)).sort();
    if (lacking.length === 0) continue;

    entries.push({
      direction: 'unmirrored-addition',
      display,
      file,
      line,
      siblings: lacking,
      isMirror,
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Direction B: family-pattern divergence
// ---------------------------------------------------------------------------

/** Call-shaped identifier -> occurrence count within one file's chunks (dedup'd by the same rules as Direction A's stoplist). */
function countCallIdentifiers(
  chunksByFile: Map<string, CodeChunk[]>,
  file: string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const chunk of chunksByFile.get(file) ?? []) {
    for (const m of chunk.content.matchAll(CALL_RE)) {
      const id = m[1];
      if (id.length < MIN_IDENTIFIER_CHARS) continue;
      if (CALL_KEYWORD_STOPLIST.has(id.toLowerCase())) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

function extractCallIdentifiers(chunksByFile: Map<string, CodeChunk[]>, file: string): Set<string> {
  return new Set(countCallIdentifiers(chunksByFile, file).keys());
}

/** How many members must share a call for it to count as a "family pattern" (a majority). */
function requiredShareCount(memberCount: number): number {
  return Math.max(2, Math.ceil(memberCount / 2));
}

/**
 * Whether `family` exhibits at least one call-shaped identifier shared by a
 * majority of ALL its members (not just the untouched ones) — a cheap proxy
 * for "these are parallel implementations of a common role", not merely
 * files that happen to share a directory. Empirically this cleanly separates
 * the true positives (gin's `binding/` siblings all share `Bind`/`Name`/
 * `validate`; guzzle's `Handler/` siblings all share `__construct`/
 * `InvalidArgumentException`) from a flat utility directory of unrelated
 * files (e.g. `format.ts`/`config.ts`/`engine.ts`), which shares nothing
 * across a majority. Directory+extension alone is too weak a family
 * definition without this gate — it fires on any generic top-level `src/`.
 */
function hasCohesivePattern(family: string[], chunksByFile: Map<string, CodeChunk[]>): boolean {
  const shareCounts = new Map<string, number>();
  for (const file of family) {
    for (const id of extractCallIdentifiers(chunksByFile, file)) {
      shareCounts.set(id, (shareCounts.get(id) ?? 0) + 1);
    }
  }
  const threshold = requiredShareCount(family.length);
  for (const count of shareCounts.values()) if (count >= threshold) return true;
  return false;
}

function extractFamilyPatternDivergence(
  file: string,
  chunksByFile: Map<string, CodeChunk[]>,
  untouchedSiblings: string[],
  isMirror = false,
): SiblingSurfaceEntry[] {
  if (untouchedSiblings.length < 2) return [];

  const idsBySibling = untouchedSiblings.map(s => ({
    file: s,
    ids: extractCallIdentifiers(chunksByFile, s),
  }));
  const shareCounts = new Map<string, string[]>(); // identifier -> siblings that carry it
  for (const { file: sibling, ids } of idsBySibling) {
    for (const id of ids) {
      const list = shareCounts.get(id);
      if (list) list.push(sibling);
      else shareCounts.set(id, [sibling]);
    }
  }

  const threshold = requiredShareCount(untouchedSiblings.length);
  const candidates = [...shareCounts.entries()]
    .filter(
      ([id, siblings]) => siblings.length >= threshold && !fileContains(chunksByFile, file, id),
    )
    .map(([id, siblings]) => ({ id, siblings: [...siblings].sort() }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return candidates.slice(0, MAX_ENTRIES_PER_FILE_PER_DIRECTION).map(({ id, siblings }) => ({
    direction: 'family-pattern-divergence' as const,
    display: id,
    file,
    siblings,
    isMirror,
  }));
}

/**
 * Direction B for a mirror family with exactly one mirror sibling — the
 * common case, since most mirror relationships are 1:1 pairs. The majority
 * rule (`requiredShareCount`) can never fire with a single candidate, so
 * instead require the identifier to occur at least twice within that one
 * sibling: a within-file repetition signal standing in for "the family
 * pattern", to compensate for a family too small for a majority to mean
 * anything.
 */
function extractSingleMirrorDivergence(
  file: string,
  chunksByFile: Map<string, CodeChunk[]>,
  mirrorSibling: string,
): SiblingSurfaceEntry[] {
  const counts = countCallIdentifiers(chunksByFile, mirrorSibling);
  const candidates = [...counts.entries()]
    .filter(([id, count]) => count >= 2 && !fileContains(chunksByFile, file, id))
    .map(([id]) => id)
    .sort();

  return candidates.slice(0, MAX_ENTRIES_PER_FILE_PER_DIRECTION).map(id => ({
    direction: 'family-pattern-divergence' as const,
    display: id,
    file,
    siblings: [mirrorSibling],
    isMirror: true,
  }));
}

/** Direction B dispatcher for the mirror axis: single-sibling families use the repetition rule above; larger ones reuse the same majority rule as same-dir families. */
function extractMirrorFamilyPatternDivergence(
  file: string,
  chunksByFile: Map<string, CodeChunk[]>,
  mirrorSiblings: string[],
): SiblingSurfaceEntry[] {
  if (mirrorSiblings.length === 1) {
    return extractSingleMirrorDivergence(file, chunksByFile, mirrorSiblings[0]);
  }
  return extractFamilyPatternDivergence(file, chunksByFile, mirrorSiblings, true);
}

// ---------------------------------------------------------------------------
// Extraction entry point
// ---------------------------------------------------------------------------

/** Same-directory family axis (v1) for one changed file: both directions, or [] when no cohesive family exists. */
function extractSameDirFamilyEntries(
  file: string,
  familyIndex: Map<string, string[]>,
  chunksByFile: Map<string, CodeChunk[]>,
  repoChunks: CodeChunk[],
  changedFileSet: Set<string>,
  patches: Map<string, string> | undefined,
): SiblingSurfaceEntry[] {
  const family = familyFor(file, familyIndex);
  if (!family || !hasCohesivePattern(family, chunksByFile)) return [];

  const untouchedSiblings = family.filter(s => s !== file && !changedFileSet.has(s));
  if (untouchedSiblings.length === 0) return [];

  const entries: SiblingSurfaceEntry[] = [];
  const patch = patches?.get(file);
  if (patch) {
    entries.push(
      ...extractUnmirroredAdditions(
        file,
        patch,
        repoChunks,
        chunksByFile,
        changedFileSet,
        untouchedSiblings,
      ),
    );
  }
  entries.push(...extractFamilyPatternDivergence(file, chunksByFile, untouchedSiblings));
  return entries;
}

/** Mirror-directory family axis for one changed file: both directions, or [] when no mirror family qualifies. */
function extractMirrorFamilyEntries(
  file: string,
  dirBasenameIndex: Map<string, Set<string>>,
  chunksByFile: Map<string, CodeChunk[]>,
  repoChunks: CodeChunk[],
  changedFileSet: Set<string>,
  patches: Map<string, string> | undefined,
): SiblingSurfaceEntry[] {
  const mirrorSiblings = mirrorSiblingsFor(file, dirBasenameIndex, changedFileSet);
  if (mirrorSiblings.length === 0) return [];

  const entries: SiblingSurfaceEntry[] = [];
  const patch = patches?.get(file);
  if (patch) {
    entries.push(
      ...extractUnmirroredAdditions(
        file,
        patch,
        repoChunks,
        chunksByFile,
        changedFileSet,
        mirrorSiblings,
        true,
      ),
    );
  }
  entries.push(...extractMirrorFamilyPatternDivergence(file, chunksByFile, mirrorSiblings));
  return entries;
}

/**
 * Precompute sibling-surface entries for the review context. Returns [] when
 * there's no repo index to scan against. Exposed for testing.
 */
export function extractSiblingSurfaces(context: ReviewContext): SiblingSurfaceEntry[] {
  const repoChunks = context.repoChunks;
  if (!repoChunks || repoChunks.length === 0) return [];

  const chunksByFile = groupChunksByFile(repoChunks);
  const familyIndex = buildFamilyIndex(chunksByFile.keys());
  const dirBasenameIndex = buildDirBasenameIndex(chunksByFile.keys());
  const changedFileSet = collectChangedFileSet(context);
  const patches = context.pr?.patches;

  const entries: SiblingSurfaceEntry[] = [];
  const candidateFiles = [...changedFileSet].filter(isSourceFile).sort();

  for (const file of candidateFiles) {
    entries.push(
      ...extractSameDirFamilyEntries(
        file,
        familyIndex,
        chunksByFile,
        repoChunks,
        changedFileSet,
        patches,
      ),
    );
    entries.push(
      ...extractMirrorFamilyEntries(
        file,
        dirBasenameIndex,
        chunksByFile,
        repoChunks,
        changedFileSet,
        patches,
      ),
    );
  }

  return entries.slice(0, MAX_TOTAL_ENTRIES);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const SIBLING_SURFACES_HEADER =
  'Pre-computed by a deterministic scan of file "families" — other source files in the same ' +
  'directory sharing an extension, or "mirror siblings": the same file basename in a different ' +
  'directory that this codebase maintains as a parallel implementation (e.g. an async vs a ' +
  'blocking variant), tests excluded — no grep needed. Each entry is either a feature-shaped ' +
  'literal/identifier this PR ADDED to one family member but which is absent from an untouched ' +
  'sibling that handles the same kind of surface, or a call every OTHER family member makes ' +
  'that this file never does. For each, verify whether the omission is intentional: an option ' +
  'or code path implemented in one family member but silently absent from a sibling that ' +
  'handles the same surface is a finding; if the sibling structurally cannot support it ' +
  '(documented, or a genuinely different responsibility), stay silent.';

/**
 * Entries for the same file, direction, sibling set, and mirror-ness share one
 * rendered line — otherwise a family with many members (or a file with
 * several qualifying identifiers) repeats the same long sibling list per
 * identifier, which burns the block's char budget on redundant text instead
 * of signal.
 */
interface EntryGroup {
  direction: SiblingSurfaceDirection;
  file: string;
  siblings: string[];
  isMirror: boolean;
  items: { display: string; line?: number }[];
}

function groupEntries(entries: SiblingSurfaceEntry[]): EntryGroup[] {
  const groups = new Map<string, EntryGroup>();
  for (const e of entries) {
    const key = `${e.direction}::${e.file}::${e.siblings.join(',')}::${e.isMirror}`;
    const group = groups.get(key);
    if (group) group.items.push({ display: e.display, line: e.line });
    else
      groups.set(key, {
        direction: e.direction,
        file: e.file,
        siblings: e.siblings,
        isMirror: e.isMirror,
        items: [{ display: e.display, line: e.line }],
      });
  }
  return [...groups.values()];
}

function renderGroup(g: EntryGroup): string {
  const siblingsList = g.siblings.join(', ');
  const siblingWord = g.isMirror ? 'mirror sibling' : 'sibling';
  if (g.direction === 'unmirrored-addition') {
    const items = g.items
      .map(i => (i.line ? `${i.display} (line ${i.line})` : i.display))
      .join(', ');
    return `- ${items} — added in ${g.file}, absent from untouched ${siblingWord}(s): ${siblingsList}`;
  }
  const items = g.items.map(i => `${i.display}(...)`).join(', ');
  return `- ${items} — shared by ${siblingWord}(s) ${siblingsList}, absent from ${g.file}`;
}

/**
 * Render sibling-surface entries as a `<sibling_surfaces>` block. Returns ''
 * when there are no entries so callers can append unconditionally — a fixture
 * with no signal must render byte-identical prompts.
 */
export function renderSiblingSurfaces(entries: SiblingSurfaceEntry[]): string {
  if (entries.length === 0) return '';

  const groups = groupEntries(entries);
  const lines: string[] = ['<sibling_surfaces>', SIBLING_SURFACES_HEADER];
  let used = lines.join('\n').length;
  let omitted = 0;

  for (const g of groups) {
    const line = renderGroup(g);
    if (used + line.length + 1 > MAX_BLOCK_CHARS) {
      omitted = groups.length - lines.length + 2; // +2 for the two header lines already pushed
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }

  if (omitted > 0) {
    lines.push(
      `- [+${omitted} more entr${omitted === 1 ? 'y' : 'ies'} omitted to respect the input budget]`,
    );
  }
  lines.push('</sibling_surfaces>');
  return lines.join('\n');
}

/**
 * Build the `<sibling_surfaces>` section for the agent's initial message.
 * Returns '' when there is no repo index or no entries survive the scan.
 */
export function renderSiblingSurfacesSection(context: ReviewContext): string {
  return renderSiblingSurfaces(extractSiblingSurfaces(context));
}
