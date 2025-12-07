import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { VectorDB } from '../vectordb/lancedb.js';
import { configService } from '../config/service.js';
import { ComplexityAnalyzer } from '../insights/complexity-analyzer.js';
import { formatReport, OutputFormat } from '../insights/formatters/index.js';
import type { LienConfig, LegacyLienConfig } from '../config/schema.js';

interface ComplexityOptions {
  files?: string[];
  format: OutputFormat;
  threshold?: string;
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

/** Parse and validate threshold, returns null if not provided */
function parseThreshold(threshold: string | undefined): number | null {
  if (!threshold) return null;
  
  const value = parseInt(threshold, 10);
  if (isNaN(value)) {
    console.error(chalk.red(`Error: Invalid --threshold value "${threshold}". Must be a number`));
    process.exit(1);
  }
  if (value <= 0) {
    console.error(chalk.red(`Error: Invalid --threshold value "${threshold}". Must be a positive number`));
    process.exit(1);
  }
  return value;
}

/** Apply threshold override to config (mutates config) */
function applyThresholdOverride(config: LienConfig | LegacyLienConfig, thresholdValue: number): void {
  const defaultThresholds = { method: thresholdValue, cognitive: 15, file: 50, average: 6 };
  // Cast to any to allow mutation - both config types support complexity at runtime
  const cfg = config as { complexity?: LienConfig['complexity'] };
  
  if (!cfg.complexity) {
    cfg.complexity = { enabled: true, thresholds: defaultThresholds, severity: { warning: 1.0, error: 2.0 } };
  } else if (!cfg.complexity.thresholds) {
    cfg.complexity.thresholds = defaultThresholds;
  } else {
    cfg.complexity.thresholds.method = thresholdValue;
  }
}

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
    const thresholdValue = parseThreshold(options.threshold);
    
    // Load config and database
    const config = await configService.load(rootDir);
    const vectorDB = new VectorDB(rootDir);
    await vectorDB.initialize();
    await ensureIndexExists(vectorDB);
    
    // Apply threshold override if provided
    if (thresholdValue !== null) {
      applyThresholdOverride(config, thresholdValue);
    }
    
    // Run analysis and output
    const analyzer = new ComplexityAnalyzer(vectorDB, config);
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

