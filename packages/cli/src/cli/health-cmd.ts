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
 * source. This repo used to demonstrate it perfectly: `lien-review-testbed/`
 * was deliberately complex, deliberately untested tracked code, and it
 * legitimately occupied four of the default five slots. That fixture app has
 * since been deleted (the whole-repo ranked total fell from 57 functions to
 * 12, and the analysed corpus from 592 files to 396), so the example is gone but the limitation is not — any repo carrying a
 * fixture app will see the same thing. The ranking is not wrong in that case;
 * "code I maintain" is a per-repo judgment the tool cannot infer. Scope it
 * with `--path` until an exclude
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
import {
  describeScanFailure,
  describePartialScan,
  describeUnanalyzableScan,
} from '../utils/scan-failure.js';
import { resolveRepoRoot, rebaseToRoot } from './project-root.js';
import { assertSafeRoot } from './unsafe-root.js';
import type { CodeChunk, ComplexityReport, ComplexityViolation } from '@liendev/parser';

export interface HealthOptions {
  format: string;
  top: string;
  path?: string;
  includeTests?: boolean;
  /** Proceed even when the analysis root is `$HOME` or a filesystem root. */
  allowUnsafeRoot?: boolean;
}

/** What to do about a risky function, derived from the three axes. */
export type RiskShape = 'dangerous' | 'expensive' | 'cheap-win' | 'unknown-fan-in' | 'isolated';

export interface RiskEntry {
  filepath: string;
  startLine: number;
  symbolName: string;
  language: string;
  cognitive: number;
  /**
   * Fan-in, or `null` when no fan-in was found for this entry's language
   * anywhere in this repo.
   *
   * `null` is not the same as `0` and must not be collapsed into it (#1137).
   * `0` says "nothing imports this"; `null` says "this run resolved no fan-in
   * for this language at all, so the blast radius is unmeasured." Rendering
   * the second as the first is what let a Swift type used by every file in its
   * module print as `imported by 0 · little depends on it`.
   *
   * Per-language, not per-run, because that is the granularity
   * `computeCoverage` already reports — and a repo can mix a language with
   * resolved fan-in and one without.
   */
  dependents: number | null;
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
  /**
   * Why this run has no CODE to answer from, when the scan itself succeeded.
   *
   * The sibling of `scanError` and invisible to it: a markdown-only or
   * unsupported-language repo parses fine and yields chunks, so
   * `describeScanFailure` passes and the ranking is empty for a reason that
   * has nothing to do with the codebase being healthy. Left unset, `health`
   * printed a green "Nothing ranked as risky to change." for a repo
   * containing one README (#1148).
   */
  unanalyzable?: string;
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
 *
 * `unknown-fan-in` sits above `cheap-win` and `isolated` deliberately: those
 * two are judgements that the blast radius is small or manageable, and an
 * entry whose fan-in was never resolved has not earned either. It stays below
 * `dangerous`/`expensive` because a measured wide blast radius outranks an
 * unmeasured one. This placement is what delivers `computeCoverage`'s stated
 * guarantee — "a language with no resolved fan-in is never silently ranked as
 * safe" — which sorting it as `isolated` broke (#1137).
 */
const SHAPE_PRIORITY: Record<RiskShape, number> = {
  dangerous: 0,
  expensive: 1,
  'unknown-fan-in': 2,
  'cheap-win': 3,
  isolated: 4,
};

/**
 * Risk score. Deliberately explainable rather than tuned: the three raw
 * numbers are printed alongside it so a reader can disagree with the
 * weighting without reverse-engineering it.
 *
 * Fan-in is log-damped so one mega-imported utility cannot crowd out
 * everything else, and offset by 1 so that a complex, untested function with
 * zero dependents still scores above zero.
 *
 * Unresolved fan-in (`null`) contributes the same damping as `0`, which is
 * safe ONLY because shape sorts ahead of score: every `unknown-fan-in` entry
 * carries the same constant fan-in term, so within that group the score
 * reduces to complexity × tests. It is never compared against a resolved
 * entry's score, because a different shape decides the order first. Do not
 * reuse this score to compare across shapes.
 *
 * Note it reduces to complexity × *tests*, not complexity alone: an untested
 * entry still scores 2× a tested one of equal complexity. That is deliberate
 * — fan-in is the only unmeasured axis, and discarding the two that ARE
 * measured would rank worse, not more honestly. The coverage footer says
 * "complexity and tests only" for exactly this reason; it must not claim
 * complexity alone.
 */
export function scoreRisk(cognitive: number, dependents: number | null, hasTests: boolean): number {
  return cognitive * (1 + Math.log2(1 + (dependents ?? 0))) * (hasTests ? 1 : 2);
}

/** Which of the five actionable shapes this function falls into. */
export function classifyShape(
  cognitive: number,
  dependents: number | null,
  hasTests: boolean,
): RiskShape {
  // Unresolved fan-in must be decided BEFORE the widelyUsed comparison. The
  // bug this guards (#1137) was that `null`/absent fan-in arrived here as `0`,
  // made `widelyUsed` false, and fell through to `isolated` — which then
  // rendered "little depends on it" about code whose callers were simply never
  // resolved. Two of the three axes are unknown for such an entry, so no
  // judgement about blast radius is available to make.
  if (dependents === null) return 'unknown-fan-in';

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
    case 'unknown-fan-in':
      // Observational, per `computeCoverage`'s rule: this says what this run
      // found, not that the language is unresolvable. A language whose files
      // genuinely never reference each other reaches here too, and the wording
      // must not tell the reader it knows which case this is.
      return 'No fan-in found for this language here — blast radius unmeasured.';
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
    case 'unknown-fan-in':
      return 'find the callers yourself before changing it';
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
 * Fan-in for one violating file, or `null` when it is unmeasured.
 *
 * The distinction is the whole of #1137. `dependentCounts` has no entry for a
 * file whose language resolved nothing AND no entry for a file that genuinely
 * has no importers, so `dependentCounts.get(file) ?? 0` cannot tell them
 * apart — and answering `0` for the first turns "we did not look" into "we
 * looked and found nothing." Only the language's coverage row knows which
 * case this is, so it decides first.
 */
export function resolveFanIn(
  filepath: string,
  language: string,
  dependentCounts: Map<string, number>,
  unresolvedLanguages: ReadonlySet<string>,
): number | null {
  if (unresolvedLanguages.has(language)) return null;
  return dependentCounts.get(filepath) ?? 0;
}

/**
 * Collapse the report's per-metric violations into one entry per function.
 *
 * A single function yields up to three violations (cyclomatic, cognitive,
 * halstead). Ranking wants one row per function, and the authoritative
 * cognitive number comes from the chunk itself rather than whichever metric
 * happened to trip a threshold.
 *
 * `unresolvedLanguages` comes from `unresolvedFanInLanguages(computeCoverage(...))`
 * and is required rather than defaulted: defaulting it to "everything
 * resolved" would reinstate #1137 silently at any call site that forgot it.
 * Pass an empty set when every language resolved something.
 */
export function buildEntries(
  report: ComplexityReport,
  chunks: CodeChunk[],
  dependentCounts: Map<string, number>,
  testsByFile: Map<string, string[]>,
  unresolvedLanguages: ReadonlySet<string>,
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
      const dependents = resolveFanIn(
        filepath,
        violation.language,
        dependentCounts,
        unresolvedLanguages,
      );
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

/**
 * Languages the coverage footer reports no resolved fan-in for.
 *
 * Derived from `computeCoverage`'s rows rather than recomputed, so the
 * ranking and the footer can never disagree about which languages were
 * resolved — the disagreement being exactly what #1137 was.
 */
export function unresolvedFanInLanguages(coverage: CoverageRow[]): Set<string> {
  return new Set(coverage.filter(row => !row.resolved).map(row => row.language));
}

function renderEntry(entry: RiskEntry, rank: number): string[] {
  const location = chalk.bold(`${entry.filepath}:${entry.startLine}`);
  const tests =
    entry.tests.length > 0 ? plural(entry.tests.length, 'test') : chalk.yellow('no tests');
  // Never print "imported by 0" for an unmeasured entry -- that states a fact
  // the run does not have (#1137).
  const fanIn =
    entry.dependents === null ? 'fan-in not resolved' : `imported by ${entry.dependents}`;
  const facts = `mental load ${entry.cognitive} · ${fanIn} · ${tests}`;

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
    // "complexity and tests only", not "complexity alone": `scoreRisk` still
    // applies the untested 2x multiplier to these entries, so tests do affect
    // their order. The older wording understated what the ranking used.
    lines.push(
      chalk.dim('                      ranked on complexity and tests only — not judged safe'),
    );
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

  // Advisory command, so this reports at exit 0 rather than erroring the way
  // gate-shaped `complexity` does -- but it must not be GREEN. An empty
  // ranking because nothing was code is not a clean bill of health (#1148).
  if (result.unanalyzable) {
    return [
      chalk.red(`  ⚠ No code found to rank — ${result.unanalyzable}`),
      chalk.yellow('    This is NOT a clean bill of health. Nothing was analyzed.'),
    ];
  }

  return [chalk.green('  Nothing ranked as risky to change.')];
}

/**
 * True when the displayed order is not descending by score.
 *
 * The ranking is shape-major on purpose: "expensive to change" is a different
 * question from "complex", and #1138 put `unknown-fan-in` above `cheap-win`
 * and `isolated` so unmeasured blast radius cannot read as safety. The cost is
 * that score order and display order can disagree, with nothing saying so --
 * on go-chi/chi, `findRoute` scores 306 and displays THIRD, under entries
 * scoring 91.4 and 80, carrying the softest advice tier (#1151).
 *
 * Computed over the shown entries rather than stated unconditionally: when the
 * two orders agree, which is the common case, the note would be noise, and a
 * caveat that fires every run gets trained out (#1014).
 */
export function displayOrderDivergesFromScore(shown: RiskEntry[]): boolean {
  return shown.some((entry, i) => shown.slice(0, i).some(above => entry.score > above.score));
}

export function renderText(result: HealthResult, shown: RiskEntry[], pathFilter?: string): string {
  const lines: string[] = ['', chalk.bold('lien health'), ''];

  const scanned = `${plural(result.filesAnalyzed, 'file')} · ${plural(result.chunks, 'chunk')} · ${(result.durationMs / 1000).toFixed(1)}s`;
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
    if (displayOrderDivergesFromScore(shown)) {
      lines.push(
        chalk.dim('  Ordered by how expensive a change is, then by risk within that — so'),
        chalk.dim('  something further down this list may still be the riskiest thing here.'),
        '',
      );
    }
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
  const scanError = describeScanFailure({
    success: scan.success,
    error: scan.error,
    chunkCount: chunks.length,
    filesSkipped: scan.filesSkipped,
  });

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
  // Computed before the entries so both the ranking and the footer read the
  // same per-language resolution (#1137).
  const coverage = computeCoverage(chunks, dependentCounts);

  // Shared detection, local phrasing: `describePartialScan` owns the question
  // ("did most of the corpus fail?") so a third copy cannot drift from it,
  // while the sentence still names THIS command's output. #1149 found the
  // wording had already diverged three ways.
  const partial = describePartialScan({
    success: scan.success,
    chunkCount: chunks.length,
    filesErrored: scan.filesErrored,
  });
  if (partial) {
    console.warn(chalk.yellow(`Warning: ${partial} — they are absent from this ranking.`));
  }
  // #1149: health passed `filesSkipped` to `describeScanFailure` for the
  // total case but never caveated the partial one, so a run where the size cap
  // excluded much of the corpus ranked the remainder in silence.
  if (scan.filesSkipped > 0) {
    console.warn(
      chalk.dim(
        `  ${scan.filesSkipped} file${scan.filesSkipped === 1 ? '' : 's'} skipped for exceeding the size cap.`,
      ),
    );
  }

  return {
    filesAnalyzed: report.summary.filesAnalyzed,
    chunks: chunks.length,
    // Whole analysis, not `scan.durationMs` — that covers parsing only, so
    // reporting it understated what the user actually waited for.
    durationMs: Date.now() - startedAt,
    totalViolations: report.summary.totalViolations,
    entries: buildEntries(
      report,
      chunks,
      dependentCounts,
      testsByFile,
      unresolvedFanInLanguages(coverage),
      includeTests,
    ),
    coverage,
    scanError,
    unanalyzable: describeUnanalyzableScan({
      filesAnalyzed: report.summary.filesAnalyzed,
      declarationsAnalyzed: report.summary.declarationsAnalyzed,
    }),
  };
}

export async function healthCommand(options: HealthOptions): Promise<void> {
  // Same reasoning as `lien complexity`: a raw cwd silently ranks a subtree
  // with understated fan-in. `--path` is the way to narrow the OUTPUT; the
  // corpus must stay whole. See `resolveRepoRoot`.
  const cwd = process.cwd();
  const rootDir = resolveRepoRoot(cwd);
  if (rootDir !== cwd) {
    console.warn(chalk.dim(`Analyzing the repository root: ${rootDir}`));
  }

  // #1025's hazard outlived the command that motivated it. The guard used to
  // sit on `lien index`, which is deleted; `lien health` inherited the shape —
  // it walks from `resolveRepoRoot`, which falls back to the start directory
  // when there is no `.git` above it, so a run in `$HOME` parses the whole home
  // directory. That is now MORE reachable, not less: `lien health` is what the
  // quick-start banner tells a new user to run.
  assertSafeRoot(rootDir, options.allowUnsafeRoot);

  try {
    validateFormat(options.format);
    const top = parseTop(options.top);

    const result = await analyzeHealth(rootDir, options.includeTests ?? false);

    // Same re-basing as `lien complexity --files`: `--path` is relative to
    // the invocation directory, entries are relative to the analysis root.
    const pathFilter = options.path ? rebaseToRoot(options.path, cwd, rootDir) : undefined;
    const scoped = pathFilter
      ? result.entries.filter(entry => entry.filepath.startsWith(pathFilter))
      : result.entries;
    const shown = scoped.slice(0, top);

    if (options.format === 'json') {
      console.log(JSON.stringify(toJson(result, scoped, shown, pathFilter), null, 2));
      return;
    }

    console.log(renderText(result, shown, pathFilter));
  } catch (error) {
    console.error(chalk.red('Error analyzing health:'), error);
    process.exit(1);
  }
}
