import chalk from 'chalk';
import { ComplexityReport, ComplexityViolation, FileComplexityData } from '../types.js';

/**
 * Violation with associated file path for rendering
 */
type ViolationWithFile = ComplexityViolation & { file: string };

/**
 * Get the display label for a metric type
 */
function getMetricLabel(metricType: ComplexityViolation['metricType']): string {
  switch (metricType) {
    case 'cognitive': return '🧠 Mental load';
    case 'cyclomatic': return 'Test paths';
    case 'halstead_effort': return 'Time to understand';
    case 'halstead_bugs': return 'Estimated bugs';
    default: return 'Complexity';
  }
}

/**
 * Convert Halstead effort to time in minutes
 */
function effortToMinutes(effort: number): number {
  return effort / 1080;
}

/**
 * Format minutes as human-readable time
 */
function formatTime(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  return `${Math.round(minutes)}m`;
}

/**
 * Format Halstead details as additional lines
 */
function formatHalsteadDetails(violation: ViolationWithFile): string[] {
  if (!violation.halsteadDetails) return [];
  
  const { volume, difficulty, effort, bugs } = violation.halsteadDetails;
  const timeStr = formatTime(effortToMinutes(effort));
  return [
    chalk.dim(`    📊  Volume: ${Math.round(volume).toLocaleString()}, Difficulty: ${difficulty.toFixed(1)}`),
    chalk.dim(`    ⏱️  Time: ~${timeStr}, Est. bugs: ${bugs.toFixed(2)}`),
  ];
}

/**
 * Format a single violation entry with its metadata
 */
function formatViolation(
  violation: ViolationWithFile,
  fileData: FileComplexityData,
  colorFn: typeof chalk.red | typeof chalk.yellow,
  isBold: boolean
): string[] {
  const lines: string[] = [];
  
  const symbolDisplay = (violation.symbolType === 'function' || violation.symbolType === 'method')
    ? violation.symbolName + '()'
    : violation.symbolName;
  
  const symbolText = isBold ? chalk.bold(symbolDisplay) : symbolDisplay;
  lines.push(colorFn(`  ${violation.file}:${violation.startLine}`) + chalk.dim(' - ') + symbolText);
  
  // Show metric type and value
  const metricLabel = getMetricLabel(violation.metricType);
  let complexityDisplay: string;
  let thresholdDisplay: string;
  
  if (violation.metricType === 'halstead_effort') {
    // Show time instead of raw effort
    complexityDisplay = '~' + formatTime(effortToMinutes(violation.complexity));
    thresholdDisplay = formatTime(effortToMinutes(violation.threshold));
  } else if (violation.metricType === 'halstead_bugs') {
    // Show bugs with 2 decimal places
    complexityDisplay = violation.complexity.toFixed(2);
    thresholdDisplay = violation.threshold.toFixed(1);
  } else if (violation.metricType === 'cyclomatic') {
    // Show as test cases needed
    complexityDisplay = `${violation.complexity} (needs ~${violation.complexity} tests)`;
    thresholdDisplay = violation.threshold.toString();
  } else {
    complexityDisplay = violation.complexity.toString();
    thresholdDisplay = violation.threshold.toString();
  }
  lines.push(chalk.dim(`    ${metricLabel}: ${complexityDisplay} (threshold: ${thresholdDisplay})`));
  
  let percentageText: string;
  if (violation.threshold > 0) {
    const percentage = Math.round(((violation.complexity - violation.threshold) / violation.threshold) * 100);
    percentageText = `${percentage}% over threshold`;
  } else {
    percentageText = 'N/A (invalid threshold)';
  }
  lines.push(chalk.dim(`    ⬆️  ${percentageText}`));
  
  // Show Halstead details if available
  lines.push(...formatHalsteadDetails(violation));
  
  // Show dependency impact
  const depCount = fileData.dependentCount ?? fileData.dependents.length;
  if (depCount > 0) {
    lines.push(chalk.dim(`    📦  Imported by ${depCount} file${depCount !== 1 ? 's' : ''}`));
    if (fileData.dependentComplexityMetrics) {
      const metrics = fileData.dependentComplexityMetrics;
      lines.push(chalk.dim(`    - Dependent avg complexity: ${metrics.averageComplexity}, max: ${metrics.maxComplexity}`));
    }
  }
  
  lines.push(chalk.dim(`    ⚠️  Risk: ${fileData.riskLevel.toUpperCase()}`));
  lines.push('');
  
  return lines;
}

/**
 * Format complexity report as human-readable text with colors
 */
export function formatTextReport(report: ComplexityReport): string {
  const lines: string[] = [];

  // Header
  lines.push(chalk.bold('🔍 Complexity Analysis\n'));

  // Summary
  lines.push(chalk.bold('Summary:'));
  lines.push(chalk.dim('  Files analyzed: ') + report.summary.filesAnalyzed.toString());
  const errorText = `${report.summary.bySeverity.error} error${report.summary.bySeverity.error !== 1 ? 's' : ''}`;
  const warningText = `${report.summary.bySeverity.warning} warning${report.summary.bySeverity.warning !== 1 ? 's' : ''}`;
  lines.push(chalk.dim('  Violations: ') + `${report.summary.totalViolations} (${errorText}, ${warningText})`);
  lines.push(chalk.dim('  Average complexity: ') + report.summary.avgComplexity.toString());
  lines.push(chalk.dim('  Max complexity: ') + report.summary.maxComplexity.toString());
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
      lines.push(...formatViolation(error, report.files[error.file], chalk.red, true));
    }
  }

  // Warnings section
  const warnings = filesWithViolations.flatMap(([file, data]) =>
    data.violations.filter(v => v.severity === 'warning').map(v => ({ file, ...v }))
  );

  if (warnings.length > 0) {
    lines.push(chalk.yellow.bold('⚠️  Warnings:\n'));
    for (const warning of warnings) {
      lines.push(...formatViolation(warning, report.files[warning.file], chalk.yellow, false));
    }
  }

  return lines.join('\n');
}

