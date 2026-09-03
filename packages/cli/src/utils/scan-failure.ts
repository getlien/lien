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
 * What {@link describeUnanalyzableScan} needs, from one scan.
 */
export interface AnalyzedOutcome {
  /** Files the scan produced chunks for, whatever their language. */
  filesAnalyzed: number;
  /** Of those, how many are in a language this parser can analyse. */
  codeFilesAnalyzed: number;
}

/**
 * The third state: the scan SUCCEEDED and not one file was code.
 *
 * {@link describeScanFailure} cannot see this -- it returns `undefined` the
 * moment `chunkCount > 0`, and markdown and YAML chunk perfectly well. So
 * `lien complexity` printed "No violations found!" at exit 0 in a
 * documentation-only repository, and in one whose only source file was an
 * unsupported language: there the `.cbl` was dropped and the `.yaml` that
 * remained satisfied the gate (#1148).
 *
 * The question is "did I see any code?", answered from `languageExists` --
 * a fact about the scan, not an inference from it.
 *
 * IT IS DELIBERATELY NOT "did anything declare a symbol?", and that
 * distinction cost a round trip worth recording. A first version of this
 * refused whenever zero declarations were parsed, reasoning that a failed
 * parse yields one untyped whole-file chunk (#970's signature). True, but not
 * exclusive: `chunker.ts` sets `symbolType: symbolInfo?.type`, so a file that
 * parses fine while declaring nothing emits the SAME chunk -- byte-identical,
 * hence undecidable. Measured, that shape is ordinary: 73 of 316 tracked
 * source files in this repo (23%), across TypeScript, Python, Rust and Swift,
 * plus whole plausible packages (design tokens, `export type` aliases,
 * barrels, Go `var`, Rust `pub const`). It refused all of them.
 *
 * So: never gate on the presence of declarations, and never gate on
 * `maxComplexity` either -- a file of pure interfaces measures 0 and is
 * perfectly clean. Distinguishing a genuine parse failure needs a real
 * ERROR-root signal out of `chunkFile`, which does not exist yet (#1157).
 */
export function describeUnanalyzableScan(outcome: AnalyzedOutcome): string | undefined {
  if (outcome.codeFilesAnalyzed > 0) return undefined;
  // Nothing scanned at all is `describeScanFailure`'s state.
  if (outcome.filesAnalyzed <= 0) return undefined;

  const n = outcome.filesAnalyzed;
  return (
    `${n} file${n === 1 ? '' : 's'} parsed, but ${n === 1 ? 'it is not' : 'none of them are'} ` +
    'in a language lien can analyse'
  );
}
