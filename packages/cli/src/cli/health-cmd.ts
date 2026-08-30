/**
 * `lien health` — rank the functions that are risky to change.
 *
 * Answers "where do I look first?", where `lien complexity` answers "what
 * violates a threshold?". The difference is the join: complexity alone is a
 * wall of violations ordered by how far over a line they sit, which says
 * nothing about whether anything depends on the code or whether a test would
 * catch you breaking it. Health ranks by three axes Lien is uniquely able to
 * combine, and prints five.
 *
 *   Likelihood   how easily could I break this?   cognitive complexity
 *   Impact       how much breaks if I do?         fan-in (dependent count)
 *   Detectability would I find out?               test associations
 *
 * Advisory by construction: it never exits non-zero because of what it FOUND.
 * `lien complexity --fail-on` and `lien delta` are the gates; a ranking whose
 * precision has never been measured must not fail anyone's build (see #1014
 * for what over-firing costs). Usage errors — an unknown `--format`, a
 * non-numeric `--top` — still exit 1, as they should: that reports a bad
 * invocation, not a bad codebase. The distinction is the point, so don't
 * restate this as "always exits 0".
 *
 * Reads the working tree directly via `performChunkOnlyIndex` — no persisted
 * index, so nothing can be stale. That removes staleness, not the obligation
 * to say when there is no data: see `describeScanFailure`.
 *
 * KNOWN LIMITATION — fixture applications. Test files are excluded via
 * `isTestFile`, which covers the conventions (`*.test.*`, `test/`, `spec/`,
 * `__tests__/`). It does not cover a fixture APP checked in as ordinary
 * source: in this repo, `lien-review-testbed/` is deliberately complex,
 * deliberately untested tracked code, and it legitimately occupies four of
 * the default five slots. The ranking is not wrong — that really is the
 * riskiest code here by these axes — but "code I maintain" is a per-repo
 * judgment the tool cannot infer. Scope it with `--path` until an exclude
 * mechanism exists (`LienConfig` has no ignore key today, only
 * `complexity.thresholds`).
 */

import chalk from 'chalk';
import {
  performChunkOnlyIndex,
  analyzeComplexityFromChunks,
  computeDependentCountsFromChunks,
  findTestAssociationsFromChunks,
  isTestFile,
  DEFAULT_COMPLEXITY_THRESHOLDS,
} from '@liendev/parser';
import type { CodeChunk, ComplexityReport, ComplexityViolation } from '@liendev/parser';

export interface HealthOptions {
  format: string;
  top: string;
  path?: string;
  includeTests?: boolean;
}

/** What to do about a risky function, derived from the three axes. */
export type RiskShape = 'dangerous' | 'expensive' | 'cheap-win' | 'isolated';

export interface RiskEntry {
  filepath: string;
  startLine: number;
  symbolName: string;
  language: string;
  cognitive: number;
  dependents: number;
  tests: string[];
  score: number;
  shape: RiskShape;
}

/** Per-language fan-in outcome, for the honesty footer. */
export interface CoverageRow {
  language: string;
  files: number;
  resolved: boolean;
}

export interface HealthResult {
  filesAnalyzed: number;
  chunks: number;
  durationMs: number;
  totalViolations: number;
  entries: RiskEntry[];
  coverage: CoverageRow[];
  /**
   * Why this run has no data to answer from, when it doesn't.
   *
   * Deleting the persisted index removes staleness, not the honesty rule that
   * grew up around it: a scan that failed outright and a genuinely clean
   * repository produce the same empty result, and "0 risky functions" is a
   * lie in the first case. `performChunkOnlyIndex` reports parse failure by
   * returning `{ success: false, error }` rather than throwing — including
   * for `NativeBindingLoadError`, which the chunker re-throws specifically so
   * the run fails loudly — so this must be read, never assumed.
   */
  scanError?: string;
}

const VALID_FORMATS = ['text', 'json'];

/**
 * Cognitive complexity at or above which a function counts as hard to reason
 * about. Shares `DEFAULT_COMPLEXITY_THRESHOLDS.mentalLoad` rather than
 * restating 15 — #988 consolidated that number precisely so a second copy
 * could not drift from the one the gates enforce.
 */
const COGNITIVE_HIGH = DEFAULT_COMPLEXITY_THRESHOLDS.mentalLoad;

/** Dependent count at or above which a function counts as widely depended on. */
const FANIN_HIGH = 5;

/**
 * Shapes rank ahead of raw score.
 *
 * Score alone inverts the advice: a self-contained function with a cognitive
 * complexity of 76 outscores a moderately complex one that fifteen files
 * depend on and nothing tests, even though the shape table calls the former
 * low priority. Sorting by shape first keeps "what should I do about this?"
 * and "where does it appear in the list?" telling the same story.
 */
const SHAPE_PRIORITY: Record<RiskShape, number> = {
  dangerous: 0,
  expensive: 1,
  'cheap-win': 2,
  isolated: 3,
};

/**
 * Risk score. Deliberately explainable rather than tuned: the three raw
 * numbers are printed alongside it so a reader can disagree with the
 * weighting without reverse-engineering it.
 *
 * Fan-in is log-damped so one mega-imported utility cannot crowd out
 * everything else, and offset by 1 so that a complex, untested function with
 * zero dependents still scores above zero.
 */
export function scoreRisk(cognitive: number, dependents: number, hasTests: boolean): number {
  return cognitive * (1 + Math.log2(1 + dependents)) * (hasTests ? 1 : 2);
}

/** Which of the four actionable shapes this function falls into. */
export function classifyShape(cognitive: number, dependents: number, hasTests: boolean): RiskShape {
  const complex = cognitive >= COGNITIVE_HIGH;
  const widelyUsed = dependents >= FANIN_HIGH;

  if (complex && widelyUsed) return hasTests ? 'expensive' : 'dangerous';
  if (!complex && widelyUsed && !hasTests) return 'cheap-win';
  return 'isolated';
}

/** "1 file", "2 files" — a report that says "1 files" reads as unmaintained. */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** One-line explanation of why an entry is on the list. */
export function describeShape(shape: RiskShape): string {
  switch (shape) {
    case 'dangerous':
      return 'Complex and widely depended on, and nothing would catch a regression.';
    case 'expensive':
      return 'Complex and widely depended on. Tested, but a change is expensive.';
    case 'cheap-win':
      return 'Widely depended on and untested, but simple enough to cover quickly.';
    case 'isolated':
      return 'Complex, but contained — little depends on it.';
  }
}

/** What to do about it. */
export function recommendFor(shape: RiskShape): string {
  switch (shape) {
    case 'dangerous':
      return 'add a test before touching it';
    case 'expensive':
      return 'split before extending';
    case 'cheap-win':
      return 'add a test — cheap, high value';
    case 'isolated':
      return 'simplify when you are next in here';
  }
}

/** Index chunk metadata by "file:startLine" so a violation can find its chunk. */
function indexChunksByPosition(chunks: CodeChunk[]): Map<string, CodeChunk> {
  const byPosition = new Map<string, CodeChunk>();
  chunks.forEach(chunk => {
    byPosition.set(`${chunk.metadata.file}:${chunk.metadata.startLine}`, chunk);
  });
  return byPosition;
}

/**
 * Cognitive complexity for a violating function.
 *
 * The chunk is authoritative. When it carries no cognitive value, the
 * violation's own number is only a usable stand-in if it is on a comparable
 * scale: cyclomatic is (single/low-double digits), Halstead is not — effort
 * runs to the thousands, so admitting one as "mental load" would let a single
 * Halstead violation outrank every genuinely dangerous function in the repo.
 *
 * Measured on this repo: 0 of 90 violations hit this fallback at all. It is
 * defensive, not load-bearing.
 */
export function cognitiveFor(chunk: CodeChunk | undefined, violation: ComplexityViolation): number {
  const measured = chunk?.metadata.cognitiveComplexity;
  if (measured !== undefined) return measured;

  const comparableScale =
    violation.metricType === 'cognitive' || violation.metricType === 'cyclomatic';
  return comparableScale ? violation.complexity : 0;
}

/**
 * Whether this run has data to answer from — and if not, why.
 *
 * Returns undefined only when the scan genuinely succeeded with content. A
 * parse failure and an empty scan both mean "no answer available", and
 * neither may be rendered as a clean bill of health.
 */
export function describeScanFailure(
  success: boolean,
  error: string | undefined,
  chunkCount: number,
): string | undefined {
  if (!success) return error ?? 'the scan failed for an unreported reason';
  if (chunkCount === 0) return 'the scan produced no parseable chunks';
  return undefined;
}

/**
 * Distinct files carrying at least one complexity violation.
 *
 * Scopes the test-association lookup: running it over the whole corpus is
 * wasted work, since only violating files can appear in the ranking.
 */
export function violatingFiles(report: ComplexityReport): string[] {
  return Object.entries(report.files)
    .filter(([, data]) => data.violations.length > 0)
    .map(([filepath]) => filepath);
}

/**
 * Collapse the report's per-metric violations into one entry per function.
 *
 * A single function yields up to three violations (cyclomatic, cognitive,
 * halstead). Ranking wants one row per function, and the authoritative
 * cognitive number comes from the chunk itself rather than whichever metric
 * happened to trip a threshold.
 */
export function buildEntries(
  report: ComplexityReport,
  chunks: CodeChunk[],
  dependentCounts: Map<string, number>,
  testsByFile: Map<string, string[]>,
  includeTests = false,
): RiskEntry[] {
  const byPosition = indexChunksByPosition(chunks);
  const seen = new Map<string, RiskEntry>();

  Object.entries(report.files).forEach(([filepath, data]) => {
    if (!includeTests && isTestFile(filepath)) return;
    data.violations.forEach(violation => {
      const key = `${filepath}:${violation.startLine}:${violation.symbolName}`;
      if (seen.has(key)) return;

      const chunk = byPosition.get(`${filepath}:${violation.startLine}`);
      const cognitive = cognitiveFor(chunk, violation);
      const dependents = dependentCounts.get(filepath) ?? 0;
      const tests = testsByFile.get(filepath) ?? [];
      const hasTests = tests.length > 0;

      seen.set(key, {
        filepath,
        startLine: violation.startLine,
        symbolName: violation.symbolName,
        language: violation.language,
        cognitive,
        dependents,
        tests,
        score: scoreRisk(cognitive, dependents, hasTests),
        shape: classifyShape(cognitive, dependents, hasTests),
      });
    });
  });

  return [...seen.values()].sort(
    (a, b) => SHAPE_PRIORITY[a.shape] - SHAPE_PRIORITY[b.shape] || b.score - a.score,
  );
}

/**
 * Per-language fan-in outcome.
 *
 * Reports what happened, never what is possible: "no fan-in found" is an
 * observation about this repo, not a claim that the language is
 * unresolvable. A language whose files genuinely do not reference each other
 * reads the same as one Lien cannot resolve, and the footer must not pretend
 * to tell them apart. What it does guarantee is that a language with no
 * resolved fan-in is never silently ranked as safe.
 */
export function computeCoverage(
  chunks: CodeChunk[],
  dependentCounts: Map<string, number>,
): CoverageRow[] {
  const filesByLanguage = new Map<string, Set<string>>();
  chunks.forEach(chunk => {
    const { language, file } = chunk.metadata;
    if (!filesByLanguage.has(language)) filesByLanguage.set(language, new Set());
    filesByLanguage.get(language)?.add(file);
  });

  return [...filesByLanguage.entries()]
    .map(([language, files]) => ({
      language,
      files: files.size,
      resolved: [...files].some(file => (dependentCounts.get(file) ?? 0) > 0),
    }))
    .sort((a, b) => b.files - a.files);
}

function renderEntry(entry: RiskEntry, rank: number): string[] {
  const location = chalk.bold(`${entry.filepath}:${entry.startLine}`);
  const tests =
    entry.tests.length > 0 ? plural(entry.tests.length, 'test') : chalk.yellow('no tests');
  const facts = `mental load ${entry.cognitive} · imported by ${entry.dependents} · ${tests}`;

  return [
    `  ${chalk.dim(String(rank))}  ${location}  ${chalk.bold(entry.symbolName)}`,
    `     ${chalk.dim(facts)}`,
    `     ${describeShape(entry.shape)}`,
    `     ${chalk.cyan('→')} ${recommendFor(entry.shape)}`,
    '',
  ];
}

function renderCoverage(coverage: CoverageRow[]): string[] {
  const resolved = coverage.filter(row => row.resolved).map(row => row.language);
  const unresolved = coverage.filter(row => !row.resolved);

  const lines = ['', chalk.bold('  Coverage')];
  lines.push(
    `    fan-in resolved   ${resolved.length > 0 ? resolved.join(', ') : chalk.dim('none')}`,
  );
  if (unresolved.length > 0) {
    const described = unresolved.map(row => `${row.language} (${row.files})`).join(', ');
    lines.push(`    no fan-in found   ${described}`);
    lines.push(chalk.dim('                      ranked on complexity alone — not judged safe'));
  }
  return lines;
}

/**
 * Explain an empty list.
 *
 * "Nothing ranked as risky" is true of four different situations, only one of
 * which is good news, and a reader who cannot tell them apart learns to
 * distrust the green line. (The failed-scan case is handled earlier and never
 * reaches here.)
 */
export function renderNothingShown(result: HealthResult, pathFilter?: string): string[] {
  if (pathFilter && result.entries.length > 0) {
    return [
      chalk.dim(`  No risky functions under "${pathFilter}".`),
      chalk.dim(
        `  ${plural(result.entries.length, 'risky function')} ranked elsewhere in the repo.`,
      ),
    ];
  }

  if (result.entries.length === 0 && result.totalViolations > 0) {
    return [
      chalk.dim(`  No risky functions outside test files.`),
      chalk.dim(
        `  ${plural(result.totalViolations, 'threshold violation')} — all in tests. Use --include-tests to rank them.`,
      ),
    ];
  }

  return [chalk.green('  Nothing ranked as risky to change.')];
}

export function renderText(result: HealthResult, shown: RiskEntry[], pathFilter?: string): string {
  const lines: string[] = ['', chalk.bold('lien health'), ''];

  const scanned = `${plural(result.filesAnalyzed, 'file')} · ${plural(result.chunks, 'chunk')} · ${(result.durationMs / 1000).toFixed(1)}s · no index`;
  lines.push(chalk.dim(`  ${scanned}`), '');

  if (result.scanError) {
    // Never a green line here: an empty result caused by a failed scan and a
    // genuinely clean repository are the same shape, and only one of them is
    // good news.
    lines.push(
      chalk.red(`  ⚠ No health data — ${result.scanError}`),
      chalk.yellow('    This is NOT a clean bill of health. Nothing was analyzed.'),
      '',
    );
    return lines.join('\n');
  }

  if (shown.length === 0) {
    lines.push(...renderNothingShown(result, pathFilter), '');
  } else {
    const noun = shown.length === 1 ? 'function is' : 'functions are';
    lines.push(chalk.yellow(`  ⚠ ${shown.length} ${noun} risky to change`), '');
    shown.forEach((entry, i) => lines.push(...renderEntry(entry, i + 1)));
  }

  const remaining = result.totalViolations - shown.length;
  if (remaining > 0) {
    lines.push(
      chalk.dim(
        `  ${plural(remaining, 'other threshold violation')} — \`lien complexity\` to see them`,
      ),
    );
  }

  lines.push(...renderCoverage(result.coverage), '');
  return lines.join('\n');
}

/**
 * JSON payload.
 *
 * `entries` is truncated by `--top` while `totalViolations` and `coverage`
 * describe the whole repo, so the counts are stated explicitly: without
 * `rankedTotal` a consumer cannot tell five-of-five from five-of-sixty-five,
 * and the skill that will read this needs to know whether it saw everything.
 *
 * `score` is rounded. The design deliberately never shows a score to a human,
 * and emitting `89.62406251802891` invites someone to treat sixteen digits of
 * float noise as meaningful precision.
 */
export function toJson(
  result: HealthResult,
  scoped: RiskEntry[],
  shown: RiskEntry[],
  pathFilter?: string,
): Record<string, unknown> {
  return {
    ...result,
    entries: shown.map(entry => ({ ...entry, score: Math.round(entry.score * 10) / 10 })),
    shown: shown.length,
    rankedTotal: result.entries.length,
    rankedUnderPath: pathFilter ? scoped.length : undefined,
    pathFilter,
  };
}

function validateFormat(format: string): void {
  if (!VALID_FORMATS.includes(format)) {
    console.error(
      chalk.red(`Error: Invalid --format value "${format}". Must be one of: text, json`),
    );
    process.exit(1);
  }
}

function parseTop(top: string): number {
  // `Number.parseInt` stops at the first non-digit, so "3abc" would silently
  // become 3. A flag the user got wrong should say so, not guess.
  if (!/^\d+$/.test(top.trim()) || Number.parseInt(top, 10) < 1) {
    console.error(chalk.red(`Error: Invalid --top value "${top}". Must be a positive integer`));
    process.exit(1);
  }
  return Number.parseInt(top, 10);
}

/**
 * Analyze the working tree and rank the functions that are risky to change.
 *
 * Fan-in is computed over the FULL chunk set (a project-wide property — see
 * `computeDependentCountsFromChunks`), so `--path` filters the OUTPUT rather
 * than the input. Filtering the input would silently understate every
 * dependent count.
 */
export async function analyzeHealth(rootDir: string, includeTests = false): Promise<HealthResult> {
  const startedAt = Date.now();
  const scan = await performChunkOnlyIndex(rootDir, {});
  const { chunks } = scan;
  const scanError = describeScanFailure(scan.success, scan.error, chunks.length);

  // `enrich: false` skips `enrichWithDependencies`, which is 609 of this
  // function's 653 ms on this repo and scales with VIOLATING FILE COUNT (one
  // whole-corpus dependency scan each), not repo size. Health sources fan-in
  // from `computeDependentCountsFromChunks` instead, so the enrichment would
  // be both the dominant cost and a discarded result.
  //
  // The two fan-in numbers deliberately disagree. Enrichment's comes from
  // `analyzeDependencies`, which follows barrel re-export chains
  // (`dependency-analyzer.ts:790-796`); for anything exported through
  // `packages/parser/src/index.ts` that approximates "everything", scoring
  // `insights/complexity-delta.ts` at 229 where four files import it directly
  // and 164 import the barrel at all. A number that large for every
  // re-exported file flattens the ranking into noise, which is the one thing
  // an impact axis must not do. `computeDependentCountsFromChunks` counts
  // direct import edges plus recovery tiers, is the number the index
  // canonically stored (#1071), and discriminates. `lien complexity` still
  // reports the transitive figure; they answer different questions.
  const report = analyzeComplexityFromChunks(chunks, undefined, undefined, { enrich: false });
  const dependentCounts = computeDependentCountsFromChunks(chunks, rootDir);
  const testsByFile = findTestAssociationsFromChunks(violatingFiles(report), chunks, rootDir);

  return {
    filesAnalyzed: report.summary.filesAnalyzed,
    chunks: chunks.length,
    // Whole analysis, not `scan.durationMs` — that covers parsing only, so
    // reporting it understated what the user actually waited for.
    durationMs: Date.now() - startedAt,
    totalViolations: report.summary.totalViolations,
    entries: buildEntries(report, chunks, dependentCounts, testsByFile, includeTests),
    coverage: computeCoverage(chunks, dependentCounts),
    scanError,
  };
}

export async function healthCommand(options: HealthOptions): Promise<void> {
  const rootDir = process.cwd();

  try {
    validateFormat(options.format);
    const top = parseTop(options.top);

    const result = await analyzeHealth(rootDir, options.includeTests ?? false);

    const scoped = options.path
      ? result.entries.filter(entry => entry.filepath.startsWith(options.path as string))
      : result.entries;
    const shown = scoped.slice(0, top);

    if (options.format === 'json') {
      console.log(JSON.stringify(toJson(result, scoped, shown, options.path), null, 2));
      return;
    }

    console.log(renderText(result, shown, options.path));
  } catch (error) {
    console.error(chalk.red('Error analyzing health:'), error);
    process.exit(1);
  }
}
