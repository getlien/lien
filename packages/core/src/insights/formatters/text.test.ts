import { describe, it, expect } from 'vitest';
import { formatTextReport } from './text.js';
import type { ComplexityReport } from '../types.js';

function createReport(overrides: Partial<ComplexityReport> = {}): ComplexityReport {
  return {
    summary: {
      filesAnalyzed: 2,
      totalViolations: 2,
      bySeverity: { error: 1, warning: 1 },
      avgComplexity: 15,
      maxComplexity: 35,
    },
    files: {
      'src/utils.ts': {
        violations: [
          {
            filepath: 'src/utils.ts',
            startLine: 10,
            endLine: 40,
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
      'src/complex.ts': {
        violations: [
          {
            filepath: 'src/complex.ts',
            startLine: 5,
            endLine: 60,
            symbolName: 'handleRequest',
            symbolType: 'method',
            language: 'typescript',
            complexity: 35,
            threshold: 15,
            severity: 'error',
            message: 'Too many test cases',
            metricType: 'cyclomatic',
          },
        ],
        dependents: ['src/app.ts'],
        testAssociations: [],
        riskLevel: 'high',
      },
    },
    ...overrides,
  };
}

describe('formatTextReport', () => {
  it('should return a string', () => {
    const report = createReport();
    const result = formatTextReport(report);
    expect(typeof result).toBe('string');
  });

  it('should include header', () => {
    const report = createReport();
    const result = formatTextReport(report);
    expect(result).toContain('Complexity Analysis');
  });

  it('should include summary section', () => {
    const report = createReport();
    const result = formatTextReport(report);
    expect(result).toContain('Summary:');
    expect(result).toContain('Files analyzed:');
    expect(result).toContain('2');
    expect(result).toContain('Violations:');
    expect(result).toContain('Average complexity:');
    expect(result).toContain('Max complexity:');
  });

  it('should show error and warning counts in summary', () => {
    const report = createReport();
    const result = formatTextReport(report);
    expect(result).toContain('1 error');
    expect(result).toContain('1 warning');
  });

  it('should pluralize correctly for multiple errors/warnings', () => {
    const report = createReport({
      summary: {
        filesAnalyzed: 3,
        totalViolations: 5,
        bySeverity: { error: 3, warning: 2 },
        avgComplexity: 20,
        maxComplexity: 40,
      },
    });
    const result = formatTextReport(report);
    expect(result).toContain('3 errors');
    expect(result).toContain('2 warnings');
  });

  it('should separate errors and warnings into sections', () => {
    const report = createReport();
    const result = formatTextReport(report);
    expect(result).toContain('Errors:');
    expect(result).toContain('Warnings:');
  });

  it('should include file path and line number for violations', () => {
    const report = createReport();
    const result = formatTextReport(report);
    expect(result).toContain('src/complex.ts:5');
    expect(result).toContain('src/utils.ts:10');
  });

  it('should append () to function/method names', () => {
    const report = createReport();
    const result = formatTextReport(report);
    expect(result).toContain('processData()');
    expect(result).toContain('handleRequest()');
  });

  it('should not append () to class symbol names', () => {
    const report = createReport({
      files: {
        'src/big-class.ts': {
          violations: [
            {
              filepath: 'src/big-class.ts',
              startLine: 1,
              endLine: 200,
              symbolName: 'BigController',
              symbolType: 'class',
              language: 'typescript',
              complexity: 25,
              threshold: 15,
              severity: 'warning',
              message: 'Complex class',
              metricType: 'cognitive',
            },
          ],
          dependents: [],
          testAssociations: [],
          riskLevel: 'medium',
        },
      },
    });
    const result = formatTextReport(report);
    expect(result).toContain('BigController');
    expect(result).not.toContain('BigController()');
  });

  it('should show risk level for each violation', () => {
    const report = createReport();
    const result = formatTextReport(report);
    expect(result).toContain('Risk:');
    expect(result).toContain('HIGH');
    expect(result).toContain('LOW');
  });

  it('should show percentage over threshold', () => {
    const report = createReport();
    const result = formatTextReport(report);
    // 20 over 15 = 33% over threshold
    expect(result).toContain('33% over threshold');
    // 35 over 15 = 133% over threshold
    expect(result).toContain('133% over threshold');
  });

  it('should show no violations message when report has no violations', () => {
    const report = createReport({
      summary: {
        filesAnalyzed: 5,
        totalViolations: 0,
        bySeverity: { error: 0, warning: 0 },
        avgComplexity: 5,
        maxComplexity: 10,
      },
      files: {
        'src/clean.ts': {
          violations: [],
          dependents: [],
          testAssociations: [],
          riskLevel: 'low',
        },
      },
    });
    const result = formatTextReport(report);
    expect(result).toContain('No violations found');
  });

  it('should sort files by violation count (most first)', () => {
    const report = createReport({
      files: {
        'src/few.ts': {
          violations: [
            {
              filepath: 'src/few.ts',
              startLine: 1,
              endLine: 10,
              symbolName: 'one',
              symbolType: 'function',
              language: 'typescript',
              complexity: 20,
              threshold: 15,
              severity: 'warning',
              message: 'Single violation',
              metricType: 'cyclomatic',
            },
          ],
          dependents: [],
          testAssociations: [],
          riskLevel: 'low',
        },
        'src/many.ts': {
          violations: [
            {
              filepath: 'src/many.ts',
              startLine: 1,
              endLine: 10,
              symbolName: 'a',
              symbolType: 'function',
              language: 'typescript',
              complexity: 20,
              threshold: 15,
              severity: 'warning',
              message: 'First',
              metricType: 'cyclomatic',
            },
            {
              filepath: 'src/many.ts',
              startLine: 15,
              endLine: 30,
              symbolName: 'b',
              symbolType: 'function',
              language: 'typescript',
              complexity: 25,
              threshold: 15,
              severity: 'warning',
              message: 'Second',
              metricType: 'cyclomatic',
            },
          ],
          dependents: [],
          testAssociations: [],
          riskLevel: 'medium',
        },
      },
    });
    const result = formatTextReport(report);
    // src/many.ts has more violations and should appear first
    const manyIdx = result.indexOf('src/many.ts');
    const fewIdx = result.indexOf('src/few.ts');
    expect(manyIdx).toBeLessThan(fewIdx);
  });

  it('should show dependency info when dependents exist', () => {
    const report = createReport();
    const result = formatTextReport(report);
    expect(result).toContain('Imported by 1 file');
  });

  it('should pluralize dependency count correctly', () => {
    const report = createReport({
      files: {
        'src/shared.ts': {
          violations: [
            {
              filepath: 'src/shared.ts',
              startLine: 1,
              endLine: 20,
              symbolName: 'shared',
              symbolType: 'function',
              language: 'typescript',
              complexity: 20,
              threshold: 15,
              severity: 'warning',
              message: 'Complex',
              metricType: 'cyclomatic',
            },
          ],
          dependents: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
          testAssociations: [],
          riskLevel: 'high',
        },
      },
    });
    const result = formatTextReport(report);
    expect(result).toContain('Imported by 3 files');
  });

  it('should show cyclomatic metric with test count hint', () => {
    const report = createReport({
      files: {
        'src/test.ts': {
          violations: [
            {
              filepath: 'src/test.ts',
              startLine: 1,
              endLine: 20,
              symbolName: 'fn',
              symbolType: 'function',
              language: 'typescript',
              complexity: 25,
              threshold: 15,
              severity: 'warning',
              message: 'Complex',
              metricType: 'cyclomatic',
            },
          ],
          dependents: [],
          testAssociations: [],
          riskLevel: 'low',
        },
      },
    });
    const result = formatTextReport(report);
    expect(result).toContain('25 (needs ~25 tests)');
  });

  it('should show halstead details when present', () => {
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
              complexity: 120,
              threshold: 60,
              severity: 'warning',
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
          riskLevel: 'medium',
        },
      },
    });
    const result = formatTextReport(report);
    expect(result).toContain('Volume:');
    expect(result).toContain('Difficulty:');
    expect(result).toContain('Time:');
    expect(result).toContain('Est. bugs:');
  });

  it('should show dependent complexity metrics when available', () => {
    const report = createReport({
      files: {
        'src/shared.ts': {
          violations: [
            {
              filepath: 'src/shared.ts',
              startLine: 1,
              endLine: 20,
              symbolName: 'shared',
              symbolType: 'function',
              language: 'typescript',
              complexity: 20,
              threshold: 15,
              severity: 'warning',
              message: 'Complex',
              metricType: 'cyclomatic',
            },
          ],
          dependents: ['src/a.ts'],
          dependentCount: 1,
          testAssociations: [],
          riskLevel: 'medium',
          dependentComplexityMetrics: {
            averageComplexity: 12,
            maxComplexity: 18,
            filesWithComplexityData: 1,
          },
        },
      },
    });
    const result = formatTextReport(report);
    expect(result).toContain('Dependent avg complexity: 12');
    expect(result).toContain('max: 18');
  });

  it('should handle empty files object', () => {
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
    const result = formatTextReport(report);
    expect(result).toContain('No violations found');
  });

  it('should handle report with only errors (no warnings)', () => {
    const report = createReport({
      summary: {
        filesAnalyzed: 1,
        totalViolations: 1,
        bySeverity: { error: 1, warning: 0 },
        avgComplexity: 35,
        maxComplexity: 35,
      },
      files: {
        'src/error.ts': {
          violations: [
            {
              filepath: 'src/error.ts',
              startLine: 1,
              endLine: 20,
              symbolName: 'badFn',
              symbolType: 'function',
              language: 'typescript',
              complexity: 35,
              threshold: 15,
              severity: 'error',
              message: 'Very complex',
              metricType: 'cyclomatic',
            },
          ],
          dependents: [],
          testAssociations: [],
          riskLevel: 'high',
        },
      },
    });
    const result = formatTextReport(report);
    expect(result).toContain('Errors:');
    expect(result).not.toContain('Warnings:');
  });

  it('should handle report with only warnings (no errors)', () => {
    const report = createReport({
      summary: {
        filesAnalyzed: 1,
        totalViolations: 1,
        bySeverity: { error: 0, warning: 1 },
        avgComplexity: 20,
        maxComplexity: 20,
      },
      files: {
        'src/warn.ts': {
          violations: [
            {
              filepath: 'src/warn.ts',
              startLine: 1,
              endLine: 20,
              symbolName: 'okFn',
              symbolType: 'function',
              language: 'typescript',
              complexity: 20,
              threshold: 15,
              severity: 'warning',
              message: 'Moderate',
              metricType: 'cyclomatic',
            },
          ],
          dependents: [],
          testAssociations: [],
          riskLevel: 'low',
        },
      },
    });
    const result = formatTextReport(report);
    expect(result).not.toContain('Errors:');
    expect(result).toContain('Warnings:');
  });
});
