import { ComplexityReport } from '../types.js';

/**
 * Format complexity report as JSON for consumption by GitHub Action
 */
export function formatJsonReport(report: ComplexityReport): string {
  return JSON.stringify(report, null, 2);
}

