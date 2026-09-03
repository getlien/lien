import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { performChunkOnlyIndex, analyzeComplexityFromChunks } from '@liendev/parser';
import { formatReport } from '../insights/formatters/index.js';
import type { OutputFormat } from '../insights/formatters/index.js';
import {
  describeScanFailure,
  describePartialScan,
  describeUnanalyzableScan,
} from '../utils/scan-failure.js';
import { resolveRepoRoot, rebaseToRoot } from './project-root.js';
import { assertSafeRoot } from './unsafe-root.js';

interface ComplexityOptions {
  files?: string[];
  format: OutputFormat;
  failOn?: 'error' | 'warning';
  /** Proceed even when the analysis root is `$HOME` or a filesystem root. */
  allowUnsafeRoot?: boolean;
}

const VALID_FAIL_ON = ['error', 'warning'];
const VALID_FORMATS = ['text', 'json', 'sarif'];

/** Validate --fail-on option */
function validateFailOn(failOn: string | undefined): void {
  if (failOn && !VALID_FAIL_ON.includes(failOn)) {
    console.error(
      chalk.red(`Error: Invalid --fail-on value "${failOn}". Must be either 'error' or 'warning'`),
    );
    process.exit(1);
  }
}

/** Validate --format option */
function validateFormat(format: string): void {
  if (!VALID_FORMATS.includes(format)) {
    console.error(
      chalk.red(`Error: Invalid --format value "${format}". Must be one of: text, json, sarif`),
    );
    process.exit(1);
  }
}

/** Validate that specified files exist */
function validateFilesExist(files: string[] | undefined, rootDir: string): void {
  if (!files || files.length === 0) return;

  const missingFiles = files.filter(file => {
    const fullPath = path.isAbsolute(file) ? file : path.join(rootDir, file);
    return !fs.existsSync(fullPath);
  });

  if (missingFiles.length > 0) {
    console.error(chalk.red(`Error: File${missingFiles.length > 1 ? 's' : ''} not found:`));
    missingFiles.forEach(file => console.error(chalk.red(`  - ${file}`)));
    process.exit(1);
  }
}

/**
 * Report files that never made it into the corpus.
 *
 * One unreadable or oversized file must not abort the run, but it must not
 * vanish either: a gate reporting "0 violations, exit 0" while files silently
 * failed to parse is the false-clean bug in another form. Warnings, not
 * errors — the answer is still useful, it is just incomplete, and the reader
 * has to know which.
 */
function reportScanCaveats(outcome: {
  chunkCount: number;
  filesErrored: number;
  filesSkipped: number;
}): void {
  const { filesSkipped } = outcome;
  // Shared detection, local phrasing: `describePartialScan` owns the question
  // so this cannot drift from `health`'s and `review`'s answers to it, while
  // the sentence still names THIS command's output and points at the parser
  // lines only this command emits (#1149). It takes the whole outcome rather
  // than two counts because the shared check reads `chunkCount` too, and
  // synthesising one here would be a second copy of its rule.
  const partial = describePartialScan({ success: true, ...outcome });
  if (partial) {
    console.warn(
      chalk.yellow(
        `Warning: ${partial} — they are absent from this report. See the [parser] errors above.`,
      ),
    );
  }
  if (filesSkipped > 0) {
    console.warn(
      chalk.dim(
        `  ${filesSkipped} file${filesSkipped === 1 ? '' : 's'} skipped for exceeding the size cap.`,
      ),
    );
  }
}

/**
 * Refuse, actionably, when there is no data to answer from.
 *
 * `complexity` is gate-shaped, so both no-data states end the same way: a hard
 * error, never a confident "0 violations, exit 0". Shared because the two
 * call sites printed identical four-line refusals differing only in reason and
 * closing hint, and because a refusal must never be a dead end (see
 * cli/unsafe-root.ts's same principle).
 */
/*
 * Call as `return refuseNoData(...)`, never bare. The `never` return type is a
 * compile-time truth only: under a mocked `process.exit` -- which is how the
 * no-data invariants are tested -- control comes BACK here and falls through
 * to printing a clean report, which is the exact bug this function exists to
 * prevent. Three tests catch it if you forget.
 */
function refuseNoData(reason: string, rootDir: string, namedFiles?: string[]): never {
  console.error(chalk.red(`Error: cannot analyze complexity — ${reason}`));
  console.error(
    chalk.yellow('This is not a clean result. Nothing was analyzed, so nothing was checked.'),
  );
  console.error(chalk.dim(`  Looked in: ${rootDir}`));
  console.error(
    chalk.dim(
      namedFiles?.length
        ? '  The named file(s) may be in an unsupported language, or may have failed to parse.'
        : '  Check that this is your project root and the sources are not all gitignored.',
    ),
  );
  process.exit(1);
}

/**
 * Analyze code complexity by parsing the working tree.
 *
 * Reads the source directly — there is no persisted index to consult, so
 * there is no index state to classify and nothing that can be stale. What
 * survives from the index era is the rule that motivated the classification:
 * this command is GATE-SHAPED (`--fail-on` drives CI), so a run with no data
 * to answer from must be a hard error, never a confident "0 violations,
 * exit 0". That shape is exactly the false-clean bug the index-state-honesty
 * doctrine was written to prevent, and a failed parse produces it just as
 * readily as an empty index did.
 *
 * `lien health` reads the same signal and responds differently — a loud
 * warning at exit 0 — because it is advisory. See
 * `../utils/scan-failure.ts`.
 *
 * Enrichment is deliberately left ON here, unlike in `lien health`. It costs
 * ~600 ms on this repo, but the text formatter reports "Imported by N files"
 * from `fileData.dependentCount` (`../insights/formatters/text.ts`),
 * so disabling it would silently empty a documented output field.
 */
export async function complexityCommand(options: ComplexityOptions) {
  // Resolve to the repo root rather than trusting cwd. Run from a
  // subdirectory, a raw cwd analyses that subtree alone and understates every
  // dependent count, while looking like a perfectly normal report — and for a
  // gate that means `--fail-on` verdicts on an arbitrary subtree. See
  // `resolveRepoRoot`.
  const cwd = process.cwd();
  const rootDir = resolveRepoRoot(cwd);
  if (rootDir !== cwd) {
    console.warn(chalk.dim(`Analyzing the repository root: ${rootDir}`));
  }

  // See health-cmd.ts for why this guard moved here from the deleted
  // `lien index`: same walk-from-cwd hazard, now on the surviving commands.
  assertSafeRoot(rootDir, options.allowUnsafeRoot);

  try {
    validateFailOn(options.failOn);
    validateFormat(options.format);

    // `--files` is typed relative to where the user is standing, but the
    // analysis root may be an ancestor of it. Re-base before validating or
    // matching, or a subdirectory invocation silently targets the wrong path.
    const files = options.files?.map(file => rebaseToRoot(file, cwd, rootDir));
    validateFilesExist(files, rootDir);

    const scan = await performChunkOnlyIndex(rootDir, {});
    const scanError = describeScanFailure({
      success: scan.success,
      error: scan.error,
      chunkCount: scan.chunks.length,
      filesSkipped: scan.filesSkipped,
    });

    if (scanError) return refuseNoData(scanError, rootDir, files);

    reportScanCaveats({
      chunkCount: scan.chunks.length,
      filesErrored: scan.filesErrored,
      filesSkipped: scan.filesSkipped,
    });

    const report = analyzeComplexityFromChunks(scan.chunks, files);

    // The scan succeeded and produced chunks, but nothing in scope was code.
    // Gate-shaped command, so this is a hard error for the same reason total
    // failure is: nothing was checked, so nothing can be attested. Checked
    // here rather than beside `describeScanFailure` above because it needs the
    // built report -- `--files` narrows the corpus, and a file the parser
    // failed on must fail even when the rest of the repo parsed fine (#1148).
    const unanalyzable = describeUnanalyzableScan({
      filesAnalyzed: report.summary.filesAnalyzed,
      declarationsAnalyzed: report.summary.declarationsAnalyzed,
    });
    if (unanalyzable) return refuseNoData(unanalyzable, rootDir, files);

    console.log(formatReport(report, options.format));

    // Exit code for CI integration
    if (options.failOn) {
      const hasViolations =
        options.failOn === 'error'
          ? report.summary.bySeverity.error > 0
          : report.summary.totalViolations > 0;
      if (hasViolations) process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red('Error analyzing complexity:'), error);
    process.exit(1);
  }
}
