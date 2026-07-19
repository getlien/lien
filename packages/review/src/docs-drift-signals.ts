/**
 * Deterministic "blast-radius for untouched docs" signal for PR reviews.
 *
 * doc-truth (see `doc-claims-signals.ts`) verifies the docs a PR TOUCHED against the code it
 * changed. This module covers the inverse, structurally symmetric gap: a PR REMOVES or RENAMES a
 * code symbol, or deletes a file/directory, and some OTHER doc — one the PR never opened — still
 * describes the old form as if it were current. That doc silently rots.
 *
 * Mirrors the `<removed_exports>` / `<rename_sweep>` / `<stale_literal_candidates>` precedents:
 * pre-compute the structural facts (which old forms are provably GONE, and which untouched
 * doc/config lines still name them) instead of asking the agent to grep-and-reason across the
 * whole repo on every PR. Three referand kinds, each backed by an existing extractor or a small
 * new one:
 *   - a removed exported symbol (`extractRemovedExports`, `removed-export-signals.ts`);
 *   - a renamed identifier's old name (`detectRenameSweeps`, `rename-sweep-signals.ts`);
 *   - a deleted file/directory path (new: `isFullFileDeletion` below, parsed straight off the
 *     hunk headers `getPRPatchData` already gives every plugin — no `diff --git` header needed,
 *     since production patches are hunk-only).
 *
 * The raw signal — "some doc mentions some changed identifier" — fires on nearly every PR and is
 * useless as a gate on its own, the same trap `stale-literal-signals.ts`'s confidence tiering
 * exists to avoid. Two independent, deliberately narrow gates keep this selective: (1) the
 * referand set is restricted to REMOVED/RENAMED/DELETED forms, not merely changed ones — most PRs
 * add and modify but don't remove public surface; (2) each surviving reference is tiered by WHERE
 * in the doc it sits (a falsifiable behavioral claim, or a structural heading/bullet naming a now-
 * gone symbol/path) and, when in doubt, SUPPRESSED (fenced code samples, changelog/changeset
 * entries, a referand that sits ONLY inside a link/URL span, and past-tense/historical prose are
 * never candidates — that is the single biggest false-positive class for this shape of signal).
 * The link/URL suppression is deliberately NARROW — it fires only when the referand's own
 * occurrence sits inside the link markup, not merely because the line contains a link ANYWHERE
 * (this repo's dominant doc idiom cites an ADR link — `(see [ADR-012](docs/.../0012-...md))` —
 * right next to a genuine structural bullet; a blanket "line has a link" suppression silently ate
 * real deletion-drift candidates until this was narrowed).
 *
 * Referand tokens are deliberately the FULL path/identifier only — no generic shorter alternate
 * spelling is swept (a prior "trailing path segment" alt-token for deleted directories, e.g.
 * `packages/runner` -> `runner`, was tried and removed: a bare segment is often a common English
 * word — this repo's own packages include `core`/`cli`/`site`/`action`/`runner` — and produced
 * false candidates on unrelated ambient prose, e.g. a CI workflow comment about the GitHub Actions
 * "hosted runner" machine). Residual known limit, not fixed here: a bare TOP-LEVEL-directory
 * referand (e.g. `platform`) is itself already a single common word, so it carries the same
 * generic-word false-positive risk the removed alt-token had — a future distinctiveness/stopword
 * filter (minimum length, excluding common English words, requiring a directory-listing context)
 * is the natural fast-follow; precision-first v1 accepts this narrow residual risk rather than
 * building that filter now.
 *
 * This module only computes candidates; the dedicated pass that judges them
 * (`plugins/agent/docs-drift-pass.ts`, dark by default) lives separately (see the docs-drift
 * design doc, `.wip/docs-drift-design.md`, §2-3). `classifyRawDocReferences` exists purely so the
 * zero-LLM census (design doc §4) can show how much this tiering collapses the raw ~100%-of-PRs
 * signal down to a selective candidate rate.
 */

import type { CodeChunk } from '@liendev/parser';
import type { ReviewContext } from './plugin-types.js';
import { extractRemovedExports } from './removed-export-signals.js';
import { detectRenameSweeps } from './rename-sweep-signals.js';
import {
  classifyClaim,
  FENCE_RE,
  EVIDENCE_LINES_BEFORE,
  EVIDENCE_LINES_AFTER,
} from './doc-claims-signals.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Which deterministic extractor produced a referand's "the old form is gone" fact. */
export type ReferandKind = 'removed-export' | 'renamed-identifier' | 'deleted-path';

/** Where in the doc a surviving reference sits — the precision-tiering axis (see module header). */
export type PositionTier = 'behavioral-claim' | 'structural-mention';

/**
 * A surviving untouched-doc reference to a removed/renamed/deleted referand, tiered and past every
 * suppression check. The code-side hunk that proves the referand is gone is deliberately NOT
 * carried here — it is cheap to re-derive from `context.pr.patches` when a pass actually consumes
 * this candidate (mirrors `findRemovalHunk` in `removed-exports-pass.ts`), so this stays a minimal,
 * easily-serializable worklist entry.
 */
export interface DocsDriftCandidate {
  /** The old-form token this doc still names (a symbol, an old identifier, or a path). */
  referand: string;
  referandKind: ReferandKind;
  docFile: string;
  /** 1-based line in the doc file's current (head) content. */
  docLine: number;
  positionTier: PositionTier;
  /** A short window around the reference line, for a reviewer to judge without re-opening the file. */
  excerpt: string;
}

/** One referand to sweep the untouched-doc corpus for — the FULL path/identifier only, no shorter
 *  alternate spelling (see module header for why a generic trailing-segment alt-token was tried
 *  and removed). */
interface Referand {
  token: string;
  kind: ReferandKind;
}

/** One raw word-boundary match of a referand inside an untouched doc/config chunk. */
interface MatchSite {
  chunk: CodeChunk;
  lines: string[];
  lineIndex: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max candidates returned — keeps a future prompt block compact (mirrors sibling signals). */
const MAX_CANDIDATES = 15;
/** Max surviving references swept per referand before the candidate-building cap kicks in. */
const MAX_REFS_PER_REFERAND = 5;
/** Wall-clock backstop for the untouched-doc sweep, mirroring stale-literal-signals.ts's own
 *  budget — this runs unconditionally on every PR, before any LLM call. */
const DOCS_DRIFT_TIME_BUDGET_MS = 5_000;
/** Cap on a rendered excerpt window. */
const MAX_EXCERPT_CHARS = 400;

const DOC_CHUNK_TYPES = new Set(['doc', 'config']);
/** A changelog or changeset entry — a correct historical record, never a drift candidate. */
const CHANGELOG_OR_CHANGESET_RE = /(?:^|\/)CHANGELOG[^/]*(?:\.md)?$|(?:^|\/)\.changeset\//i;
/** A markdown link's full `[display](target)` markup — used to find link SPANS (see
 *  `linkOrUrlSpans`), not to blanket-suppress a whole line merely for containing one. */
const MARKDOWN_LINK_RE = /\[[^\]]*\]\([^)]*\)/g;
/** A bare `http(s)://` URL — same span-based use as `MARKDOWN_LINK_RE`. */
const BARE_URL_RE = /https?:\/\/\S+/g;
/** Past-tense / historical / retirement note — the primary false-positive class (module header). */
const HISTORICAL_GUARD_RE =
  /\b(?:was|were)\s+(?:removed|renamed|deleted|retired|dropped)\b|\b(?:retired|formerly|deprecated|previously|prior to|no longer|used to)\b/i;
const HEADING_RE = /^#{1,6}\s/;
const STRUCTURE_BULLET_RE = /^\s*[-*]\s/;
/** A unified-diff hunk header, capturing the NEW-side start. A full-file deletion's every hunk
 *  starts its new side at line 0 (`@@ -a,b +0,0 @@`) — see `isFullFileDeletion`. */
const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
/** A plain identifier — used to reject the `default (X)` / `* (all re-exports of '…')` synthetic
 *  spellings `extractRemovedExports` uses for un-searchable removals (mirrors that module's own
 *  `searchableName`, whose constants are private to it). */
const PLAIN_IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;

// ---------------------------------------------------------------------------
// Referand extraction — removed exports / renamed identifiers
// ---------------------------------------------------------------------------

/** Removed-export referands: the plain-identifier removed exports (skips the default/bulk
 *  synthetic spellings, which have no stable searchable name). */
function referandsFromRemovedExports(patches: Map<string, string>): Referand[] {
  return extractRemovedExports(patches)
    .filter(r => PLAIN_IDENTIFIER_RE.test(r.symbol))
    .map(r => ({ token: r.symbol, kind: 'removed-export' as const }));
}

/** Renamed-identifier referands: the OLD name of each detected mechanical rename sweep. */
function referandsFromRenames(patches: Map<string, string>): Referand[] {
  return detectRenameSweeps(patches).map(m => ({
    token: m.from,
    kind: 'renamed-identifier' as const,
  }));
}

// ---------------------------------------------------------------------------
// Referand extraction — deleted paths
// ---------------------------------------------------------------------------

/**
 * True iff `patch` is a full-file deletion: it has at least one hunk, and EVERY hunk header's
 * new-side start is `0` (`@@ -a,b +0,0 @@`) — the shape a whole-file removal always produces,
 * whether or not the patch also carries a `diff --git`/`deleted file mode` header. Production
 * patches from `getPRPatchData` (`github-api.ts`, via `octokit.pulls.listFiles`) are HUNK-ONLY —
 * no such header is ever present — so this is the only extractor shape that works in both prod
 * and a fixture's full-header capture. Exposed for testing.
 */
export function isFullFileDeletion(patch: string): boolean {
  let hunkCount = 0;
  for (const line of patch.split('\n')) {
    const m = HUNK_HEADER_RE.exec(line);
    if (!m) continue;
    hunkCount++;
    if (m[1] !== '0') return false;
  }
  return hunkCount > 0;
}

/** The `packages/<name>` grouping a deleted file lives under, else its top-level directory, else
 *  null for a root-level file. Mirrors `stale-literal-signals.ts`'s `projectArea` helper. */
function candidateDirectoryReferand(file: string): string | null {
  const pkgMatch = file.match(/^packages\/([^/]+)\//);
  if (pkgMatch) return `packages/${pkgMatch[1]}`;
  const topMatch = file.match(/^([^/]+)\//);
  return topMatch ? topMatch[1] : null;
}

/**
 * True when no chunk in the head corpus lives under `dir/` — i.e. `dir` is genuinely gone, not
 * merely missing the one deleted file. Without this check, deleting a single file from an
 * otherwise-intact package would wrongly promote that whole package directory to "deleted".
 */
function directoryIsGone(dir: string, repoChunks: CodeChunk[] | undefined): boolean {
  if (!repoChunks) return true;
  const prefix = `${dir}/`;
  return !repoChunks.some(c => c.metadata.file.startsWith(prefix));
}

/**
 * Deleted-path referands: every fully-deleted file, grouped up to its containing package/top-level
 * directory when that whole directory is confirmed gone (see `directoryIsGone`) — the shape a
 * removed CLAUDE.md structure bullet describes (a directory, not one of its files) — else left as
 * the individual file's own path. Deduped. Full path only — no trailing-segment alt-token (see
 * module header). Exposed for testing.
 */
export function extractDeletedPaths(
  patches: Map<string, string>,
  repoChunks: CodeChunk[] | undefined,
): Referand[] {
  const deletedFiles = [...patches.entries()]
    .filter(([, patch]) => isFullFileDeletion(patch))
    .map(([file]) => file);
  if (deletedFiles.length === 0) return [];

  const paths = new Set<string>();
  for (const file of deletedFiles) {
    const dir = candidateDirectoryReferand(file);
    paths.add(dir && directoryIsGone(dir, repoChunks) ? dir : file);
  }

  return [...paths].map(path => ({ token: path, kind: 'deleted-path' as const }));
}

// ---------------------------------------------------------------------------
// Referand collection
// ---------------------------------------------------------------------------

/** Every referand this PR's diff produces, deduped by (kind, token). */
function collectReferands(context: ReviewContext): Referand[] {
  const patches = context.pr?.patches;
  if (!patches || patches.size === 0) return [];

  const seen = new Set<string>();
  const out: Referand[] = [];
  const push = (r: Referand): void => {
    const key = `${r.kind}:${r.token}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(r);
  };

  referandsFromRemovedExports(patches).forEach(push);
  referandsFromRenames(patches).forEach(push);
  extractDeletedPaths(patches, context.repoChunks).forEach(push);
  return out;
}

// ---------------------------------------------------------------------------
// Untouched doc/config corpus
// ---------------------------------------------------------------------------

/** The union of every path this PR changed (mirrors `doc-claims-signals.ts`'s own
 *  `collectChangedFiles`, duplicated locally since that helper is private to its module). */
function collectChangedFileSet(context: ReviewContext): Set<string> {
  const files = new Set<string>(context.changedFiles ?? []);
  for (const f of context.allChangedFiles ?? []) files.add(f);
  for (const f of context.pr?.patches?.keys() ?? []) files.add(f);
  return files;
}

function isDocOrConfigChunk(chunk: CodeChunk): boolean {
  return DOC_CHUNK_TYPES.has(chunk.metadata.type);
}

/** Doc/config chunks from a file this PR did NOT touch — the entire point (a touched doc is
 *  doc-truth's job, not this module's). */
function collectUntouchedDocChunks(chunks: CodeChunk[], changed: Set<string>): CodeChunk[] {
  return chunks.filter(c => isDocOrConfigChunk(c) && !changed.has(c.metadata.file));
}

// ---------------------------------------------------------------------------
// Word-boundary sweep
// ---------------------------------------------------------------------------

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordBoundaryRe(token: string): RegExp {
  return new RegExp(`\\b${escapeForRegex(token)}\\b`);
}

/** Cheap pre-check before the per-line regex: does `chunk`'s raw content contain the referand's
 *  token at all? (fast reject, mirrors `removed-export-signals.ts`'s own). */
function chunkMayContainReferand(chunk: CodeChunk, referand: Referand): boolean {
  return chunk.content.includes(referand.token);
}

/** Collect word-boundary matches of `re` within one already-fast-rejected chunk into `sites`,
 *  stopping once the shared `cap` is reached. Split out of `sweepReferand` to keep that function's
 *  own branching shallow. */
function collectMatchesInChunk(
  chunk: CodeChunk,
  re: RegExp,
  cap: number,
  sites: MatchSite[],
): void {
  const lines = chunk.content.split('\n');
  for (let i = 0; i < lines.length && sites.length < cap; i++) {
    if (re.test(lines[i])) sites.push({ chunk, lines, lineIndex: i });
  }
}

/**
 * Sweep `chunks` for word-boundary occurrences of `referand`'s full token, fast-rejecting each
 * chunk via a plain `includes` check before the per-line regex (mirrors
 * `removed-export-signals.ts`'s `collectRefsFromChunk`). Stops early once `cap` sites are found or
 * the shared `deadline` passes. Pass `cap: Infinity` for an uncapped count (used only by the census
 * helper, `classifyRawDocReferences`).
 */
function sweepReferand(
  referand: Referand,
  chunks: CodeChunk[],
  deadline: number,
  cap: number,
): MatchSite[] {
  const sites: MatchSite[] = [];
  const re = wordBoundaryRe(referand.token);

  for (const chunk of chunks) {
    if (sites.length >= cap || Date.now() > deadline) break;
    if (!chunkMayContainReferand(chunk, referand)) continue;
    collectMatchesInChunk(chunk, re, cap, sites);
  }

  return sites;
}

// ---------------------------------------------------------------------------
// Suppression + tiering
// ---------------------------------------------------------------------------

/** Fence state entering `lineIndex` — toggled on every fence delimiter strictly before it (mirrors
 *  `doc-claims-signals.ts`'s own `inFence` tracking, applied over a plain doc chunk's lines). */
function isInsideFence(lines: string[], lineIndex: number): boolean {
  let inFence = false;
  for (let i = 0; i < lineIndex; i++) {
    if (FENCE_RE.test(lines[i].trim())) inFence = !inFence;
  }
  return inFence;
}

/** Character spans on `line` that are link/URL markup, not literal prose: a markdown link's full
 *  `[display](target)` markup, or a bare `http(s)://` URL. Used to narrow the link/URL suppression
 *  to "the referand's own occurrence sits inside one of these", not "the line merely contains a
 *  link ANYWHERE" — see module header for the bug this fixes (an ADR-citing structural bullet was
 *  blanket-suppressed even though the referand itself sat in plain prose, not the link). */
function linkOrUrlSpans(line: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const m of line.matchAll(MARKDOWN_LINK_RE)) {
    if (m.index !== undefined) spans.push([m.index, m.index + m[0].length]);
  }
  for (const m of line.matchAll(BARE_URL_RE)) {
    if (m.index !== undefined) spans.push([m.index, m.index + m[0].length]);
  }
  return spans;
}

/**
 * True iff EVERY word-boundary occurrence of `referand.token` on `line` falls inside a link/URL
 * span (see `linkOrUrlSpans`) — the narrow "the referand only appears as a link target" case (e.g.
 * `[helper](./packages/oldFunc/README.md)`, where `oldFunc` names the file the link points AT).
 * False when the referand also appears in plain prose on the same line, even alongside an
 * unrelated link/ADR citation elsewhere on that line — that occurrence is a real claim, not a link
 * artifact, and must not be suppressed just because a link happens to share the line.
 */
function referandOnlyInsideLinkOrUrl(referand: Referand, line: string): boolean {
  const spans = linkOrUrlSpans(line);
  if (spans.length === 0) return false;

  const re = new RegExp(`\\b${escapeForRegex(referand.token)}\\b`, 'g');
  const positions = [...line.matchAll(re)]
    .map(m => m.index)
    .filter((i): i is number => i !== undefined);
  if (positions.length === 0) return false;

  return positions.every(pos => spans.some(([start, end]) => pos >= start && pos < end));
}

/**
 * When in doubt, suppress (module header): a changelog/changeset entry, a fenced code sample, a
 * referand that sits ONLY inside a link/URL span, or a past-tense/historical note are never
 * candidates — the primary false-positive class for this signal shape.
 */
function isSuppressed(
  referand: Referand,
  file: string,
  lines: string[],
  lineIndex: number,
): boolean {
  if (CHANGELOG_OR_CHANGESET_RE.test(file)) return true;
  if (isInsideFence(lines, lineIndex)) return true;
  const line = lines[lineIndex];
  if (HISTORICAL_GUARD_RE.test(line)) return true;
  return referandOnlyInsideLinkOrUrl(referand, line);
}

/** Does the reference line, or a line in its evidence window, read as a falsifiable behavioral
 *  claim (`classifyClaim`, the doc-truth Tier-1 detector)? */
function matchesClaimWindow(lines: string[], lineIndex: number): boolean {
  const from = Math.max(0, lineIndex - EVIDENCE_LINES_BEFORE);
  const to = Math.min(lines.length - 1, lineIndex + EVIDENCE_LINES_AFTER);
  for (let i = from; i <= to; i++) {
    if (classifyClaim(lines[i])) return true;
  }
  return false;
}

/** Tier-1 (behavioral claim) beats Tier-2 (heading/structural bullet); neither -> not a candidate. */
function classifyPositionTier(lines: string[], lineIndex: number): PositionTier | null {
  if (matchesClaimWindow(lines, lineIndex)) return 'behavioral-claim';
  const line = lines[lineIndex];
  if (HEADING_RE.test(line) || STRUCTURE_BULLET_RE.test(line)) return 'structural-mention';
  return null;
}

/** A ~6-line window around the reference line (mirrors `doc-claims-signals.ts`'s evidence window). */
function buildExcerpt(lines: string[], lineIndex: number): string {
  const from = Math.max(0, lineIndex - EVIDENCE_LINES_BEFORE);
  const to = Math.min(lines.length - 1, lineIndex + EVIDENCE_LINES_AFTER);
  const window = lines.slice(from, to + 1).join('\n');
  return window.length > MAX_EXCERPT_CHARS ? `${window.slice(0, MAX_EXCERPT_CHARS)}…` : window;
}

// ---------------------------------------------------------------------------
// Candidate assembly
// ---------------------------------------------------------------------------

function buildCandidate(referand: Referand, match: MatchSite): DocsDriftCandidate | null {
  const { chunk, lines, lineIndex } = match;
  if (isSuppressed(referand, chunk.metadata.file, lines, lineIndex)) return null;
  const tier = classifyPositionTier(lines, lineIndex);
  if (!tier) return null;

  return {
    referand: referand.token,
    referandKind: referand.kind,
    docFile: chunk.metadata.file,
    docLine: chunk.metadata.startLine + lineIndex,
    positionTier: tier,
    excerpt: buildExcerpt(lines, lineIndex),
  };
}

const TIER_RANK: Record<PositionTier, number> = { 'behavioral-claim': 0, 'structural-mention': 1 };

/** Deterministic sort: Tier-1 before Tier-2, then referand, then doc file:line. */
function compareCandidates(a: DocsDriftCandidate, b: DocsDriftCandidate): number {
  const byTier = TIER_RANK[a.positionTier] - TIER_RANK[b.positionTier];
  if (byTier !== 0) return byTier;
  const byReferand = a.referand.localeCompare(b.referand);
  if (byReferand !== 0) return byReferand;
  const byFile = a.docFile.localeCompare(b.docFile);
  if (byFile !== 0) return byFile;
  return a.docLine - b.docLine;
}

interface SweepSetup {
  referands: Referand[];
  docChunks: CodeChunk[];
}

/** Shared setup for both `computeDocsDriftCandidates` and `classifyRawDocReferences`: the
 *  referands to sweep for and the untouched doc/config corpus to sweep, or null when either is
 *  empty (nothing to compute). */
function setupSweep(context: ReviewContext): SweepSetup | null {
  const patches = context.pr?.patches;
  const repoChunks = context.repoChunks;
  if (!patches || patches.size === 0 || !repoChunks || repoChunks.length === 0) return null;

  const referands = collectReferands(context);
  if (referands.length === 0) return null;

  const changed = collectChangedFileSet(context);
  const docChunks = collectUntouchedDocChunks(repoChunks, changed);
  if (docChunks.length === 0) return null;

  return { referands, docChunks };
}

/**
 * Compute the docs-drift candidates for a review: untouched doc/config lines that still name a
 * symbol this PR removed, an identifier it renamed, or a path it deleted — tiered by position and
 * past every suppression check (module header). Returns `[]` when there's no diff, no
 * removed/renamed/deleted referand, or no untouched doc/config corpus to sweep. Capped at
 * `MAX_CANDIDATES`, sorted deterministically (Tier-1 first, then referand, then doc file:line).
 */
export function computeDocsDriftCandidates(context: ReviewContext): DocsDriftCandidate[] {
  const setup = setupSweep(context);
  if (!setup) return [];

  const deadline = Date.now() + DOCS_DRIFT_TIME_BUDGET_MS;
  const candidates: DocsDriftCandidate[] = [];

  for (const referand of setup.referands) {
    if (Date.now() > deadline) break;
    const matches = sweepReferand(referand, setup.docChunks, deadline, MAX_REFS_PER_REFERAND);
    for (const match of matches) {
      const candidate = buildCandidate(referand, match);
      if (candidate) candidates.push(candidate);
    }
  }

  candidates.sort(compareCandidates);
  return candidates.slice(0, MAX_CANDIDATES);
}

/** Raw (untiered/unsuppressed) reference tally — see `classifyRawDocReferences`. */
export interface RawDocReferenceTally {
  total: number;
  tier1: number;
  tier2: number;
  suppressed: number;
}

/** Tally one raw match into `tally` (suppressed, tier-1, tier-2, or neither). Split out of
 *  `classifyRawDocReferences` to keep that function's own nesting shallow. */
function tallyRawMatch(referand: Referand, match: MatchSite, tally: RawDocReferenceTally): void {
  tally.total++;
  if (isSuppressed(referand, match.chunk.metadata.file, match.lines, match.lineIndex)) {
    tally.suppressed++;
    return;
  }
  const tier = classifyPositionTier(match.lines, match.lineIndex);
  if (tier === 'behavioral-claim') tally.tier1++;
  else if (tier === 'structural-mention') tally.tier2++;
}

/**
 * Census/debugging helper (not used by any pass): classifies every RAW word-boundary reference to
 * a removed/renamed/deleted referand in the untouched doc/config corpus — uncapped by
 * `MAX_REFS_PER_REFERAND` or `MAX_CANDIDATES` — into tier-1 / tier-2 / suppressed / (neither tier).
 * Exists so the zero-LLM docs-drift census can show how far the tiering discipline collapses the
 * raw reference count down to the selective candidate rate. `total` is the same count
 * `computeDocsDriftCandidates` would sweep before its own per-referand cap and position filtering.
 */
export function classifyRawDocReferences(context: ReviewContext): RawDocReferenceTally {
  const tally: RawDocReferenceTally = { total: 0, tier1: 0, tier2: 0, suppressed: 0 };
  const setup = setupSweep(context);
  if (!setup) return tally;

  const deadline = Date.now() + DOCS_DRIFT_TIME_BUDGET_MS;
  for (const referand of setup.referands) {
    if (Date.now() > deadline) break;
    const matches = sweepReferand(referand, setup.docChunks, deadline, Infinity);
    for (const match of matches) tallyRawMatch(referand, match, tally);
  }

  return tally;
}
