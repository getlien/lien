/**
 * `lien review` — run the deterministic signals over a diff and print what they
 * found.
 *
 * Answers structural questions about a change without an LLM, a network call,
 * or a persisted index: "this literal changed here, does the old value still
 * appear elsewhere?", "this variant was added, did every consumer get the new
 * case?", "does an untouched doc still name what this removed?". It reads the
 * working tree and a git diff, so nothing can be stale.
 *
 * **It has no `--fail-on`, deliberately.** The signals emit candidates for
 * adjudication, not findings, and their precision is unmeasured. A gate that
 * over-fires gets trained out as noise, which is what #1014 already cost this
 * project — so this command is advisory and exits 0 whatever it finds. A bad
 * flag or an unusable repo still exits non-zero, as any CLI should.
 *
 * It also says what it could NOT look at: untracked files (which have no diff),
 * languages a signal does not support, and signals that needed the repo-wide
 * corpus when it was skipped. An empty report from a clean diff and an empty
 * report from a diff nothing could read are the same shape unless the command
 * distinguishes them.
 */

import {
  analyzeComplexityFromChunks,
  findTestAssociationsFromChunks,
  isTestFile,
  parseUnifiedDiff,
  performChunkOnlyIndex,
  filterAnalyzableFiles,
  type CodeChunk,
  type ComplexityReport,
  type ParsedUnifiedDiff,
  type SignalContext,
} from '@liendev/parser';

import { listUntrackedAnalyzable, readUnifiedDiff } from './delta-git.js';
import { resolveRepoRoot } from './project-root.js';
import { runSignals, type SignalReport } from './review-signals.js';

export interface ReviewOptions {
  base?: string;
  format?: string;
  /**
   * Whether to gather the whole-repo corpus the cross-file signals need.
   *
   * Named for the POSITIVE, because that is what commander gives us: a
   * `--no-repo-scan` flag sets `repoScan: false` and leaves it undefined when
   * absent — it does NOT set `noRepoScan: true`. Reading the negative name is
   * how the flag silently did nothing.
   */
  repoScan?: boolean;
  /** Review test files too. Excluded by default — see `buildContext`. */
  includeTests?: boolean;
}

/** Files this diff touched that a signal could not have examined. */
interface Unexamined {
  untracked: string[];
  nonAnalyzable: string[];
  testsExcluded: number;
}

const TS_JS_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/** What the report is about, kept together so the renderer needs no globals. */
export interface ReviewResult {
  base: string;
  reports: SignalReport[];
  changedFiles: string[];
  unexamined: Unexamined;
  repoScanned: boolean;
  durationMs: number;
}

/**
 * Fill in `testAssociations` on the complexity report from the repo-wide
 * corpus.
 *
 * Without this the report carries an empty association array for every file,
 * and the test-coverage signal — which reads exactly that field — reports EVERY
 * changed file as untested. Measured on a 160-file diff of this repo before the
 * fix: 160 of 160 flagged, in a repo with ~6,000 tests. The signal's own
 * docstring warns that an empty array cannot distinguish "genuinely no test"
 * from "enrichment never ran"; supplying the data is what makes the difference,
 * and when there is no corpus to supply it from the signal is marked
 * constrained rather than left to invent gaps.
 */
function attachTestAssociations(
  report: ComplexityReport,
  changedFiles: string[],
  rootDir: string,
  repoChunks: CodeChunk[] | undefined,
): void {
  if (repoChunks === undefined) return;

  const associations = findTestAssociationsFromChunks(changedFiles, repoChunks, rootDir);
  for (const file of changedFiles) {
    const entry = report.files[file];
    if (entry !== undefined) entry.testAssociations = associations.get(file) ?? [];
  }
}

/**
 * Split the diff's file list into what gets reviewed and what does not.
 *
 * Test files are excluded by default, matching `lien health`. Two signals are
 * actively wrong on them, and it is not a tuning question: test-coverage asks
 * "does this file have a test?", which is meaningless of a test file itself (it
 * was reporting `complexity.test.ts` as untested), and untrusted-input flags
 * every `JSON.parse` in an assertion.
 *
 * Measured on a 160-file diff of this repo (86 source files, 74 tests):
 * untrusted-input 45 → 4, test-coverage 77 → 3, total candidates 200 → 83.
 */
function partitionChangedFiles(
  allChangedFiles: string[],
  includeTests: boolean,
): { changedFiles: string[]; nonAnalyzable: string[]; testsExcluded: number } {
  const analyzable = filterAnalyzableFiles(allChangedFiles);
  const analyzableSet = new Set(analyzable);
  const changedFiles = includeTests ? analyzable : analyzable.filter(f => !isTestFile(f));

  return {
    changedFiles,
    nonAnalyzable: allChangedFiles.filter(f => !analyzableSet.has(f)),
    testsExcluded: analyzable.length - changedFiles.length,
  };
}

/**
 * Narrow the patch map to the files actually under review.
 *
 * The file list alone is not enough: doc-claims, guidance-surface and
 * untrusted-input read `patches` directly, so an excluded file left in the map
 * is still examined by them.
 */
function scopeDiff(
  parsed: ParsedUnifiedDiff,
  changedFiles: string[],
  nonAnalyzable: string[],
): ParsedUnifiedDiff {
  const keep = new Set([...changedFiles, ...nonAnalyzable]);
  const patches = new Map([...parsed.patches].filter(([file]) => keep.has(file)));

  return {
    patches,
    diffLines: new Map([...parsed.diffLines].filter(([file]) => patches.has(file))),
  };
}

/**
 * Build the signal input from a diff plus a parse of the changed files.
 *
 * `repoChunks` is what lets the cross-file signals see past the diff — a
 * survivor of a rename, a sibling that did not get the change, a doc that still
 * names a deleted symbol. Without it those signals return nothing, which is why
 * skipping the scan is reported rather than silent.
 */
async function buildContext(
  rootDir: string,
  diff: string,
  repoScan: boolean,
  includeTests: boolean,
): Promise<{
  context: SignalContext;
  changedFiles: string[];
  nonAnalyzable: string[];
  testsExcluded: number;
}> {
  const parsed = parseUnifiedDiff(diff);
  const { changedFiles, nonAnalyzable, testsExcluded } = partitionChangedFiles(
    [...parsed.patches.keys()],
    includeTests,
  );
  const { patches: scopedPatches, diffLines: scopedDiffLines } = scopeDiff(
    parsed,
    changedFiles,
    nonAnalyzable,
  );

  const scan =
    changedFiles.length > 0
      ? await performChunkOnlyIndex(rootDir, { filesToIndex: changedFiles })
      : undefined;
  const chunks: CodeChunk[] = scan?.chunks ?? [];

  let repoChunks: CodeChunk[] | undefined;
  if (repoScan) {
    const repo = await performChunkOnlyIndex(rootDir);
    repoChunks = repo.chunks ?? undefined;
  }

  const complexityReport = analyzeComplexityFromChunks(chunks, changedFiles, undefined, {
    enrich: false,
  });
  attachTestAssociations(complexityReport, changedFiles, rootDir, repoChunks);

  return {
    context: {
      chunks,
      changedFiles,
      allChangedFiles: [...scopedPatches.keys()],
      complexityReport,
      repoChunks,
      pr: { patches: scopedPatches, diffLines: scopedDiffLines },
    },
    changedFiles,
    nonAnalyzable,
    testsExcluded,
  };
}

/** Run the signals over the working tree's diff against `base`. */
export async function analyzeReview(options: ReviewOptions): Promise<ReviewResult> {
  const started = Date.now();
  const rootDir = resolveRepoRoot();
  const base = options.base ?? 'HEAD';
  const repoScanned = options.repoScan !== false;

  const diff = await readUnifiedDiff(rootDir, base);
  const { context, changedFiles, nonAnalyzable, testsExcluded } = await buildContext(
    rootDir,
    diff,
    repoScanned,
    options.includeTests === true,
  );

  const hasNonTsJs = changedFiles.some(f => !TS_JS_RE.test(f));
  const reports = runSignals(context, changedFiles, { repoScanned, hasNonTsJs });

  return {
    base,
    reports,
    changedFiles,
    unexamined: { untracked: await listUntrackedAnalyzable(rootDir), nonAnalyzable, testsExcluded },
    repoScanned,
    durationMs: Date.now() - started,
  };
}

function renderNothingChanged(base: string): string {
  return [
    `No changes against ${base}.`,
    '',
    'Nothing was analyzed — this is not a clean review, it is an empty one.',
    'Make a change, or pass --base <ref> to compare against something else.',
  ].join('\n');
}

/**
 * The diff was NOT empty, but everything in it was excluded from review.
 *
 * Distinct from `renderNothingChanged` on purpose. Saying "no changes against
 * HEAD" to someone who just changed four test files is simply false, and it
 * tells them to make a change they already made — which is worse than an empty
 * report, because it sends them looking for the wrong problem.
 */
function renderNothingReviewable(result: ReviewResult): string {
  const { nonAnalyzable, testsExcluded } = result.unexamined;
  const reasons: string[] = [];

  if (testsExcluded > 0) {
    reasons.push(
      `  ${testsExcluded} changed test file(s) — excluded by default; pass --include-tests to review them`,
    );
  }
  if (nonAnalyzable.length > 0) {
    reasons.push(
      `  ${nonAnalyzable.length} changed file(s) the parser cannot analyze ` +
        '(unsupported extension, vendored, generated, or build output)',
    );
  }

  return [
    `Changes against ${result.base}, but nothing reviewable in them.`,
    '',
    'Nothing was analyzed — this is not a clean review, it is an empty one. What changed:',
    ...reasons,
    '',
    'No signal ran, so no signal found anything.',
  ].join('\n');
}

/** The caveats block: what this run could not see. Never omitted when non-empty. */
function renderCaveats(result: ReviewResult): string[] {
  const lines: string[] = [];

  if (result.unexamined.untracked.length > 0) {
    lines.push(
      `  ${result.unexamined.untracked.length} untracked file(s) were NOT reviewed — ` +
        'an untracked file has no diff. Add them to see them here.',
    );
  }
  if (result.unexamined.nonAnalyzable.length > 0) {
    lines.push(
      `  ${result.unexamined.nonAnalyzable.length} changed file(s) are not parser-analyzable ` +
        '(unsupported extension, vendored, generated, or build output).',
    );
  }
  if (result.unexamined.testsExcluded > 0) {
    lines.push(
      `  ${result.unexamined.testsExcluded} changed test file(s) were excluded — ` +
        'pass --include-tests to review them too.',
    );
  }
  if (!result.repoScanned) {
    lines.push(
      '  --no-repo-scan was set, so the cross-file signals saw only the diff. ' +
        'Anything outside it — a surviving old name, an unchanged sibling — was invisible.',
    );
  }

  return lines;
}

/**
 * How many candidates this block is showing — a count, a count-plus-remainder,
 * or an explicit ceiling.
 *
 * A bare "(8)" reads as "it found 8". For a signal that truncates inside its own
 * compute function, it means "it returned 8, having found some number it did not
 * tell us" — measured at 8 of 1,241 on one real diff. Showing a ceiling as a
 * total is the same failure as showing an empty result as a clean one.
 */
function renderCount(report: SignalReport): string {
  const shown = report.candidates.length;
  if (report.omitted !== undefined && report.omitted > 0) {
    return `${shown} shown, ${report.omitted} more not listed`;
  }
  if (report.capped === true)
    return `${shown} shown — this signal caps its own list, so there may be more`;
  return String(shown);
}

/** One signal's block: heading, its question, its candidates, its constraint. */
function renderSignalBlock(report: SignalReport): string[] {
  const lines = [`${report.title}  (${renderCount(report)})`, `  ${report.question}`];

  for (const c of report.candidates) {
    lines.push(`    ${c.line === undefined ? c.file : `${c.file}:${c.line}`}`);
    lines.push(`      ${c.detail}`);
  }
  if (report.limitation !== undefined) lines.push(`  Note: ${report.limitation}`);
  lines.push('');

  return lines;
}

/**
 * Signals that found nothing but were constrained while looking.
 *
 * Reported separately and unconditionally, because "asked and found nothing"
 * and "could not ask" are the same empty block otherwise.
 */
function renderConstrained(reports: SignalReport[]): string[] {
  const constrained = reports.filter(r => r.candidates.length === 0 && r.limitation !== undefined);
  if (constrained.length === 0) return [];

  return [
    'Signals that ran constrained:',
    ...constrained.map(r => `  ${r.title} — ${r.limitation}`),
    '',
  ];
}

export function renderText(result: ReviewResult): string {
  // Three distinct empty states, and conflating any two of them is a lie:
  // the diff was empty; the diff had files but none reviewable; the diff was
  // reviewed and nothing turned up.
  const inDiff =
    result.changedFiles.length +
    result.unexamined.nonAnalyzable.length +
    result.unexamined.testsExcluded;

  if (inDiff === 0) return renderNothingChanged(result.base);
  if (result.changedFiles.length === 0) return renderNothingReviewable(result);

  const withCandidates = result.reports.filter(r => r.candidates.length > 0);
  const total = withCandidates.reduce((n, r) => n + r.candidates.length, 0);
  const caveats = renderCaveats(result);

  const out: string[] = [
    `lien review — ${result.changedFiles.length} changed file(s) vs ${result.base}`,
    '',
    ...withCandidates.flatMap(renderSignalBlock),
    ...(total === 0 ? ['No candidates from any signal.', ''] : []),
    ...renderConstrained(result.reports),
    ...(caveats.length > 0 ? ['Not examined:', ...caveats, ''] : []),
  ];

  out.push(
    `${total} candidate(s) across ${withCandidates.length} signal(s) · ${result.durationMs} ms`,
  );
  out.push(
    'These are candidates for you to judge, not findings. This command never fails a build.',
  );

  return out.join('\n');
}

export function toJson(result: ReviewResult): string {
  return JSON.stringify(
    {
      base: result.base,
      changedFiles: result.changedFiles,
      repoScanned: result.repoScanned,
      unexamined: result.unexamined,
      durationMs: result.durationMs,
      signals: result.reports.map(r => ({
        id: r.id,
        title: r.title,
        question: r.question,
        limitation: r.limitation ?? null,
        omitted: r.omitted ?? 0,
        capped: r.capped === true,
        candidates: r.candidates,
      })),
    },
    null,
    2,
  );
}

export async function reviewCommand(options: ReviewOptions): Promise<void> {
  const format = options.format ?? 'text';
  if (format !== 'text' && format !== 'json') {
    console.error(`Unknown format '${format}'. Use text or json.`);
    process.exitCode = 1;
    return;
  }

  let result: ReviewResult;
  try {
    result = await analyzeReview(options);
  } catch (error) {
    // An unresolvable base ref or an unreadable repo is an operational failure,
    // not a finding — that exits non-zero. What the signals report never does.
    console.error(`lien review could not run: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
    return;
  }

  console.log(format === 'json' ? toJson(result) : renderText(result));
}
