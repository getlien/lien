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
  it('should include header and summary', () => {
    const result = formatTextReport(createReport());
    expect(result).toContain('Complexity Analysis');
    expect(result).toContain('Summary:');
    expect(result).toContain('Files analyzed:');
    expect(result).toContain('1 error');
    expect(result).toContain('1 warning');
  });

  it('should separate errors and warnings with file:line locations', () => {
    const result = formatTextReport(createReport());
    expect(result).toContain('Errors:');
    expect(result).toContain('Warnings:');
    expect(result).toContain('src/complex.ts:5');
    expect(result).toContain('src/utils.ts:10');
  });

  it('should append () to function/method names but not classes', () => {
    const report = createReport({
      files: {
        'src/a.ts': {
          violations: [
            {
              filepath: 'src/a.ts',
              startLine: 1,
              endLine: 20,
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

    const defaultResult = formatTextReport(createReport());
    expect(defaultResult).toContain('processData()');
    expect(defaultResult).toContain('handleRequest()');
  });

  it('should show risk level, percentage over threshold, and dependency info', () => {
    const result = formatTextReport(createReport());
    expect(result).toContain('Risk:');
    expect(result).toContain('HIGH');
    expect(result).toContain('133% over threshold'); // 35 over 15
    expect(result).toContain('Imported by 1 file');
  });

  it('should show no violations message for clean report', () => {
    const result = formatTextReport(
      createReport({
        summary: {
          filesAnalyzed: 5,
          totalViolations: 0,
          bySeverity: { error: 0, warning: 0 },
          avgComplexity: 5,
          maxComplexity: 10,
        },
        files: {},
      }),
    );
    expect(result).toContain('No violations found');
  });

  it('should show cyclomatic test count hint', () => {
    const result = formatTextReport(createReport());
    expect(result).toContain('needs ~20 tests');
  });
});
