import chalk from 'chalk';
import { ComplexityReport } from '../types.js';

/**
 * Format complexity report as human-readable text with colors
 */
export function formatTextReport(report: ComplexityReport): string {
  const lines: string[] = [];

  // Header
  lines.push(chalk.bold('🔍 Complexity Analysis\n'));

  // Summary
  lines.push(chalk.bold('Summary:'));
  lines.push(chalk.dim('  Files analyzed:'), report.summary.filesAnalyzed.toString());
  const errorText = `${report.summary.bySeverity.error} error${report.summary.bySeverity.error !== 1 ? 's' : ''}`;
  const warningText = `${report.summary.bySeverity.warning} warning${report.summary.bySeverity.warning !== 1 ? 's' : ''}`;
  lines.push(chalk.dim('  Violations:'), `${report.summary.totalViolations} (${errorText}, ${warningText})`);
  lines.push(chalk.dim('  Average complexity:'), report.summary.avgComplexity.toString());
  lines.push(chalk.dim('  Max complexity:'), report.summary.maxComplexity.toString());
  lines.push('');

  // Group violations by file
  const filesWithViolations = Object.entries(report.files)
    .filter(([_, data]) => data.violations.length > 0)
    .sort((a, b) => b[1].violations.length - a[1].violations.length);

  if (filesWithViolations.length === 0) {
    lines.push(chalk.green('✓ No violations found!'));
    return lines.join('\n');
  }

  // Errors section
  const errors = filesWithViolations.flatMap(([file, data]) =>
    data.violations.filter(v => v.severity === 'error').map(v => ({ file, ...v }))
  );

  if (errors.length > 0) {
    lines.push(chalk.red.bold('❌ Errors:\n'));
    for (const error of errors) {
      const symbolDisplay = (error.symbolType === 'function' || error.symbolType === 'method') 
        ? error.symbolName + '()' 
        : error.symbolName;
      lines.push(chalk.red(`  ${error.file}:${error.startLine}`) + chalk.dim(' - ') + chalk.bold(symbolDisplay));
      lines.push(chalk.dim(`    Complexity: ${error.complexity} (threshold: ${error.threshold})`));
      const percentage = Math.round(((error.complexity - error.threshold) / error.threshold) * 100);
      lines.push(chalk.dim(`    ⬆️  ${percentage}% over threshold`));
      const fileData = report.files[error.file];
      
      // Show dependency impact
      const depCount = fileData.dependentCount ?? fileData.dependents.length;
      if (depCount > 0) {
        lines.push(chalk.dim(`    📦 Imported by ${depCount} file${depCount !== 1 ? 's' : ''}`));
        if (fileData.dependentComplexityMetrics) {
          const metrics = fileData.dependentComplexityMetrics;
          lines.push(chalk.dim(`       Dependent avg complexity: ${metrics.averageComplexity}, max: ${metrics.maxComplexity}`));
        }
      }
      
      lines.push(chalk.dim(`    ⚠️  Risk: ${fileData.riskLevel.toUpperCase()}`));
      lines.push('');
    }
  }

  // Warnings section
  const warnings = filesWithViolations.flatMap(([file, data]) =>
    data.violations.filter(v => v.severity === 'warning').map(v => ({ file, ...v }))
  );

  if (warnings.length > 0) {
    lines.push(chalk.yellow.bold('⚠️  Warnings:\n'));
    for (const warning of warnings) {
      const symbolDisplay = (warning.symbolType === 'function' || warning.symbolType === 'method') 
        ? warning.symbolName + '()' 
        : warning.symbolName;
      lines.push(chalk.yellow(`  ${warning.file}:${warning.startLine}`) + chalk.dim(' - ') + symbolDisplay);
      lines.push(chalk.dim(`    Complexity: ${warning.complexity} (threshold: ${warning.threshold})`));
      const percentage = Math.round(((warning.complexity - warning.threshold) / warning.threshold) * 100);
      lines.push(chalk.dim(`    ⬆️  ${percentage}% over threshold`));
      const fileData = report.files[warning.file];
      
      // Show dependency impact
      const depCount = fileData.dependentCount ?? fileData.dependents.length;
      if (depCount > 0) {
        lines.push(chalk.dim(`    📦 Imported by ${depCount} file${depCount !== 1 ? 's' : ''}`));
        if (fileData.dependentComplexityMetrics) {
          const metrics = fileData.dependentComplexityMetrics;
          lines.push(chalk.dim(`       Dependent avg complexity: ${metrics.averageComplexity}, max: ${metrics.maxComplexity}`));
        }
      }
      
      lines.push(chalk.dim(`    ⚠️  Risk: ${fileData.riskLevel.toUpperCase()}`));
      lines.push('');
    }
  }

  return lines.join('\n');
}

