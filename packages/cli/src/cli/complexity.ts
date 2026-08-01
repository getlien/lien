import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { createVectorDB } from '@liendev/core';
import { ComplexityAnalyzer } from '@liendev/core';
import { formatReport } from '@liendev/core';
import type { OutputFormat, VectorDBInterface } from '@liendev/core';
import { classifyIndexState } from '../utils/index-freshness.js';

interface ComplexityOptions {
  files?: string[];
  format: OutputFormat;
  failOn?: 'error' | 'warning';
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
 * Resolve `rootDir`'s whole-index state via the shared classifier
 * (`classifyIndexState`, `../utils/index-freshness.js`) and exit loudly for
 * either "never indexed" (S0) or "indexed, but the store has 0 rows" (S1) —
 * `lien complexity` is a gate-shaped command (`--fail-on`), so a project
 * with no usable data is always a hard error here, independent of
 * `--fail-on`. A confident "0 violations, exit 0" on either state would be
 * exactly the false-clean bug this command exists to never repeat.
 *
 * `classifyIndexState` itself guarantees `createVectorDB(...).initialize()`
 * — which unconditionally creates the index directory and an empty-but-
 * valid `structural.db` (see `schema.ts`'s `openDatabase`) — is never even
 * invoked for S0, so a never-indexed project is never left with a stray
 * store as a side effect of this check.
 *
 * Returns the ready-to-use `vectorDB` for `ok`/`S2`, or `undefined` after
 * already exiting for `S0`/`S1`. `process.exit(1)` terminates the process
 * for real in production, but the `undefined` return (checked by the
 * caller) is what actually stops this function's caller from proceeding to
 * `ComplexityAnalyzer` in a test environment where `process.exit` is
 * mocked — belt-and-suspenders against ever analyzing 0 rows as a clean
 * report.
 */
async function resolveIndexOrExit(rootDir: string): Promise<VectorDBInterface | undefined> {
  const result = await classifyIndexState(rootDir, async () => {
    const vectorDB = await createVectorDB(rootDir);
    await vectorDB.initialize();
    return vectorDB;
  });

  if (result.state === 'S0' || result.state === 'S1') {
    const reason = result.state === 'S0' ? 'Index not found' : 'Index is empty (0 indexed files)';
    console.error(chalk.red(`Error: ${reason}`));
    console.log(
      chalk.yellow('\nRun'),
      chalk.bold('lien index'),
      chalk.yellow('to index your codebase first'),
    );
    process.exit(1);
    return undefined;
  }

  // `lien serve`'s auto-reindex machinery (git-detection.ts) doesn't run for
  // this one-shot command, so a repo whose working tree has moved on since
  // the last `lien index`/`lien serve` reindex would otherwise report a
  // silent false clean. Warn, don't block or auto-reindex.
  if (result.state === 'S2' && result.warning) {
    console.warn(chalk.yellow(result.warning));
  }

  return result.vectorDB;
}

/**
 * Analyze code complexity from indexed codebase
 */
export async function complexityCommand(options: ComplexityOptions) {
  const rootDir = process.cwd();

  try {
    // Validate options
    validateFailOn(options.failOn);
    validateFormat(options.format);
    validateFilesExist(options.files, rootDir);

    // Classify the index state and exit loudly for S0/S1 — see
    // `resolveIndexOrExit`'s doc comment.
    const vectorDB = await resolveIndexOrExit(rootDir);
    if (!vectorDB) return;

    // Run analysis and output (uses default thresholds)
    const analyzer = new ComplexityAnalyzer(vectorDB);
    const report = await analyzer.analyze(options.files);
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
