import type { ComplexityReport } from '../types.js';

/**
 * Format complexity report as JSON for consumption by GitHub Action.
 * Only includes files with violations to reduce noise.
 */
export function formatJsonReport(report: ComplexityReport): string {
  // Filter to only files with violations - no point showing files with empty arrays
  const filesWithViolations = Object.fromEntries(
    Object.entries(report.files).filter(([_, data]) => data.violations.length > 0)
  );

  const filteredReport: ComplexityReport = {
    summary: report.summary,
    files: filesWithViolations,
  };

  return JSON.stringify(filteredReport, null, 2);
}

