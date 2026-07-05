import chalk from 'chalk';
import { getIndexDir } from '@liendev/parser';
import {
  planGc,
  executeGc,
  formatBytes,
  DEFAULT_STALE_DAYS,
  type GcPlan,
  type GcSummary,
  type GcSkipReason,
} from '@liendev/core';
import { resolveProjectRoot } from './project-root.js';
import { handleCommandError } from './utils.js';

interface GcCommandOptions {
  dryRun?: boolean;
  stale?: string | boolean;
  format?: string;
  verbose?: boolean;
}

const VALID_FORMATS = ['text', 'json'];

/** Human-readable label per skip reason for the report. */
const SKIP_LABELS: Record<GcSkipReason, string> = {
  'current-project': 'current project',
  'in-use': 'in use by a live process',
  unprobeable: 'could not verify (skipped for safety)',
  'volume-offline': 'source volume offline',
  'unknown-provenance': 'unknown provenance (legacy)',
  present: 'source root present',
};

/**
 * Resolve the `--stale [days]` flag into a day count, or undefined when the flag
 * was not passed. `--stale` alone means the default window. Requires an
 * integer >= 1 — `--stale 0` would make every index (including ones accessed
 * moments ago) an immediate removal candidate, which is never what's meant.
 */
function parseStaleDays(stale: string | boolean | undefined): number | undefined {
  if (stale === undefined) return undefined;
  if (stale === true) return DEFAULT_STALE_DAYS;
  const days = Number(stale);
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`--stale expects a whole number of days >= 1, got "${String(stale)}"`);
  }
  return days;
}

function reasonColor(kind: 'orphan' | 'stale'): (s: string) => string {
  return kind === 'orphan' ? chalk.red : chalk.yellow;
}

/** Print the removal candidates + lance sweeps (or a "nothing to collect" line). */
function printCandidates(plan: GcPlan): void {
  if (plan.removals.length === 0 && plan.lanceSweeps.length === 0) {
    console.log(chalk.green('Nothing to collect — no orphaned, stale, or legacy data found.\n'));
    return;
  }
  console.log(chalk.bold('Candidates:'));
  for (const r of plan.removals) {
    const color = reasonColor(r.kind);
    const size = chalk.dim(formatBytes(r.sizeBytes));
    console.log(
      `  ${color('✗')} ${chalk.cyan(r.repoId)}  ${size}  ${color(r.kind)} — ${chalk.dim(r.detail)}`,
    );
  }
  for (const s of plan.lanceSweeps) {
    const size = chalk.dim(formatBytes(s.sizeBytes));
    console.log(
      `  ${chalk.magenta('🧹')} ${chalk.cyan(s.repoId)}/code_chunks.lance  ${size}  ${chalk.magenta('legacy lance sweep')}`,
    );
  }
  console.log('');
}

/** Print the grouped skip breakdown. */
function printSkips(plan: GcPlan): void {
  if (plan.skipped.length === 0) return;
  const counts = new Map<GcSkipReason, number>();
  for (const s of plan.skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  const parts = [...counts.entries()].map(([reason, n]) => `${n} ${SKIP_LABELS[reason]}`);
  console.log(chalk.dim(`Skipped ${plan.skipped.length}: ${parts.join(', ')}`));
}

/** Print the candidate list, skip breakdown, and a --stale hint. */
function printPlanText(plan: GcPlan, staleDays: number | undefined): void {
  console.log(chalk.dim(`Indices root: ${plan.indicesRoot}\n`));
  printCandidates(plan);
  printSkips(plan);
  if (staleDays === undefined) {
    console.log(
      chalk.dim(
        `Tip: add --stale [days] to also remove indices not accessed recently (default ${DEFAULT_STALE_DAYS}d).`,
      ),
    );
  }
}

/** Print the final one-line summary. Always printed. */
function printSummaryText(summary: GcSummary): void {
  const verb = summary.dryRun ? 'Would remove' : 'Removed';
  const freed = summary.dryRun ? 'would free' : 'freed';
  const lance = summary.sweptLanceDirs > 0 ? ` + ${summary.sweptLanceDirs} lance dir(s)` : '';
  console.log(
    '\n' +
      chalk.bold(
        `${verb} ${summary.removedIndices} ${summary.removedIndices === 1 ? 'index' : 'indices'}${lance}, ` +
          `${freed} ${formatBytes(summary.freedBytes)}, skipped ${summary.skipped}` +
          (summary.dryRun ? chalk.dim('  (dry run — nothing deleted)') : ''),
      ),
  );
}

function outputJson(plan: GcPlan, summary: GcSummary): void {
  console.log(JSON.stringify({ plan, summary }, null, 2));
}

/**
 * `lien gc` — reclaim `~/.lien/indices` space. Default action removes orphaned
 * indices (source root gone) and sweeps legacy `code_chunks.lance` dirs; opt in
 * to time-based cleanup with `--stale [days]`. `--dry-run` previews without
 * deleting. Never touches the current project's index or one a live process
 * holds open.
 */
export async function gcCommand(options: GcCommandOptions = {}): Promise<void> {
  const format = options.format ?? 'text';
  if (!VALID_FORMATS.includes(format)) {
    console.error(chalk.red(`Invalid format: ${format}. Valid: ${VALID_FORMATS.join(', ')}`));
    process.exit(1);
  }

  let staleDays: number | undefined;
  try {
    staleDays = parseStaleDays(options.stale);
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(2);
  }

  try {
    const currentIndexDir = getIndexDir(resolveProjectRoot(process.cwd()));
    const dryRun = options.dryRun ?? false;

    const plan = await planGc({ staleDays, protectedDirs: [currentIndexDir], dryRun });
    const summary = await executeGc(plan, { dryRun });

    if (format === 'json') {
      outputJson(plan, summary);
      return;
    }

    console.log(chalk.bold(`\nLien index GC${dryRun ? chalk.dim('  (dry run)') : ''}\n`));
    printPlanText(plan, staleDays);
    printSummaryText(summary);
  } catch (error) {
    handleCommandError(error, options.verbose ?? false);
    process.exit(1);
  }
}
