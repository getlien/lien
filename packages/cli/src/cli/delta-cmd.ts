/**
 * `lien delta` — flag NEW complexity threshold crossings in the working tree
 * before they are committed. The sixth commit gate: cheap, deterministic, and
 * it fails only on regressions you introduce (never on pre-existing debt).
 */

import chalk from 'chalk';
import { configService } from '@liendev/core';
import {
  computeComplexityDelta,
  resolveComplexityDeltaThresholds,
  hasRegressions,
  type ComplexityDeltaResult,
  type ComplexityDeltaThresholds,
  type FunctionComplexityDelta,
  type MetricComplexityDelta,
  type ComplexityDeltaVerdict,
} from '@liendev/parser';
import { getRepoRoot, collectFileChanges } from './delta-git.js';

export interface DeltaOptions {
  soft?: boolean;
  format: 'text' | 'json';
  threshold?: string;
}

const VALID_FORMATS = ['text', 'json'];

/** Merge config thresholds (+ optional --threshold override) over the defaults. */
export function resolveDeltaThresholds(
  configThresholds: Partial<ComplexityDeltaThresholds> | undefined,
  thresholdFlag: string | undefined,
): ComplexityDeltaThresholds {
  const overrides: Partial<ComplexityDeltaThresholds> = {};
  if (configThresholds) {
    // Copy only defined numeric values — an explicit `undefined` would otherwise
    // clobber the default when spread.
    for (const key of [
      'testPaths',
      'mentalLoad',
      'timeToUnderstandMinutes',
      'estimatedBugs',
    ] as const) {
      const value = configThresholds[key];
      if (typeof value === 'number') overrides[key] = value;
    }
  }
  if (thresholdFlag !== undefined) {
    const n = Number.parseInt(thresholdFlag, 10);
    if (!Number.isNaN(n)) {
      overrides.testPaths = n;
      overrides.mentalLoad = n;
    }
  }
  return resolveComplexityDeltaThresholds(overrides);
}

/** Exit code: 0 clean/soft, 1 regressions, (2 is reserved for operational errors). */
export function deltaExitCode(result: ComplexityDeltaResult, soft: boolean | undefined): number {
  if (soft) return 0;
  return hasRegressions(result) ? 1 : 0;
}

const VERDICT_DISPLAY: Record<
  ComplexityDeltaVerdict,
  { marker: string; label: string; color: (s: string) => string }
> = {
  crossed: { marker: '✗', label: 'crossed', color: chalk.red },
  'new-over-threshold': { marker: '✗', label: 'new>limit', color: chalk.red },
  'pre-existing': { marker: '⚠', label: 'pre-exist', color: chalk.yellow },
  worsened: { marker: '⚠', label: 'worsened', color: chalk.yellow },
  'new-under-threshold': { marker: '·', label: 'new', color: chalk.dim },
  improved: { marker: '✓', label: 'improved', color: chalk.green },
  unchanged: { marker: '·', label: 'unchanged', color: chalk.dim },
  removed: { marker: '·', label: 'removed', color: chalk.dim },
};

const METRIC_LABEL: Record<MetricComplexityDelta['metricType'], string> = {
  cyclomatic: 'cyclomatic',
  cognitive: 'cognitive',
  halstead_effort: 'time',
  halstead_bugs: 'bugs',
};

/** Pick the metric that best explains a function's overall verdict. */
function displayMetric(fn: FunctionComplexityDelta): MetricComplexityDelta | undefined {
  const matching = fn.metrics.filter(m => m.verdict === fn.verdict);
  const pool = matching.length > 0 ? matching : fn.metrics;
  const order: MetricComplexityDelta['metricType'][] = [
    'cognitive',
    'cyclomatic',
    'halstead_effort',
    'halstead_bugs',
  ];
  return [...pool].sort((a, b) => order.indexOf(a.metricType) - order.indexOf(b.metricType))[0];
}

function fmtValue(v: number | null, metricType: MetricComplexityDelta['metricType']): string {
  if (v === null) return '–';
  if (metricType === 'halstead_bugs') return v.toFixed(2);
  if (metricType === 'halstead_effort') return `${Math.round(v)}m`;
  return String(v);
}

function fmtFunction(fn: FunctionComplexityDelta): string {
  const d = VERDICT_DISPLAY[fn.verdict];
  const name = fn.parentClass ? `${fn.parentClass}.${fn.symbolName}` : fn.symbolName;
  const head = `    ${d.color(`${d.marker} ${d.label.padEnd(9)}`)} ${name.padEnd(24)}`;
  const m = displayMetric(fn);
  if (!m) return head;
  const showLimit = fn.verdict === 'crossed' || fn.verdict === 'new-over-threshold';
  const limit = showLimit ? chalk.dim(` (limit ${fmtValue(m.threshold, m.metricType)})`) : '';
  return `${head} ${chalk.dim(METRIC_LABEL[m.metricType])} ${fmtValue(m.before, m.metricType)} → ${fmtValue(m.after, m.metricType)}${limit}`;
}

/** Render the human-readable report. Pure — no I/O, no process state. */
export function formatDeltaText(result: ComplexityDeltaResult, elapsedMs: number): string {
  const { summary, files } = result;
  const filesWithFindings = files.filter(f => f.functions.length > 0);

  if (summary.functionsAnalyzed === 0) {
    const what =
      summary.filesChanged === 0
        ? 'no complexity-affecting changes'
        : `no complexity changes across ${summary.filesChanged} file(s)`;
    return chalk.dim(`lien delta — ${what} vs HEAD (${elapsedMs} ms)`);
  }

  const lines: string[] = [chalk.bold('lien delta — complexity vs HEAD'), ''];
  for (const file of filesWithFindings) {
    const tag =
      file.status === 'renamed' && file.oldPath ? chalk.dim(` (renamed from ${file.oldPath})`) : '';
    lines.push(`  ${chalk.cyan(file.filepath)}${tag}`);
    for (const fn of file.functions) lines.push(fmtFunction(fn));
    lines.push('');
  }

  const parts: string[] = [];
  const crossings = summary.crossed + summary.newOverThreshold;
  if (crossings > 0)
    parts.push(chalk.red(`✗ ${crossings} new crossing${crossings === 1 ? '' : 's'}`));
  if (summary.worsened > 0) parts.push(chalk.yellow(`⚠ ${summary.worsened} worsened`));
  if (summary.improved > 0) parts.push(chalk.green(`✓ ${summary.improved} improved`));
  parts.push(`${summary.filesChanged} file${summary.filesChanged === 1 ? '' : 's'}`);
  parts.push(`${elapsedMs} ms`);
  lines.push(`  ${parts.join(chalk.dim(' · '))}`);

  if (crossings > 0) {
    lines.push('');
    lines.push(
      chalk.red('  → new complexity crossings introduced.') +
        chalk.dim(' Simplify before committing, or re-run with --soft to advise only.'),
    );
  }
  return lines.join('\n');
}

/** Analyze the working tree's complexity delta vs HEAD. */
export async function deltaCommand(options: DeltaOptions): Promise<void> {
  const start = Date.now();

  if (!VALID_FORMATS.includes(options.format)) {
    console.error(chalk.red(`Error: Invalid --format "${options.format}". Must be text or json.`));
    process.exit(2);
  }

  const rootDir = await getRepoRoot(process.cwd());
  if (!rootDir) {
    console.error(chalk.red('lien delta: not a git repository (or git is not installed)'));
    process.exit(2);
  }

  const config = await configService.load(rootDir);
  const thresholds = resolveDeltaThresholds(config.complexity?.thresholds, options.threshold);

  let changes;
  try {
    changes = await collectFileChanges(rootDir);
  } catch (error) {
    console.error(
      chalk.red(
        `lien delta: failed to read git changes: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    process.exit(2);
  }

  const result = computeComplexityDelta(changes, thresholds);
  const elapsedMs = Date.now() - start;

  if (options.format === 'json') {
    console.log(JSON.stringify({ ...result, elapsedMs }, null, 2));
  } else {
    console.log(formatDeltaText(result, elapsedMs));
  }

  process.exit(deltaExitCode(result, options.soft));
}
