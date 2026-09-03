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
 * whole corpus and hundreds of those chunks were functions.
 */
export interface AnalyzedOutcome {
  /** `ComplexityReport.summary.filesAnalyzed`. */
  filesAnalyzed: number;
  /** `ComplexityReport.summary.declarationsAnalyzed` -- the same scope. */
  declarationsAnalyzed: number;
}

/**
 * The third state: the scan SUCCEEDED across the whole corpus, produced
 * chunks, and not one of them was a declaration the parser recognised.
 *
 * {@link describeScanFailure} cannot see this -- it returns `undefined` the
 * moment `chunkCount > 0`, and a markdown, YAML or unparseable source file
 * chunks perfectly well. So `lien complexity` in a documentation-only repo,
 * and in one whose only source was an unsupported language, printed
 * "No violations found!" at exit 0 (#1148).
 *
 * WHOLE-CORPUS ONLY, and the scoping is the correctness argument, not a
 * convenience. `declarationsAnalyzed === 0` does NOT mean "this file failed to
 * parse". `chunker.ts` sets `symbolType: symbolInfo?.type`, so a file
 * tree-sitter fails on and a file that parses fine while declaring nothing
 * emit the SAME single untyped chunk -- byte-identical, hence undecidable
 * here. Declaration-free-but-valid is ordinary: measured on this repo, 73 of
 * 316 tracked source files (23%) contain no recognised declaration, across
 * TypeScript, Python, Rust and Swift. Barrel re-exports, `export const`,
 * `export type` aliases, module constants, Go `var`, Rust `pub const` and
 * `pub struct` all yield zero.
 *
 * Applied per file it therefore hard-errors on roughly a quarter of a real
 * repository -- the false alarm CLAUDE.md forbids outright, and the first
 * version of this function did exactly that. Aggregated over a whole corpus
 * the reading is sound: a repository in which NOTHING anywhere declares a
 * function, class or type has no complexity to attest to.
 *
 * It is also not `maxComplexity === 0`, which is a third distinct question --
 * a file of pure interfaces measures 0 and is perfectly clean.
 *
 * Telling a single failed parse from a single declaration-free file needs a
 * real signal from the parser (an ERROR-root flag out of `chunkFile`), which
 * does not exist yet. Do not substitute a proxy for it; substituting a proxy
 * is precisely what went wrong the first time.
 */
export function describeUnanalyzableScan(outcome: AnalyzedOutcome): string | undefined {
  if (outcome.declarationsAnalyzed > 0) return undefined;
  // Nothing scanned at all is `describeScanFailure`'s state. Note this is only
  // true for a whole-corpus outcome: under a `--files` filter that matched
  // nothing, that function saw the UNFILTERED scan, returned undefined, and
  // nobody reports anything -- which is why callers must handle an empty
  // filter themselves rather than rely on this branch (#1148).
  if (outcome.filesAnalyzed <= 0) return undefined;

  const n = outcome.filesAnalyzed;
  return (
    `${n} file${n === 1 ? '' : 's'} parsed, but ${n === 1 ? 'it did not contain' : 'not one contained'} ` +
    'a function, class or type the parser recognised'
  );
}
