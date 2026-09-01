import type { ComplexityReport, FileComplexityData } from '@liendev/parser';

/**
 * JSON-output shape for a file's complexity data: identical to
 * `FileComplexityData` except `riskLevel` is renamed `complexityRiskLevel`
 * (CLI-4/REVIEW-6). `FileComplexityData.riskLevel` is the file's OWN
 * complexity severity, boosted (never downgraded) by dependent count/
 * complexity -- see that field's doc comment in `@liendev/parser`'s
 * `insights/types.ts`. It is a DIFFERENT metric from `get_dependents`/
 * `lien annotate`/`lien api-delta`'s `riskLevel` (blast-radius risk, which
 * weighs dependents' test coverage and applies a complexity floor instead
 * of a boost) -- the two disagreed for the same file at the same moment
 * under the shared name, which is the defect this rename fixes. See
 * docs/architecture/blast-radius-nudge.md's "Two risk concepts" section.
 * Do not rename this back to `riskLevel`.
 */
type JsonFileComplexityData = Omit<FileComplexityData, 'riskLevel'> & {
  complexityRiskLevel: FileComplexityData['riskLevel'];
};

function toJsonFileData(data: FileComplexityData): JsonFileComplexityData {
  const { riskLevel, ...rest } = data;
  return { ...rest, complexityRiskLevel: riskLevel };
}

/**
 * Format complexity report as JSON for consumption by GitHub Action.
 * Only includes files with violations to reduce noise.
 */
export function formatJsonReport(report: ComplexityReport): string {
  // Filter to only files with violations - no point showing files with empty arrays
  const filesWithViolations = Object.fromEntries(
    Object.entries(report.files)
      .filter(([_, data]) => data.violations.length > 0)
      .map(([filepath, data]) => [filepath, toJsonFileData(data)]),
  );

  const filteredReport = {
    summary: report.summary,
    files: filesWithViolations,
  };

  return JSON.stringify(filteredReport, null, 2);
}
