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
 * Shared rather than duplicated because the two callers must respond
 * DIFFERENTLY to the same signal, per CLAUDE.md's disposition table, and a
 * second copy of the detection would be free to drift from the first:
 *
 *   - `lien complexity` is gate-shaped (`--fail-on`): hard error, exit 1.
 *   - `lien health` is advisory: loud warning, exit 0.
 */

/** Options for {@link describeScanFailure}. */
export interface ScanOutcome {
  success: boolean;
  error?: string;
  chunkCount: number;
  /** Files excluded for exceeding the size cap, if the scan reported any. */
  filesSkipped?: number;
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
