/**
 * `lien recap --session <id>` — the session risk-ledger recap. The single
 * Stop-time surface that re-raises UNRESOLVED risk from the current session at
 * the finish line, consolidating three signals into one advisory (and exactly
 * one Stop block per episode). It REPLACES `test-verify-stop.sh`'s single-source
 * block: the tests source is folded in verbatim, alongside two more —
 * unresolved complexity crossings and unacted blast-radius warnings. See
 * docs/architecture/session-risk-recap.md.
 *
 * Fail-open by construction (like `verify-tests`): any error is swallowed and
 * the process still exits 0, since this backs a Stop hook that must never trap
 * the agent. A missing/invalid `--session` is a silent no-op for the same reason.
 *
 * The pure join lives in `../utils/session-recap.ts`; this wrapper does the
 * git/index/ledger I/O — including the delta source's LIVE working-tree
 * recompute (see `computeSessionDelta`).
 */

import { configService } from '@liendev/core';
import {
  computeComplexityDelta,
  type FunctionComplexityDelta,
  type MetricComplexityDelta,
} from '@liendev/parser';
import { resolveProjectRoot } from './project-root.js';
import { toAbsolutePath } from '../types/paths.js';
import { collectFileChange } from './delta-git.js';
import { resolveDeltaThresholds, fmtValue } from './delta-cmd.js';
import {
  splitSessionEvents,
  wasRecentlyBlocked,
  formatVerifyTestsAdvisory,
} from './verify-tests-cmd.js';
import {
  readSession,
  recordBlocked,
  recapEnabled,
  type TestLedgerEvent,
} from '../utils/test-ledger.js';
import { computeUnverifiedFiles } from '../utils/test-run-matcher.js';
import { readNudgeEvents, recordNudgeShown, type NudgeEvent } from '../utils/nudge-events.js';
import {
  computeSessionRecap,
  computeUnactedBlastNudges,
  formatDeltaSection,
  formatBlastSection,
  type DeltaRecapItem,
  type SessionRecap,
  type SessionRecapInput,
} from '../utils/session-recap.js';

export interface RecapOptions {
  session?: string;
  format?: string;
  /** The calling hook script's own directory (recap-stop.sh's `BASH_SOURCE` dir),
   *  passed through to the test-verify shown event's build stamp. See nudge-build.ts. */
  hooksDir?: string;
}

const VALID_FORMATS = ['text', 'json'];

function resolveRootDir(): string {
  return resolveProjectRoot(toAbsolutePath(process.cwd()));
}

/** Run the real work, swallow any error, always exit 0 — this backs a Stop hook. */
async function runFailOpen(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch {
    // Fail-open: the recap must never trap the agent at Stop.
  }
  process.exit(0);
}

const METRIC_LABEL: Record<MetricComplexityDelta['metricType'], string> = {
  cyclomatic: 'cyclomatic',
  cognitive: 'cognitive',
  halstead_effort: 'time',
  halstead_bugs: 'bugs',
};

/**
 * Turn a live-delta regression into a recap item, picking the crossing metric
 * that best explains it (cognitive first — the same preference `lien delta`'s
 * own report uses). Returns null if no metric actually crossed (defensive; every
 * `regressions[]` entry has at least one by construction).
 */
function toDeltaRecapItem(fn: FunctionComplexityDelta): DeltaRecapItem | null {
  const crossing = fn.metrics.filter(
    m => m.verdict === 'crossed' || m.verdict === 'new-over-threshold',
  );
  if (crossing.length === 0) return null;
  const order: MetricComplexityDelta['metricType'][] = [
    'cognitive',
    'cyclomatic',
    'halstead_effort',
    'halstead_bugs',
  ];
  const m = [...crossing].sort(
    (a, b) => order.indexOf(a.metricType) - order.indexOf(b.metricType),
  )[0];
  return {
    filepath: fn.filepath,
    symbol: fn.parentClass ? `${fn.parentClass}.${fn.symbolName}` : fn.symbolName,
    metricLabel: METRIC_LABEL[m.metricType],
    beforeText: m.before === null ? 'new' : fmtValue(m.before, m.metricType),
    afterText: fmtValue(m.after, m.metricType),
    thresholdText: fmtValue(m.threshold, m.metricType),
  };
}

/** Repo-relative files this session demonstrably worked on: edited (ledger) or fetched-context/queried (nudge). */
function sessionTouchedFiles(
  ledgerEvents: TestLedgerEvent[],
  nudgeEvents: NudgeEvent[],
  sessionId: string,
): string[] {
  const set = new Set<string>();
  for (const e of ledgerEvents) {
    if (e.kind === 'edit') set.add(e.file.replace(/\\/g, '/'));
  }
  for (const e of nudgeEvents) {
    if (e.sessionId === sessionId && e.file) set.add(e.file.replace(/\\/g, '/'));
  }
  return [...set];
}

/**
 * The delta source: a LIVE `lien delta` recompute (working tree vs HEAD) scoped
 * to the files this session touched, reusing the shared complexity-delta
 * primitive so the recap's verdict can never diverge from `lien delta`'s. This
 * is why the delta source is credible-by-construction: a crossing the agent
 * already simplified reads clean RIGHT NOW and never appears — no stale event
 * to mistrust. Bounded to touched files (per-file collect, not a whole-tree
 * scan). Fail-open: any git/parse/config error yields no delta items.
 */
async function computeSessionDelta(
  rootDir: string,
  touchedFiles: string[],
): Promise<DeltaRecapItem[]> {
  if (touchedFiles.length === 0) return [];
  try {
    let thresholds;
    try {
      const config = await configService.load(rootDir);
      thresholds = resolveDeltaThresholds(config.complexity?.thresholds, undefined);
    } catch {
      thresholds = resolveDeltaThresholds(undefined, undefined);
    }
    const collected = await Promise.all(
      touchedFiles.map(f => collectFileChange(rootDir, f).catch(() => null)),
    );
    const changes = collected.filter((c): c is NonNullable<typeof c> => c !== null);
    if (changes.length === 0) return [];
    const result = computeComplexityDelta(changes, thresholds);
    // regressions are already worst-first from the primitive.
    return result.regressions.map(toDeltaRecapItem).filter((i): i is DeltaRecapItem => i !== null);
  } catch {
    return [];
  }
}

/** Gather the three UNRESOLVED-only sources for this session (tests reuse the exact verify-tests path). */
async function gatherRecapSources(
  rootDir: string,
  sessionId: string,
  ledgerEvents: TestLedgerEvent[],
  nudgeEvents: NudgeEvent[],
): Promise<SessionRecapInput> {
  const { edits, runs } = splitSessionEvents(ledgerEvents);
  const tests = computeUnverifiedFiles(edits, runs);
  const blast = computeUnactedBlastNudges(nudgeEvents, sessionId);
  const touched = sessionTouchedFiles(ledgerEvents, nudgeEvents, sessionId);
  const delta = await computeSessionDelta(rootDir, touched);
  return { tests, delta, blast };
}

function emitRecapJson(recap: SessionRecap, suppressed: boolean): void {
  console.log(
    JSON.stringify({ tests: recap.tests, delta: recap.delta, blast: recap.blast, suppressed }),
  );
}

/**
 * Stack the active sections into one advisory: delta, blast, then the FROZEN
 * tests advisory last — so a tests-only recap is byte-identical to the old
 * `verify-tests report` output, and there is one `decision:block` reason for all of it.
 */
function renderRecapText(recap: SessionRecap): string {
  const sections: string[] = [];
  const deltaText = formatDeltaSection(recap.delta);
  if (deltaText) sections.push(deltaText);
  const blastText = formatBlastSection(recap.blast);
  if (blastText) sections.push(blastText);
  if (recap.tests.length > 0) sections.push(formatVerifyTestsAdvisory(recap.tests));
  return sections.join('\n\n');
}

async function runRecap(options: RecapOptions): Promise<void> {
  const format = options.format ?? 'text';
  if (!options.session || !VALID_FORMATS.includes(format)) return;
  if (!recapEnabled()) return;

  const rootDir = resolveRootDir();
  const ledgerEvents = await readSession(rootDir, options.session);
  const nudgeEvents = await readNudgeEvents(rootDir);
  const recap = computeSessionRecap(
    await gatherRecapSources(rootDir, options.session, ledgerEvents, nudgeEvents),
  );

  if (recap.isEmpty) {
    if (format === 'json') emitRecapJson(recap, false);
    return;
  }

  // Loop-prevention (second line of defense, alongside the hook's own
  // `stop_hook_active`): if the recap already blocked within the window, treat
  // this Stop as clean rather than re-nagging. Reuses #843's ledger `blocked`
  // event and `wasRecentlyBlocked` — one suppression window for ALL recap content.
  if (wasRecentlyBlocked(ledgerEvents)) {
    if (format === 'json') emitRecapJson(recap, true);
    return;
  }

  await recordBlocked(rootDir, options.session);
  // Keep the existing `test-verify` funnel populated: record a shown event only
  // when the tests section actually fires and we're actually blocking (the same
  // moment the old test-verify-stop.sh recorded it). blast shown events already
  // exist from edit time; the delta funnel derives from delta-events, not here.
  if (recap.tests.length > 0) {
    await recordNudgeShown(rootDir, {
      sessionId: options.session,
      nudge: 'test-verify',
      hooksDir: options.hooksDir,
    });
  }

  if (format === 'json') {
    emitRecapJson(recap, false);
    return;
  }
  console.log(renderRecapText(recap));
}

/** `recap --session <id> [--format text|json]`: the Stop hook's data source. Does not clear any ledger. */
export async function recapCommand(options: RecapOptions): Promise<void> {
  await runFailOpen(() => runRecap(options));
}
