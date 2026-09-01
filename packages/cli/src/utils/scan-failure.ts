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
 * TOTAL failure is only half the obligation. See {@link describePartialScan}
 * for the other half, which this function deliberately cannot see.
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
