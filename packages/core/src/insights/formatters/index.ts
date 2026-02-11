import type { ComplexityReport } from '../types.js';
import { formatTextReport } from './text.js';
import { formatJsonReport } from './json.js';
import { formatSarifReport } from './sarif.js';

export type OutputFormat = 'text' | 'json' | 'sarif';

/**
 * Format complexity report in the specified format
 */
export function formatReport(
  report: ComplexityReport,
  format: OutputFormat
): string {
  switch (format) {
    case 'json':
      return formatJsonReport(report);
    case 'sarif':
      return formatSarifReport(report);
    case 'text':
    default:
      return formatTextReport(report);
  }
}

// Export individual formatters
export { formatTextReport, formatJsonReport, formatSarifReport };

