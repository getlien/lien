import { describe, it, expect } from 'vitest';
import { formatJsonReport } from './json.js';
import type { ComplexityReport } from '@liendev/parser';

const report: ComplexityReport = {
  summary: {
    filesAnalyzed: 2,
    totalViolations: 1,
    bySeverity: { error: 0, warning: 1 },
    avgComplexity: 12,
    maxComplexity: 20,
  },
  files: {
    'src/utils.ts': {
      violations: [
        {
          filepath: 'src/utils.ts',
          startLine: 1,
          endLine: 30,
          symbolName: 'processData',
          symbolType: 'function',
          language: 'typescript',
          complexity: 20,
          threshold: 15,
          severity: 'warning',
          message: 'Too many test cases needed',
          metricType: 'cyclomatic',
        },
      ],
      dependents: [],
      testAssociations: [],
      riskLevel: 'low',
    },
    'src/simple.ts': {
      violations: [],
      dependents: [],
      testAssociations: [],
      riskLevel: 'low',
    },
  },
};

describe('formatJsonReport', () => {
  it('should return valid pretty-printed JSON with summary preserved', () => {
    const result = formatJsonReport(report);
    const parsed = JSON.parse(result);
    expect(result).toContain('\n'); // pretty-printed
    expect(parsed.summary).toEqual(report.summary);
  });

  it('should filter out files with no violations', () => {
    const parsed = JSON.parse(formatJsonReport(report));
    expect(parsed.files).toHaveProperty('src/utils.ts');
    expect(parsed.files).not.toHaveProperty('src/simple.ts');
  });

  // CLI-4/REVIEW-6: `lien complexity --format json`'s `riskLevel` collided
  // with `lien annotate`/`get_dependents`/`lien api-delta`'s unrelated
  // blast-radius `riskLevel` -- same name, different formula, disagreeing
  // for the same file at the same moment. Renamed to `complexityRiskLevel`
  // here; `riskLevel` must never reappear in this output.
  it('renames riskLevel to complexityRiskLevel in the JSON output (CLI-4/REVIEW-6)', () => {
    const parsed = JSON.parse(formatJsonReport(report));
    expect(parsed.files['src/utils.ts'].complexityRiskLevel).toBe('low');
    expect(parsed.files['src/utils.ts']).not.toHaveProperty('riskLevel');
  });

  it('should handle empty report', () => {
    const empty: ComplexityReport = {
      summary: {
        filesAnalyzed: 0,
        totalViolations: 0,
        bySeverity: { error: 0, warning: 0 },
        avgComplexity: 0,
        maxComplexity: 0,
      },
      files: {},
    };
    const parsed = JSON.parse(formatJsonReport(empty));
    expect(Object.keys(parsed.files)).toHaveLength(0);
  });
});
