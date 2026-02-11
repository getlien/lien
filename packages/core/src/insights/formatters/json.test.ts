import { describe, it, expect } from 'vitest';
import { formatJsonReport } from './json.js';
import type { ComplexityReport } from '../types.js';

function createReport(overrides: Partial<ComplexityReport> = {}): ComplexityReport {
  return {
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
            message: 'Too many test cases needed (~20 tests) for full branch coverage',
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
    ...overrides,
  };
}

describe('formatJsonReport', () => {
  it('should return valid JSON string', () => {
    const report = createReport();
    const result = formatJsonReport(report);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('should pretty print with 2-space indentation', () => {
    const report = createReport();
    const result = formatJsonReport(report);
    // Pretty printed JSON has newlines and indentation
    expect(result).toContain('\n');
    expect(result).toContain('  ');
  });

  it('should include summary in output', () => {
    const report = createReport();
    const parsed = JSON.parse(formatJsonReport(report));
    expect(parsed.summary).toEqual(report.summary);
  });

  it('should filter out files with no violations', () => {
    const report = createReport();
    const parsed = JSON.parse(formatJsonReport(report));
    expect(parsed.files).toHaveProperty('src/utils.ts');
    expect(parsed.files).not.toHaveProperty('src/simple.ts');
  });

  it('should preserve violation details', () => {
    const report = createReport();
    const parsed = JSON.parse(formatJsonReport(report));
    const violation = parsed.files['src/utils.ts'].violations[0];
    expect(violation.symbolName).toBe('processData');
    expect(violation.complexity).toBe(20);
    expect(violation.threshold).toBe(15);
    expect(violation.severity).toBe('warning');
    expect(violation.metricType).toBe('cyclomatic');
  });

  it('should handle empty report with no files', () => {
    const report = createReport({
      summary: {
        filesAnalyzed: 0,
        totalViolations: 0,
        bySeverity: { error: 0, warning: 0 },
        avgComplexity: 0,
        maxComplexity: 0,
      },
      files: {},
    });
    const parsed = JSON.parse(formatJsonReport(report));
    expect(parsed.summary.totalViolations).toBe(0);
    expect(Object.keys(parsed.files)).toHaveLength(0);
  });

  it('should handle report where all files have no violations', () => {
    const report = createReport({
      files: {
        'src/a.ts': { violations: [], dependents: [], testAssociations: [], riskLevel: 'low' },
        'src/b.ts': { violations: [], dependents: [], testAssociations: [], riskLevel: 'low' },
      },
    });
    const parsed = JSON.parse(formatJsonReport(report));
    expect(Object.keys(parsed.files)).toHaveLength(0);
  });

  it('should handle mixed severities', () => {
    const report = createReport({
      summary: {
        filesAnalyzed: 1,
        totalViolations: 2,
        bySeverity: { error: 1, warning: 1 },
        avgComplexity: 25,
        maxComplexity: 35,
      },
      files: {
        'src/complex.ts': {
          violations: [
            {
              filepath: 'src/complex.ts',
              startLine: 1,
              endLine: 20,
              symbolName: 'moderate',
              symbolType: 'function',
              language: 'typescript',
              complexity: 20,
              threshold: 15,
              severity: 'warning',
              message: 'Warning level',
              metricType: 'cyclomatic',
            },
            {
              filepath: 'src/complex.ts',
              startLine: 25,
              endLine: 60,
              symbolName: 'severe',
              symbolType: 'method',
              language: 'typescript',
              complexity: 35,
              threshold: 15,
              severity: 'error',
              message: 'Error level',
              metricType: 'cognitive',
            },
          ],
          dependents: ['src/app.ts'],
          testAssociations: ['src/complex.test.ts'],
          riskLevel: 'high',
        },
      },
    });
    const parsed = JSON.parse(formatJsonReport(report));
    expect(parsed.files['src/complex.ts'].violations).toHaveLength(2);
    const severities = parsed.files['src/complex.ts'].violations.map(
      (v: { severity: string }) => v.severity,
    );
    expect(severities).toContain('warning');
    expect(severities).toContain('error');
  });

  it('should preserve halsteadDetails when present', () => {
    const report = createReport({
      files: {
        'src/heavy.ts': {
          violations: [
            {
              filepath: 'src/heavy.ts',
              startLine: 1,
              endLine: 50,
              symbolName: 'heavyFn',
              symbolType: 'function',
              language: 'typescript',
              complexity: 200,
              threshold: 60,
              severity: 'error',
              message: 'Time to understand',
              metricType: 'halstead_effort',
              halsteadDetails: {
                volume: 5000,
                difficulty: 40,
                effort: 200000,
                bugs: 1.67,
              },
            },
          ],
          dependents: [],
          testAssociations: [],
          riskLevel: 'high',
        },
      },
    });
    const parsed = JSON.parse(formatJsonReport(report));
    const violation = parsed.files['src/heavy.ts'].violations[0];
    expect(violation.halsteadDetails).toEqual({
      volume: 5000,
      difficulty: 40,
      effort: 200000,
      bugs: 1.67,
    });
  });
});
