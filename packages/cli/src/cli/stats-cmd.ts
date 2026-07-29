/**
 * `lien stats` — local, historical metrics for the `lien delta` nudge loop.
 *
 * Reads the JSONL event log `lien delta` appends to on every run (see
 * `../utils/delta-events.ts`) and reports 7/30-day windows: how many runs
 * happened, how many had new crossings, how many distinct functions were
 * flagged, and how many were later seen clean ("resolved after flag" — an
 * honest presence/absence signal, not a causal claim; see the field docs in
 * `../utils/delta-stats.ts`). Everything here reads a file already on disk —
 * no network call, ever.
 */

import chalk from 'chalk';
import { getRepoRoot } from './delta-git.js';
import { readDeltaEvents, type DeltaEvent } from '../utils/delta-events.js';
import { computeDeltaWindowStats, type DeltaWindowStats } from '../utils/delta-stats.js';
import { readBlastEvents, type BlastEvent } from '../utils/blast-events.js';
import { computeBlastWindowStats, type BlastWindowStats } from '../utils/blast-stats.js';
import { readNudgeEvents, type NudgeEvent } from '../utils/nudge-events.js';
import {
  computeNudgeFunnels,
  computeNudgeRecordingStatus,
  type NudgeFunnel,
  type NudgeRecordingStatus,
} from '../utils/nudge-stats.js';
import type { BuildStamp } from '../utils/nudge-build.js';

const VALID_FORMATS = ['text', 'json'];
const WINDOW_DAYS = [7, 30] as const;

export interface StatsOptions {
  format?: string;
}

function formatShare(share: number | null): string {
  return share === null ? '–' : `${Math.round(share * 100)}%`;
}

function formatWindow(stats: DeltaWindowStats): string {
  return [
    chalk.bold(`  Last ${stats.windowDays} days`),
    `    Runs: ${stats.runs} ${chalk.dim(`(${stats.runsWithCrossings} with new crossings)`)}`,
    `    Distinct functions flagged: ${stats.distinctFunctionsFlagged}`,
    `    Resolved after flag: ${stats.resolvedAfterFlag}`,
    `    Soft-mode share of flagged runs: ${formatShare(stats.softShareOfFlaggedRuns)}`,
  ].join('\n');
}

/** "exported-signature nudge" section — the FEATURE 1 blast-radius nudge's own local history. */
function formatBlastWindow(stats: BlastWindowStats): string {
  const { low, medium, high, critical, unknown } = stats.byRiskLevel;
  const riskParts = [`low ${low}`, `medium ${medium}`, `high ${high}`, `critical ${critical}`];
  if (unknown > 0) riskParts.push(`unknown ${unknown}`);
  return [
    chalk.bold(`  Last ${stats.windowDays} days`),
    `    Runs: ${stats.runs}`,
    `    Distinct symbols changed: ${stats.distinctSymbolsChanged}`,
    `    By risk level: ${riskParts.join(', ')}`,
  ].join('\n');
}

interface StatsData {
  events: DeltaEvent[];
  windows: DeltaWindowStats[];
  blastEvents: BlastEvent[];
  blastWindows: BlastWindowStats[];
  nudgeEvents: NudgeEvent[];
  /** One funnel array per window in WINDOW_DAYS order (each array is delta, annotate, blast, test-verify). */
  nudgeFunnels: NudgeFunnel[][];
  /** One recording-provenance status per window in WINDOW_DAYS order — see nudge-stats.ts. */
  nudgeRecording: NudgeRecordingStatus[];
  /** The single "now" every window/status computation in this run is relative to. */
  now: Date;
}

/** Display labels for the funnel rows, in the order `computeNudgeFunnels` emits them. */
const NUDGE_LABELS: Record<NudgeFunnel['nudge'], string> = {
  delta: 'complexity delta',
  annotate: 'read-time impact',
  blast: 'exported-signature',
  'test-verify': 'did-you-run-tests',
};

function formatFunnelRow(f: NudgeFunnel): string {
  const label = `${NUDGE_LABELS[f.nudge]}:`.padEnd(20);
  return `    ${label} shown ${f.shown}, acted-on ${f.acted} ${chalk.dim(`(${formatShare(f.actedShare)})`)}`;
}

function formatFunnelWindow(windowDays: number, funnels: NudgeFunnel[]): string {
  return [chalk.bold(`  Last ${windowDays} days`), ...funnels.map(formatFunnelRow)].join('\n');
}

/** `v0.72.0 (hooks a1b2c3d4e5f6)`, or `(hooks unknown)` for a stamp recorded with no `--hooks-dir`. */
function formatBuildStamp(build: BuildStamp): string {
  return `${build.cliVersion} (hooks ${build.hooksHash ?? 'unknown'})`;
}

function daysAgo(iso: string, now: Date): number {
  return Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / (24 * 60 * 60 * 1000)));
}

/**
 * The build-provenance line(s) for one window (issue #916) — makes "zero
 * events" self-explaining instead of ambiguous between disengagement and
 * absent instrumentation. Returns null when there's nothing extra to say (a
 * non-empty window whose events happen to predate build stamping — the funnel
 * numbers already speak for themselves there).
 */
function formatRecordingStatus(status: NudgeRecordingStatus, now: Date): string | null {
  if (!status.windowEmpty) {
    if (!status.build) return null;
    return chalk.dim(`    Recorded by: ${formatBuildStamp(status.build)}`);
  }
  if (status.neverRecorded) {
    return chalk.yellow(
      '    No recording-capable build has ever been observed for this repo. Zero events here\n' +
        '    may mean the plugin instrumentation was never installed, or predates this feature —\n' +
        '    not that nudges fired and were ignored.',
    );
  }
  const build = status.build as BuildStamp;
  const when = status.seenAt ? `${daysAgo(status.seenAt, now)}d ago` : 'an unknown time ago';
  return chalk.yellow(
    `    Zero events in this window, but a recording-capable build was last seen ${when}\n` +
      `    (${formatBuildStamp(build)}). Zero here likely means no qualifying edits this window,\n` +
      '    not a broken install — but if you expected activity, check the plugin is current.',
  );
}

/** Additive: FEATURE 1's own local history nests under `blastRadius`, and the
 *  telemetry-v2 funnels nest under `nudgeFunnels`, so the pre-existing top-level
 *  shape (totalEvents/windows) never changes for callers. */
function printJsonStats(data: StatsData): void {
  console.log(
    JSON.stringify(
      {
        totalEvents: data.events.length,
        windows: data.windows,
        blastRadius: { totalEvents: data.blastEvents.length, windows: data.blastWindows },
        nudgeFunnels: {
          totalEvents: data.nudgeEvents.length,
          windows: data.nudgeFunnels,
          recording: data.nudgeRecording,
        },
      },
      null,
      2,
    ),
  );
}

function printDeltaTextSection(data: StatsData): void {
  for (const w of data.windows) {
    console.log(formatWindow(w));
    console.log('');
  }
  console.log(
    chalk.dim(
      '"Resolved after flag" means a flagged function was later seen clean — it is not proof\n' +
        'the warning caused the fix. All data stays on this machine (delta-events.jsonl next to\n' +
        'the local index); disable recording with LIEN_DELTA_EVENTS=off.',
    ),
  );
}

function printBlastTextSection(data: StatsData): void {
  console.log('');
  console.log(chalk.bold('Exported-signature nudge\n'));
  for (const w of data.blastWindows) {
    console.log(formatBlastWindow(w));
    console.log('');
  }
  console.log(
    chalk.dim(
      "Tracks edits that changed or removed an exported symbol's signature, and the risk level\n" +
        '(dependents/coverage) at the time. Local-only (blast-events.jsonl next to the local\n' +
        'index); disable recording with LIEN_BLAST_EVENTS=off.',
    ),
  );
}

function printFunnelTextSection(data: StatsData): void {
  console.log('');
  console.log(chalk.bold('Nudge funnels (shown → acted-on)\n'));
  WINDOW_DAYS.forEach((days, i) => {
    console.log(formatFunnelWindow(days, data.nudgeFunnels[i]));
    const recordingLine = formatRecordingStatus(data.nudgeRecording[i], data.now);
    if (recordingLine) console.log(recordingLine);
    console.log('');
  });
  console.log(
    chalk.dim(
      '"Acted-on" is a same-session follow-up AFTER the nudge that names the same file/symbol — for\n' +
        'the complexity delta nudge, a flagged function later seen clean; for the others, a later\n' +
        'get_dependents / get_files_context on the flagged file/symbol (test-verify: any later test\n' +
        'run). It biases toward undercounting, and is co-occurrence over time,\n' +
        'NOT proof the nudge caused the action. Local-only (nudge-events.jsonl next to the local\n' +
        'index); disable recording with LIEN_NUDGE_EVENTS=off.',
    ),
  );
}

function printTextStats(data: StatsData): void {
  console.log(chalk.bold('lien delta — nudge-loop stats\n'));
  if (data.events.length === 0 && data.blastEvents.length === 0 && data.nudgeEvents.length === 0) {
    console.log(
      chalk.dim(
        'No lien delta runs recorded yet. Run `lien delta`, or edit with the plugin hooks\n' +
          'installed, to start building local history.',
      ),
    );
    return;
  }
  printDeltaTextSection(data);
  printBlastTextSection(data);
  printFunnelTextSection(data);
}

/** Analyze the local `lien delta` event log and report 7/30-day nudge-loop metrics. */
export async function statsCommand(options: StatsOptions = {}): Promise<void> {
  const format = options.format ?? 'text';
  if (!VALID_FORMATS.includes(format)) {
    console.error(chalk.red(`lien stats: invalid --format "${format}". Must be text or json.`));
    process.exit(1);
    return;
  }

  const rootDir = await getRepoRoot(process.cwd());
  if (!rootDir) {
    console.error(chalk.red('lien stats: not a git repository (or git is not installed)'));
    process.exit(1);
    return;
  }

  const events = await readDeltaEvents(rootDir);
  const windows = WINDOW_DAYS.map(days => computeDeltaWindowStats(events, days));
  const blastEvents = await readBlastEvents(rootDir);
  const blastWindows = WINDOW_DAYS.map(days => computeBlastWindowStats(blastEvents, days));
  const nudgeEvents = await readNudgeEvents(rootDir);
  const now = new Date();
  const nudgeFunnels = WINDOW_DAYS.map(days => computeNudgeFunnels(nudgeEvents, events, days, now));
  const nudgeRecording = WINDOW_DAYS.map(days =>
    computeNudgeRecordingStatus(nudgeEvents, days, now),
  );
  const data: StatsData = {
    events,
    windows,
    blastEvents,
    blastWindows,
    nudgeEvents,
    nudgeFunnels,
    nudgeRecording,
    now,
  };

  if (format === 'json') {
    printJsonStats(data);
  } else {
    printTextStats(data);
  }
}
