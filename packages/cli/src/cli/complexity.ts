import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { performChunkOnlyIndex, analyzeComplexityFromChunks } from '@liendev/parser';
import { formatReport } from '@liendev/core';
import type { OutputFormat } from '@liendev/core';
import { describeScanFailure } from '../utils/scan-failure.js';
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
function reportScanCaveats(filesErrored: number, filesSkipped: number): void {
  if (filesErrored > 0) {
    console.warn(
      chalk.yellow(
        `Warning: ${filesErrored} file${filesErrored === 1 ? '' : 's'} could not be parsed and ` +
          'are absent from this report. See the [parser] errors above.',
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
 * from `fileData.dependentCount` (`core/src/insights/formatters/text.ts:85`),
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

    if (scanError) {
      console.error(chalk.red(`Error: cannot analyze complexity — ${scanError}`));
      console.error(
        chalk.yellow('This is not a clean result. Nothing was analyzed, so nothing was checked.'),
      );
      // A refusal must be actionable, never a dead end (see
      // cli/unsafe-root.ts's same principle).
      console.error(chalk.dim(`  Looked in: ${rootDir}`));
      console.error(
        chalk.dim('  Check that this is your project root and the sources are not all gitignored.'),
      );
      process.exit(1);
      return;
    }

    reportScanCaveats(scan.filesErrored, scan.filesSkipped);

    const report = analyzeComplexityFromChunks(scan.chunks, files);
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
