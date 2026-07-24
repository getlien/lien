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
import { computeNudgeFunnels, type NudgeFunnel } from '../utils/nudge-stats.js';

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
        nudgeFunnels: { totalEvents: data.nudgeEvents.length, windows: data.nudgeFunnels },
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
    console.log('');
  });
  console.log(
    chalk.dim(
      '"Acted-on" is a same-session follow-up that occurred AFTER the nudge — for the complexity\n' +
        'delta nudge, a flagged function later seen clean; for the others, a later tool call the\n' +
        'nudge asks for (get_dependents / get_files_context / a test run). It is co-occurrence over\n' +
        'time, NOT proof the nudge caused the action. Local-only (nudge-events.jsonl next to the\n' +
        'local index); disable recording with LIEN_NUDGE_EVENTS=off.',
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
  const nudgeFunnels = WINDOW_DAYS.map(days => computeNudgeFunnels(nudgeEvents, events, days));
  const data: StatsData = {
    events,
    windows,
    blastEvents,
    blastWindows,
    nudgeEvents,
    nudgeFunnels,
  };

  if (format === 'json') {
    printJsonStats(data);
  } else {
    printTextStats(data);
  }
}
