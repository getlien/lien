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
import { describeScanFailure } from '../utils/scan-failure.js';
import { runSignals, withheldSignalIds, type SignalReport } from './review-signals.js';

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
  /**
   * Run all fourteen signals instead of the measured default set.
   *
   * See `DEFAULT_SIGNAL_IDS` for why the other thirteen are off: they were built
   * as inputs an LLM adjudicated, and shown to a person their false-positive
   * rate makes the report unreadable rather than merely imprecise.
   */
  allSignals?: boolean;
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
  /** Signal ids that did not run because they are off by default. */
  withheldSignals: string[];
  /** Why the changed-file parse produced nothing usable, if it did. */
  scanFailure?: string;
  /** Why the repo-wide corpus was withheld, if it was. */
  repoScanFailure?: string;
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
 * Parse files into chunks, and say plainly whether that worked.
 *
 * `performChunkOnlyIndex` signals failure by RETURNING `{ success: false }`
 * rather than throwing — CLAUDE.md flags this as easy to miss — and on failure
 * `chunks` is `[]`, which is indistinguishable from "parsed fine, found
 * nothing" unless `success` is read. Reading it once, here, is what keeps both
 * call sites honest.
 */
async function runScan(
  rootDir: string,
  filesToIndex?: string[],
): Promise<{ chunks: CodeChunk[]; failure: string | undefined }> {
  const result =
    filesToIndex === undefined
      ? await performChunkOnlyIndex(rootDir)
      : await performChunkOnlyIndex(rootDir, { filesToIndex });

  return {
    chunks: result.chunks ?? [],
    failure: describeScanFailure({
      success: result.success,
      error: result.error,
      chunkCount: result.chunks?.length ?? 0,
      filesSkipped: result.filesSkipped,
    }),
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
  /** Set when the changed-file parse failed or yielded nothing parseable. */
  scanFailure?: string;
  /** Set when the repo-wide parse failed, so the corpus was withheld. */
  repoScanFailure?: string;
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

  // Both scans can fail, and they fail differently. A failed changed-file scan
  // silently removes every chunk-based candidate. A failed REPO scan is worse:
  // `[]` is not `undefined`, so `attachTestAssociations` would proceed against
  // an empty corpus and mark every changed file untested — the 160-of-160 bug
  // by a second route. So the corpus is withheld entirely on failure rather
  // than half-supplied: a signal reasoning about "everywhere else" from half a
  // repo reports absence it never established.
  const scan = changedFiles.length > 0 ? await runScan(rootDir, changedFiles) : undefined;
  const chunks = scan?.chunks ?? [];
  const scanFailure = scan?.failure;

  const repo = repoScan ? await runScan(rootDir) : undefined;
  const repoScanFailure = repo?.failure;
  const repoChunks = repo !== undefined && repo.failure === undefined ? repo.chunks : undefined;

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
    scanFailure,
    repoScanFailure,
  };
}

/** Run the signals over the working tree's diff against `base`. */
export async function analyzeReview(options: ReviewOptions): Promise<ReviewResult> {
  const started = Date.now();
  const rootDir = resolveRepoRoot();
  const base = options.base ?? 'HEAD';
  const allSignals = options.allSignals === true;

  // The repo-wide scan costs ~3s and exists for the cross-file signals, all of
  // which are off by default. Running it for the default set would be paying
  // the whole bill for nothing, so it is tied to --all-signals and can still be
  // declined there.
  const repoScanned = allSignals && options.repoScan !== false;

  const diff = await readUnifiedDiff(rootDir, base);
  const { context, changedFiles, nonAnalyzable, testsExcluded, scanFailure, repoScanFailure } =
    await buildContext(rootDir, diff, repoScanned, options.includeTests === true);

  const hasNonTsJs = changedFiles.some(f => !TS_JS_RE.test(f));
  const reports = runSignals(context, changedFiles, { repoScanned, hasNonTsJs, allSignals });

  return {
    base,
    reports,
    changedFiles,
    unexamined: { untracked: await listUntrackedAnalyzable(rootDir), nonAnalyzable, testsExcluded },
    withheldSignals: allSignals ? [] : withheldSignalIds(),
    scanFailure,
    repoScanFailure,
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
  const { nonAnalyzable, testsExcluded, untracked } = result.unexamined;
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
  // Untracked files belong in this list, not only in the caveats of a normal
  // report: a worktree holding nothing but new files is the case where a plain
  // "no changes" is most obviously false to the person reading it.
  if (untracked.length > 0) {
    reasons.push(
      `  ${untracked.length} untracked file(s) — an untracked file has no diff; ` +
        'git add them to review them',
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
  // A failed parse is the loudest caveat there is: every signal downstream of
  // it reported on nothing, so its silence means nothing.
  if (result.scanFailure !== undefined) {
    lines.push(
      `  The changed files could not be parsed — ${result.scanFailure}. ` +
        'Every signal below ran against no code, so their silence proves nothing.',
    );
  }
  if (result.repoScanFailure !== undefined) {
    lines.push(
      `  The repo-wide scan failed — ${result.repoScanFailure}. The corpus was ` +
        'withheld rather than half-supplied, so the cross-file signals saw only the diff.',
    );
  }

  // Withheld signals belong here, not hidden: a reader who does not know the
  // command has thirteen more cannot ask for them, and would reasonably read
  // one quiet signal as the whole review.
  if (result.withheldSignals.length > 0) {
    lines.push(
      `  ${result.withheldSignals.length} further signal(s) did not run: ` +
        `${result.withheldSignals.join(', ')}.`,
    );
    lines.push(
      '    They were built as inputs for an LLM to adjudicate, and measured 0 useful ' +
        'candidates in 106 on this repo when read directly. --all-signals runs them anyway.',
    );
  } else if (!result.repoScanned) {
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

/** C0 and C1 control characters, as escapes — never literal bytes in source. */
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * Neutralise terminal control characters in anything derived from repo content.
 *
 * Candidate details and file paths both come from the diff, and a diff is
 * attacker-controlled the moment you review a branch you did not write — a
 * fork's PR, a dependency bump, a colleague's push. An `ESC` sequence reaching
 * `console.log` intact lets that content repaint the terminal, hide lines, or
 * forge the summary this command prints (CWE-150).
 *
 * Applied at the render boundary rather than in each adapter because this is the
 * only place it can be *guaranteed*: the adapters interpolate raw symbol names,
 * reasons and paths in a dozen places, and a future one would silently opt out.
 * Idempotent, so a snippet already escaped by `truncate` is unharmed.
 *
 * The JSON path needs no equivalent — `JSON.stringify` escapes control
 * characters itself, and its consumer is not a terminal.
 */
function escapeForTerminal(s: string): string {
  return s.replace(CONTROL_CHARS_RE, ch => `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

/** One signal's block: heading, its question, its candidates, its constraint. */
function renderSignalBlock(report: SignalReport): string[] {
  const lines = [`${report.title}  (${renderCount(report)})`, `  ${report.question}`];

  for (const c of report.candidates) {
    const file = escapeForTerminal(c.file);
    lines.push(`    ${c.line === undefined ? file : `${file}:${c.line}`}`);
    lines.push(`      ${escapeForTerminal(c.detail)}`);
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
  // Untracked files count toward "something was there": a worktree of nothing
  // but new files is not "no changes", and the early return would otherwise
  // swallow the untracked list entirely. Patching the test-file case alone left
  // this third variant of the same bug, so the check is now over everything the
  // command knows about.
  const inWorktree =
    result.changedFiles.length +
    result.unexamined.nonAnalyzable.length +
    result.unexamined.testsExcluded +
    result.unexamined.untracked.length;

  if (inWorktree === 0) return renderNothingChanged(result.base);
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
      withheldSignals: result.withheldSignals,
      scanFailure: result.scanFailure ?? null,
      repoScanFailure: result.repoScanFailure ?? null,
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
