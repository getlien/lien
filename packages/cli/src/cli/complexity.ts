import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { createVectorDB } from '@liendev/core';
import { ComplexityAnalyzer } from '@liendev/core';
import { formatReport } from '@liendev/core';
import type { OutputFormat } from '@liendev/core';
import { hasStructuralIndex, getIndexStalenessWarning } from '../utils/index-freshness.js';

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
 * Check if the project has ever been indexed, and exit loudly if not.
 *
 * Deliberately a plain filesystem existence check (`hasStructuralIndex`)
 * rather than opening the database and probing for rows: `createVectorDB(
 * rootDir).initialize()` unconditionally creates the index directory and an
 * empty-but-valid `structural.db` (see `schema.ts`'s `openDatabase`), so
 * calling it first — then discovering there's no data — is too late to
 * distinguish "never indexed" from "empty index," and leaves behind exactly
 * the store this command has no business creating. `lien complexity` is a
 * gate-shaped command (`--fail-on`), so a missing index is always a hard
 * error here, independent of `--fail-on`.
 *
 * Returns whether the index exists. `process.exit(1)` terminates the process
 * for real in production, but the boolean return (checked by the caller) is
 * what actually stops this function's caller from proceeding to
 * `createVectorDB` in a test environment where `process.exit` is mocked —
 * belt-and-suspenders against ever opening the database on a missing index.
 */
async function ensureIndexExists(rootDir: string): Promise<boolean> {
  if (await hasStructuralIndex(rootDir)) return true;
  console.error(chalk.red('Error: Index not found'));
  console.log(
    chalk.yellow('\nRun'),
    chalk.bold('lien index'),
    chalk.yellow('to index your codebase first'),
  );
  process.exit(1);
  return false;
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

    // Cheap existence check BEFORE ever opening the database — see
    // `ensureIndexExists`'s doc comment for why this must come first.
    if (!(await ensureIndexExists(rootDir))) return;

    // `lien serve`'s auto-reindex machinery (git-detection.ts) doesn't run
    // for this one-shot command, so a repo whose working tree has moved on
    // since the last `lien index`/`lien serve` reindex would otherwise
    // report a silent false clean. Warn, don't block or auto-reindex —
    // reuses the same staleness check `lien status` already computes.
    const stalenessWarning = await getIndexStalenessWarning(rootDir);
    if (stalenessWarning) console.warn(chalk.yellow(stalenessWarning));

    // Initialize database via the factory so reads hit the same backend
    // `lien index` wrote
    const vectorDB = await createVectorDB(rootDir);
    await vectorDB.initialize();

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
