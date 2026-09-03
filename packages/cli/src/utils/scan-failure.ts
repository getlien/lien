/**
 * "Do I have data to answer from?" for commands that read the working tree.
 *
 * Deleting the persisted index removes STALENESS — nothing can disagree with
 * disk when you just read disk. It does not remove the older obligation the
 * index-state-honesty doctrine exists to enforce: **never render "no data" as
 * a clean result.** A scan that failed outright and a genuinely clean
 * repository produce the same empty report, and only one of them is good
 * news.
 *
 * The trap is that `performChunkOnlyIndex` signals failure by RETURNING
 * `{ success: false, error }` rather than throwing — including for
 * `NativeBindingLoadError`, which the chunker re-throws precisely so a run
 * fails loudly, only for the outer catch to convert it into a quiet
 * `success: false`. A caller that destructures `chunks` and ignores the rest
 * gets an empty array and no indication anything went wrong. `lien health`
 * shipped its first draft doing exactly that.
 *
 * Shared rather than duplicated because the three callers must respond
 * DIFFERENTLY to the same signal, per CLAUDE.md's disposition table, and a
 * second copy of the detection would be free to drift from the first:
 *
 *   - `lien complexity` is gate-shaped (`--fail-on`): hard error, exit 1.
 *   - `lien health` is advisory: loud warning, exit 0.
 *   - `lien review` is advisory: the reason goes in its caveats block.
 *
 * TOTAL failure is one of THREE states this module answers for, and the only
 * one {@link describeScanFailure} can see:
 *
 *   - nothing parsed                  -> `describeScanFailure`
 *   - most of the corpus failed        -> {@link describePartialScan}
 *   - it parsed, and none of it is code -> {@link describeUnanalyzableScan}
 *
 * The third was added by #1148, after `lien complexity` was measured printing
 * "No violations found!" for a file tree-sitter had failed on entirely. Each
 * is invisible to the other two by construction, so a command must route all
 * three to be honest -- checking one is not checking the question.
 */

/** Options for {@link describeScanFailure}. */
export interface ScanOutcome {
  success: boolean;
  error?: string;
  chunkCount: number;
  /** Files excluded for exceeding the size cap, if the scan reported any. */
  filesSkipped?: number;
  /** Files the parser could not read at all, if the scan reported any. */
  filesErrored?: number;
}

/**
 * Returns undefined only when the scan genuinely produced content, and a
 * human-readable reason otherwise.
 *
 * A successful scan with zero chunks counts as failure: an empty parse is not
 * evidence of a clean codebase, it is the absence of evidence.
 */
export function describeScanFailure(outcome: ScanOutcome): string | undefined {
  if (!outcome.success) return outcome.error ?? 'the scan failed for an unreported reason';
  if (outcome.chunkCount > 0) return undefined;

  // Naming the real cause matters more here than anywhere else: "no parseable
  // chunks" sends someone hunting a parser bug when the actual answer is that
  // every candidate file was too large to read.
  const skipped = outcome.filesSkipped ?? 0;
  if (skipped > 0) {
    return `every candidate file was skipped for exceeding the size cap (${skipped} file${skipped === 1 ? '' : 's'})`;
  }
  return 'the scan produced no parseable chunks';
}

/**
 * The partial-failure counterpart: some files parsed, others could not be read
 * at all.
 *
 * {@link describeScanFailure} is all-or-nothing by construction — it returns
 * `undefined` the moment `chunkCount > 0` — so a run where most of the corpus
 * failed to parse looks identical to a healthy one. That is not hypothetical:
 * on a large deletion diff, `lien review` reported "98 changed file(s) … No
 * candidates from any signal" while 88 of those files had failed with ENOENT
 * (they had been deleted), emitting 88 raw parser lines to stderr and naming
 * none of it in the caveats block a reader is told to trust.
 *
 * "Most of what you asked about could not be read" is a different statement
 * from "nothing could be read", and both are different from "I looked and
 * found nothing". Only the third is good news.
 */
export function describePartialScan(outcome: ScanOutcome): string | undefined {
  const errored = outcome.filesErrored ?? 0;
  if (errored <= 0 || outcome.chunkCount <= 0) return undefined;
  return `${errored} file${errored === 1 ? '' : 's'} could not be parsed and ${errored === 1 ? 'was' : 'were'} not examined`;
}

/**
 * What {@link describeUnanalyzableScan} needs. BOTH fields must come from the
 * same built report, never one from the report and one from the raw scan.
 *
 * Mixing the two scopes produces a message that is simply false. Measured
 * while building #1148: passing the scan-wide chunk count beside the report's
 * declaration count made `complexity --files ILogger.cs` inside serilog say
 * "2618 chunks parsed, but not one contained a function" -- when 2618 was the
 * whole corpus and hundreds of those chunks were functions. `--files` narrows
 * the report, so the sentence has to describe the report.
 */
export interface AnalyzedOutcome {
  /** `ComplexityReport.summary.filesAnalyzed` -- after any `--files` filter. */
  filesAnalyzed: number;
  /** `ComplexityReport.summary.declarationsAnalyzed` -- the same scope. */
  declarationsAnalyzed: number;
}

/**
 * The third state, and the one that shipped a false clean: the scan SUCCEEDED,
 * produced chunks, and none of them was code.
 *
 * {@link describeScanFailure} cannot see this -- it returns `undefined` the
 * moment `chunkCount > 0`, and a markdown, YAML or unparseable source file
 * chunks perfectly well. So `lien complexity` on serilog's 1370-line
 * `ILogger.cs`, which tree-sitter fails to parse in its entirety (#970 Bug 2),
 * printed "No violations found!" at exit 0. Same output for a docs-only repo,
 * and for one whose only source file was in an unsupported language (#1148).
 *
 * The test is `declarationsAnalyzed === 0`, NOT `maxComplexity === 0`. Those
 * are not the same question, and the difference is the whole reason this
 * function exists: a file of pure interfaces or pure fields parses correctly
 * and measures a max complexity of 0, so gating on complexity would hard-error
 * on legitimately clean code. Measured, on files the parser handles fine:
 *
 *   types-only.ts   maxComplexity 0   declarations 1   <- clean, must not fire
 *   fields-only.ts  maxComplexity 0   declarations 1   <- clean, must not fire
 *   ILogger.cs      maxComplexity 0   declarations 0   <- no data, must fire
 *
 * That is CLAUDE.md's hard constraint in miniature: gate on the actual state,
 * never on the shape of the result, and never turn a genuinely clean result
 * into a false alarm.
 */
export function describeUnanalyzableScan(outcome: AnalyzedOutcome): string | undefined {
  if (outcome.declarationsAnalyzed > 0) return undefined;
  if (outcome.filesAnalyzed <= 0) return undefined; // describeScanFailure's case, already reported

  const n = outcome.filesAnalyzed;
  return (
    `${n} file${n === 1 ? '' : 's'} parsed, but ${n === 1 ? 'it did not contain' : 'not one contained'} ` +
    'a function, class or type the parser recognised'
  );
}
