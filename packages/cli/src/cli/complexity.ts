import chalk from 'chalk';
import { VectorDB } from '../vectordb/lancedb.js';
import { configService } from '../config/service.js';
import { ComplexityAnalyzer } from '../insights/complexity-analyzer.js';
import { formatReport, OutputFormat } from '../insights/formatters/index.js';

interface ComplexityOptions {
  files?: string[];
  format: OutputFormat;
  threshold?: string;
  failOn?: 'error' | 'warning';
}

/**
 * Analyze code complexity from indexed codebase
 */
export async function complexityCommand(options: ComplexityOptions) {
  const rootDir = process.cwd();
  
  try {
    // Validate --fail-on option
    if (options.failOn && !['error', 'warning'].includes(options.failOn)) {
      console.error(chalk.red(`Error: Invalid --fail-on value "${options.failOn}". Must be either 'error' or 'warning'`));
      process.exit(1);
    }
    
    // Validate --format option (always has a default, but validate in case of programmatic use)
    if (!['text', 'json', 'sarif'].includes(options.format)) {
      console.error(chalk.red(`Error: Invalid --format value "${options.format}". Must be one of: text, json, sarif`));
      process.exit(1);
    }
    
    // Load config and database
    const config = await configService.load(rootDir);
    const vectorDB = new VectorDB(rootDir);
    await vectorDB.initialize();
    
    // Check if index exists by attempting to scan
    try {
      await vectorDB.scanWithFilter({ limit: 1 });
    } catch (error) {
      console.error(chalk.red('Error: Index not found'));
      console.log(chalk.yellow('\nRun'), chalk.bold('lien index'), chalk.yellow('to index your codebase first'));
      process.exit(1);
    }
    
    // Override threshold if provided via CLI
    if (options.threshold) {
      const thresholdValue = parseInt(options.threshold, 10);
      if (isNaN(thresholdValue)) {
        console.error(chalk.red(`Error: Invalid --threshold value "${options.threshold}". Must be a number`));
        process.exit(1);
      }
      if (thresholdValue <= 0) {
        console.error(chalk.red(`Error: Invalid --threshold value "${options.threshold}". Must be a positive number`));
        process.exit(1);
      }
      // Update config with CLI override
      if (!config.complexity) {
        config.complexity = {
          enabled: true,
          thresholds: { method: thresholdValue, file: 50, average: 6 },
          severity: { warning: 1.0, error: 2.0 },
        };
      } else {
        config.complexity.thresholds.method = thresholdValue;
      }
    }
    
    // Run analysis
    const analyzer = new ComplexityAnalyzer(vectorDB, config);
    const report = await analyzer.analyze(options.files);
    
    // Output in requested format
    const output = formatReport(report, options.format);
    console.log(output);
    
    // Exit code for CI integration
    if (options.failOn) {
      const hasViolations = options.failOn === 'error' 
        ? report.summary.bySeverity.error > 0
        : report.summary.totalViolations > 0;
      
      if (hasViolations) {
        process.exit(1);
      }
    }
  } catch (error) {
    console.error(chalk.red('Error analyzing complexity:'), error);
    process.exit(1);
  }
}

