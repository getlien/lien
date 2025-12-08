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
  cyclomaticThreshold?: string;
  cognitiveThreshold?: string;
  failOn?: 'error' | 'warning';
  duplicates?: boolean;
  duplicateThreshold?: string;
}

/** Parsed threshold overrides */
interface ThresholdOverrides {
  cyclomatic: number | null;
  cognitive: number | null;
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

/** Parse and validate a threshold value */
function parseThresholdValue(value: string | undefined, flagName: string): number | null {
  if (!value) return null;
  
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    console.error(chalk.red(`Error: Invalid ${flagName} value "${value}". Must be a number`));
    process.exit(1);
  }
  if (parsed <= 0) {
    console.error(chalk.red(`Error: Invalid ${flagName} value "${value}". Must be a positive number`));
    process.exit(1);
  }
  return parsed;
}

/** Parse all threshold options into overrides */
function parseThresholdOverrides(options: ComplexityOptions): ThresholdOverrides {
  const baseThreshold = parseThresholdValue(options.threshold, '--threshold');
  const cyclomaticOverride = parseThresholdValue(options.cyclomaticThreshold, '--cyclomatic-threshold');
  const cognitiveOverride = parseThresholdValue(options.cognitiveThreshold, '--cognitive-threshold');
  
  return {
    // Specific flags take precedence over --threshold
    cyclomatic: cyclomaticOverride ?? baseThreshold,
    cognitive: cognitiveOverride ?? baseThreshold,
  };
}

/** Apply threshold overrides to config (mutates config) */
function applyThresholdOverrides(config: LienConfig | LegacyLienConfig, overrides: ThresholdOverrides): void {
  if (overrides.cyclomatic === null && overrides.cognitive === null) return;
  
  // Cast to allow mutation - both config types support complexity at runtime
  const cfg = config as { complexity?: LienConfig['complexity'] };
  
  // Ensure complexity config structure exists
  if (!cfg.complexity) {
    cfg.complexity = {
      enabled: true,
      thresholds: { testPaths: 15, mentalLoad: 15 },
    };
  } else if (!cfg.complexity.thresholds) {
    cfg.complexity.thresholds = { testPaths: 15, mentalLoad: 15 };
  }
  
  // Apply overrides (CLI flags use --cyclomatic/--cognitive for familiarity)
  if (overrides.cyclomatic !== null) {
    cfg.complexity.thresholds.testPaths = overrides.cyclomatic;
  }
  if (overrides.cognitive !== null) {
    cfg.complexity.thresholds.mentalLoad = overrides.cognitive;
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
    const thresholdOverrides = parseThresholdOverrides(options);
    
    // Load config and database
    const config = await configService.load(rootDir);
    const vectorDB = new VectorDB(rootDir);
    await vectorDB.initialize();
    await ensureIndexExists(vectorDB);
    
    // Apply threshold overrides if provided
    applyThresholdOverrides(config, thresholdOverrides);
    
    // Parse duplicate threshold if provided
    const duplicateThreshold = options.duplicateThreshold 
      ? parseFloat(options.duplicateThreshold) 
      : undefined;
    
    // Run analysis and output
    const analyzer = new ComplexityAnalyzer(vectorDB, config);
    const report = await analyzer.analyze(options.files, {
      includeDuplicates: options.duplicates,
      duplicateThreshold,
    });
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

