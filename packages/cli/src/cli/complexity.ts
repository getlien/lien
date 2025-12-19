import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { VectorDB } from '@liendev/core';
import { ComplexityAnalyzer } from '@liendev/core';
import { formatReport } from '@liendev/core';
import type { OutputFormat } from '@liendev/core';

interface ComplexityOptions {
  files?: string[];
  format: OutputFormat;
  threshold?: string;
  cyclomaticThreshold?: string;
  cognitiveThreshold?: string;
  failOn?: 'error' | 'warning';
}

const VALID_FAIL_ON = ['error', 'warning'];
const VALID_FORMATS = ['text', 'json', 'sarif'];

/** Validate --fail-on option */
function validateFailOn(failOn: string | undefined): void {
  if (failOn && !VALID_FAIL_ON.includes(failOn)) {
    console.error(chalk.red(`Error: Invalid --fail-on value "${failOn}". Must be either 'error' or 'warning'`));
    process.exit(1);
  }
}

/** Validate --format option */
function validateFormat(format: string): void {
  if (!VALID_FORMATS.includes(format)) {
    console.error(chalk.red(`Error: Invalid --format value "${format}". Must be one of: text, json, sarif`));
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

// Threshold overrides via CLI flags are not supported without config
// Use MCP tool with threshold parameter for custom thresholds

/** Check if index exists */
async function ensureIndexExists(vectorDB: VectorDB): Promise<void> {
  try {
    await vectorDB.scanWithFilter({ limit: 1 });
  } catch {
    console.error(chalk.red('Error: Index not found'));
    console.log(chalk.yellow('\nRun'), chalk.bold('lien index'), chalk.yellow('to index your codebase first'));
    process.exit(1);
  }
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
    
    // Warn if threshold flags are used (not supported without config)
    if (options.threshold || options.cyclomaticThreshold || options.cognitiveThreshold) {
      console.warn(chalk.yellow('Warning: Threshold overrides via CLI flags are not supported.'));
      console.warn(chalk.yellow('Use the MCP tool with threshold parameter for custom thresholds.'));
    }
    
    // Initialize database (no config needed)
    const vectorDB = new VectorDB(rootDir);
    await vectorDB.initialize();
    await ensureIndexExists(vectorDB);
    
    // Run analysis and output (uses default thresholds)
    const analyzer = new ComplexityAnalyzer(vectorDB);
    const report = await analyzer.analyze(options.files);
    console.log(formatReport(report, options.format));
    
    // Exit code for CI integration
    if (options.failOn) {
      const hasViolations = options.failOn === 'error' 
        ? report.summary.bySeverity.error > 0
        : report.summary.totalViolations > 0;
      if (hasViolations) process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red('Error analyzing complexity:'), error);
    process.exit(1);
  }
}

