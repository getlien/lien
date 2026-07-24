/**
 * Session risk-ledger recap — the pure aggregation behind `lien recap`, the
 * Stop-time surface that re-raises UNRESOLVED risk from the current session at
 * the finish line. A nudge shown at minute 5 is gone from context by minute 90;
 * the recap consolidates three per-session signals into one advisory the model
 * sees exactly once when it tries to stop:
 *
 *   1. tests  — edited files whose associated tests were never observed running
 *               (reuses `computeUnverifiedFiles` verbatim — do NOT fork it).
 *   2. delta  — functions this session touched that STILL cross a complexity
 *               threshold in the working tree (a live `lien delta` recompute,
 *               done by the command wrapper; this module only joins the result).
 *   3. blast  — exported-API changes the blast-radius nudge warned about that
 *               were never followed by a `get_dependents` check.
 *
 * CREDIBILITY AXIS — UNRESOLVED ONLY. A recap item the agent already fixed
 * destroys trust, so every source is a "shown-but-not-resolved" join:
 *   - tests: `computeUnverifiedFiles`'s own broad-run/coverage rules.
 *   - delta: the live working-tree-vs-HEAD verdict — a crossing the agent
 *            already simplified reads clean and never appears (see
 *            docs/architecture/session-risk-recap.md for why this beats mining
 *            `delta-events.jsonl`, which has no session_id and no before/after
 *            values).
 *   - blast: a blast nudge shown with no matching get_dependents signal
 *            at/after it — mirrors `nudge-stats.ts`'s blast matched-join,
 *            inverted.
 *
 * Pure and I/O-free: it takes already-gathered inputs, so it's trivially
 * unit-testable with synthetic sequences (see `session-recap.test.ts`). All the
 * git/index/ledger reads live in the command wrapper (`recap-cmd.ts`).
 */

import type { NudgeEvent } from './nudge-events.js';

/** Max non-tests items rendered per section (worst-first); the rest collapse to "(+N more)". */
export const MAX_RECAP_ITEMS_PER_SECTION = 3;

/**
 * One unresolved complexity crossing in a file this session touched. The
 * numeric values are pre-rendered to strings by the command wrapper (reusing
 * `lien delta`'s own `fmtValue`), so this module never has to know that
 * Halstead effort is floored minutes while cognitive is a bare integer.
 */
export interface DeltaRecapItem {
  filepath: string;
  /** parentClass-qualified display name, e.g. "MyClass.doThing". */
  symbol: string;
  /** Human metric label: "cognitive" | "cyclomatic" | "time" | "bugs". */
  metricLabel: string;
  /** Pre-rendered "before" value, or "new" for a newly-added function. */
  beforeText: string;
  afterText: string;
  thresholdText: string;
}

/** One exported-API change the blast nudge warned about but that never got a get_dependents check. */
export interface BlastRecapItem {
  symbol: string;
  /** Project-relative file the change was in, when the shown event carried one. */
  file?: string;
}

export interface SessionRecapInput {
  /** From `computeUnverifiedFiles` (reused verbatim). */
  tests: Array<{ file: string; tests: string[] }>;
  /** From the live working-tree delta, already scoped to session-touched files, worst-first. */
  delta: DeltaRecapItem[];
  /** From `computeUnactedBlastNudges`. */
  blast: BlastRecapItem[];
}

export interface SessionRecap {
  tests: Array<{ file: string; tests: string[] }>;
  delta: DeltaRecapItem[];
  blast: BlastRecapItem[];
  /** True when every section is empty — the caller stays silent (no block). */
  isEmpty: boolean;
}

/**
 * Which blast-radius nudges shown THIS session were never followed by a
 * `get_dependents` naming the same file or symbol. Inverts `nudge-stats.ts`'s
 * blast matched-join: a blast `shown` (recorded by `api-delta-write.sh` at edit
 * time) counts as UNRESOLVED unless a `get_dependents` signal at/after its
 * earliest shown timestamp names the same symbol, or a file it was shown for.
 *
 * Pure. `sessionId` scopes to this session (the log accumulates across
 * sessions). Deduped by symbol, most-recently-shown first, so the cap keeps the
 * freshest concerns. A shown event with no `symbol` is skipped (can't render or
 * match it) — a silent miss in the safe direction.
 */
interface DepSignal {
  timeMs: number;
  file?: string;
  symbol?: string;
}
interface BlastShownInfo {
  earliestMs: number;
  latestMs: number;
  files: Set<string>;
}

/** Fold one blast-shown observation into the per-symbol info map (first-seen / last-seen / files). */
function recordBlastShown(
  map: Map<string, BlastShownInfo>,
  symbol: string,
  timeMs: number,
  file?: string,
): void {
  const cur = map.get(symbol);
  if (!cur) {
    map.set(symbol, { earliestMs: timeMs, latestMs: timeMs, files: new Set(file ? [file] : []) });
    return;
  }
  cur.earliestMs = Math.min(cur.earliestMs, timeMs);
  cur.latestMs = Math.max(cur.latestMs, timeMs);
  if (file) cur.files.add(file);
}

/** Split this-session events into get_dependents signals and per-symbol blast-shown info. */
function collectBlastSessionState(
  events: NudgeEvent[],
  sessionId: string,
): { deps: DepSignal[]; shownBySymbol: Map<string, BlastShownInfo> } {
  const deps: DepSignal[] = [];
  const shownBySymbol = new Map<string, BlastShownInfo>();
  for (const e of events) {
    if (e.sessionId !== sessionId) continue;
    const t = Date.parse(e.timestamp);
    if (!Number.isFinite(t)) continue;
    if (e.kind === 'signal' && e.signal === 'get_dependents') {
      deps.push({ timeMs: t, file: e.file, symbol: e.symbol });
    } else if (e.kind === 'shown' && e.nudge === 'blast' && e.symbol) {
      recordBlastShown(shownBySymbol, e.symbol, t, e.file);
    }
  }
  return { deps, shownBySymbol };
}

/** A blast concern is acted-on when some get_dependents at/after its first shown names its symbol or a shown file. */
function isBlastActed(deps: DepSignal[], symbol: string, info: BlastShownInfo): boolean {
  return deps.some(
    s =>
      s.timeMs >= info.earliestMs &&
      (s.symbol === symbol || (s.file !== undefined && info.files.has(s.file))),
  );
}

export function computeUnactedBlastNudges(
  events: NudgeEvent[],
  sessionId: string,
): BlastRecapItem[] {
  const { deps, shownBySymbol } = collectBlastSessionState(events, sessionId);
  const unacted: Array<BlastRecapItem & { latestMs: number }> = [];
  for (const [symbol, info] of shownBySymbol) {
    if (isBlastActed(deps, symbol, info)) continue;
    const file = [...info.files][0];
    unacted.push({ symbol, ...(file ? { file } : {}), latestMs: info.latestMs });
  }
  return unacted
    .sort((a, b) => b.latestMs - a.latestMs)
    .map(({ latestMs: _latestMs, ...item }) => item);
}

/** Assemble the recap from its three already-gathered sources. Pure; caps are applied at render time. */
export function computeSessionRecap(input: SessionRecapInput): SessionRecap {
  return {
    tests: input.tests,
    delta: input.delta,
    blast: input.blast,
    isEmpty: input.tests.length === 0 && input.delta.length === 0 && input.blast.length === 0,
  };
}

function fmtDeltaItem(item: DeltaRecapItem): string {
  return `  • ${item.symbol} ${item.metricLabel} ${item.afterText} (was ${item.beforeText}, limit ${item.thresholdText})`;
}

/**
 * Render the delta section (empty string when there are no items). Self-contained
 * — its own "Before finishing" opener and escape-hatch closer — so the recap can
 * stack it with the frozen tests advisory without paraphrasing either. Worst-first
 * (the delta primitive already sorts `regressions` that way), capped, with "(+N more)".
 */
export function formatDeltaSection(items: DeltaRecapItem[]): string {
  if (items.length === 0) return '';
  const shown = items.slice(0, MAX_RECAP_ITEMS_PER_SECTION);
  const more = items.length - shown.length;
  const lines = [
    'Before finishing: functions you changed this session still cross a complexity threshold (lien delta vs HEAD):',
    ...shown.map(fmtDeltaItem),
  ];
  if (more > 0) lines.push(`  (+${more} more)`);
  lines.push(
    'If you already simplified these another way, disregard and stop again. Otherwise, consider simplifying before you finish.',
  );
  return lines.join('\n');
}

function fmtBlastItem(item: BlastRecapItem): string {
  return item.file ? `  • ${item.symbol} (in ${item.file})` : `  • ${item.symbol}`;
}

/**
 * Render the blast section (empty string when there are no items). Self-contained,
 * mirroring `formatDeltaSection` / the frozen tests advisory. Most-recent-first, capped.
 */
export function formatBlastSection(items: BlastRecapItem[]): string {
  if (items.length === 0) return '';
  const shown = items.slice(0, MAX_RECAP_ITEMS_PER_SECTION);
  const more = items.length - shown.length;
  const lines = [
    'Before finishing: you changed an exported API this session but I never saw a get_dependents check for:',
    ...shown.map(fmtBlastItem),
  ];
  if (more > 0) lines.push(`  (+${more} more)`);
  lines.push(
    "If you already checked the callers another way (you know every caller, or it's a self-contained change), disregard and stop again. Otherwise, run get_dependents before you finish.",
  );
  return lines.join('\n');
}
