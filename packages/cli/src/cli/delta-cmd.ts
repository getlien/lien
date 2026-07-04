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
import { getRepoRoot, collectFileChanges, collectFileChange } from './delta-git.js';

export interface DeltaOptions {
  soft?: boolean;
  format: 'text' | 'json';
  threshold?: string;
  /**
   * Restrict analysis to a single file (working tree vs HEAD). The fast path
   * the PostToolUse edit hook uses — bounds the work to the one edited file
   * instead of scanning the whole working tree on every keystroke.
   */
  file?: string;
}

const VALID_FORMATS = ['text', 'json'];

/**
 * Parse and validate the `--threshold` flag. Returns `undefined` when the flag
 * is absent; otherwise the parsed value, which MUST be a positive integer.
 *
 * Throws on malformed input (non-numeric, negative, zero, or a float) so the
 * command can report it and exit 2. A negative threshold would turn every
 * function into a regression; a float would be silently truncated by parseInt —
 * both are user errors we refuse rather than guess at.
 */
export function parseThresholdFlag(thresholdFlag: string | undefined): number | undefined {
  if (thresholdFlag === undefined) return undefined;
  const trimmed = thresholdFlag.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `Invalid --threshold "${thresholdFlag}": must be a positive integer (whole number > 0).`,
    );
  }
  const n = Number.parseInt(trimmed, 10);
  if (n <= 0) {
    throw new Error(`Invalid --threshold "${thresholdFlag}": must be greater than 0.`);
  }
  return n;
}

/**
 * Merge config thresholds (+ optional validated --threshold override) over the
 * defaults. `thresholdOverride`, when provided, is an already-validated positive
 * integer (see `parseThresholdFlag`) and overrides cyclomatic + cognitive.
 */
export function resolveDeltaThresholds(
  configThresholds: Partial<ComplexityDeltaThresholds> | undefined,
  thresholdOverride: number | undefined,
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
  if (thresholdOverride !== undefined) {
    overrides.testPaths = thresholdOverride;
    overrides.mentalLoad = thresholdOverride;
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

// Exported for unit testing (Phase-2 review finding: non-finite guard).
export function fmtValue(
  v: number | null,
  metricType: MetricComplexityDelta['metricType'],
): string {
  if (v === null) return '–';
  // Malformed metrics (NaN/Infinity) must not leak "NaNm"/"Infinitym" into the
  // report — render them as absent, same as null.
  if (!Number.isFinite(v)) return '–';
  if (metricType === 'halstead_bugs') return v.toFixed(2);
  // Floor (not round) effort-minutes: classification compares the RAW value to
  // the threshold, so a rounded display could show an at/over-limit number for a
  // value the classifier treats as under-limit (e.g. 59.7 → "60m" against a 60m
  // limit). Flooring guarantees the shown number is never larger than the real
  // one, so display can only ever understate, never falsely cross the limit.
  if (metricType === 'halstead_effort') return `${Math.floor(v)}m`;
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

  // Validate --file before doing any work: an empty value is a usage error
  // (exit 2), not a silent no-op — silence is reserved for genuinely
  // out-of-scope files (non-code, outside the repo), never malformed input.
  if (options.file !== undefined && options.file.trim() === '') {
    console.error(chalk.red('lien delta: --file requires a non-empty path.'));
    process.exit(2);
  }

  // Validate --threshold before doing any work, so a bad flag fails fast (exit 2).
  let thresholdOverride: number | undefined;
  try {
    thresholdOverride = parseThresholdFlag(options.threshold);
  } catch (error) {
    console.error(
      chalk.red(`lien delta: ${error instanceof Error ? error.message : String(error)}`),
    );
    process.exit(2);
  }

  const rootDir = await getRepoRoot(process.cwd());
  if (!rootDir) {
    console.error(chalk.red('lien delta: not a git repository (or git is not installed)'));
    process.exit(2);
  }

  let config;
  try {
    config = await configService.load(rootDir);
  } catch (error) {
    // A malformed .lien.config.json (or any config-load failure) is an
    // operational error, not a complexity regression — exit 2, don't crash.
    console.error(
      chalk.red(
        `lien delta: failed to load config: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    process.exit(2);
  }
  const thresholds = resolveDeltaThresholds(config.complexity?.thresholds, thresholdOverride);

  let changes;
  try {
    if (options.file !== undefined) {
      // Single-file fast path (the edit hook). An out-of-repo / unsupported /
      // absent file yields no change → empty result → clean exit 0.
      const single = await collectFileChange(rootDir, options.file);
      changes = single ? [single] : [];
    } else {
      changes = await collectFileChanges(rootDir);
    }
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
