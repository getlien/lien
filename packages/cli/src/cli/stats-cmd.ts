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
import { readDeltaEvents } from '../utils/delta-events.js';
import { computeDeltaWindowStats, type DeltaWindowStats } from '../utils/delta-stats.js';

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

  if (format === 'json') {
    console.log(JSON.stringify({ totalEvents: events.length, windows }, null, 2));
    return;
  }

  console.log(chalk.bold('lien delta — nudge-loop stats\n'));
  if (events.length === 0) {
    console.log(
      chalk.dim(
        'No lien delta runs recorded yet. Run `lien delta`, or edit with the plugin hooks\n' +
          'installed, to start building local history.',
      ),
    );
    return;
  }

  for (const w of windows) {
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
