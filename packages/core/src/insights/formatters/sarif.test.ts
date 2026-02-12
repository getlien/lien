import { describe, it, expect } from 'vitest';
import { formatSarifReport } from './sarif.js';
import type { ComplexityReport } from '../types.js';

function createReport(overrides: Partial<ComplexityReport> = {}): ComplexityReport {
  return {
    summary: {
      filesAnalyzed: 1,
      totalViolations: 1,
      bySeverity: { error: 0, warning: 1 },
      avgComplexity: 20,
      maxComplexity: 20,
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
    },
    ...overrides,
  };
}

describe('formatSarifReport', () => {
  it('should return valid JSON string', () => {
    const report = createReport();
    const result = formatSarifReport(report);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('should conform to SARIF 2.1.0 structure', () => {
    const report = createReport();
    const sarif = JSON.parse(formatSarifReport(report));
    expect(sarif.$schema).toContain('sarif-schema-2.1.0');
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs).toBeInstanceOf(Array);
    expect(sarif.runs).toHaveLength(1);
  });

  it('should have correct tool driver info', () => {
    const report = createReport();
    const sarif = JSON.parse(formatSarifReport(report));
    const driver = sarif.runs[0].tool.driver;
    expect(driver.name).toBe('Lien Complexity Analyzer');
    expect(driver.version).toEqual(expect.any(String));
    expect(driver.version.length).toBeGreaterThan(0);
    expect(driver.informationUri).toEqual(expect.any(String));
    expect(driver.informationUri.length).toBeGreaterThan(0);
  });

  it('should define all 4 rule types', () => {
    const report = createReport();
    const sarif = JSON.parse(formatSarifReport(report));
    const rules = sarif.runs[0].tool.driver.rules;
    expect(rules).toHaveLength(4);

    const ruleIds = rules.map((r: { id: string }) => r.id);
    expect(ruleIds).toContain('lien/high-cyclomatic-complexity');
    expect(ruleIds).toContain('lien/high-cognitive-complexity');
    expect(ruleIds).toContain('lien/high-halstead-effort');
    expect(ruleIds).toContain('lien/high-estimated-bugs');
  });

  it('should have shortDescription, fullDescription, and help for each rule', () => {
    const report = createReport();
    const sarif = JSON.parse(formatSarifReport(report));
    const rules = sarif.runs[0].tool.driver.rules;

    for (const rule of rules) {
      expect(rule.shortDescription).toBeDefined();
      expect(rule.shortDescription.text).toBeTruthy();
      expect(rule.fullDescription).toBeDefined();
      expect(rule.fullDescription.text).toBeTruthy();
      expect(rule.help).toBeDefined();
      expect(rule.help.text).toBeTruthy();
    }
  });

  it('should map cyclomatic violations to correct ruleId', () => {
    const report = createReport();
    const sarif = JSON.parse(formatSarifReport(report));
    const result = sarif.runs[0].results[0];
    expect(result.ruleId).toBe('lien/high-cyclomatic-complexity');
  });

  it('should map cognitive violations to correct ruleId', () => {
    const report = createReport({
      files: {
        'src/test.ts': {
          violations: [
            {
              filepath: 'src/test.ts',
              startLine: 1,
              endLine: 20,
              symbolName: 'nested',
              symbolType: 'function',
              language: 'typescript',
              complexity: 25,
              threshold: 15,
              severity: 'error',
              message: 'Mental load too high',
              metricType: 'cognitive',
            },
          ],
          dependents: [],
          testAssociations: [],
          riskLevel: 'high',
        },
      },
    });
    const sarif = JSON.parse(formatSarifReport(report));
    expect(sarif.runs[0].results[0].ruleId).toBe('lien/high-cognitive-complexity');
  });

  it('should map halstead_effort violations to correct ruleId', () => {
    const report = createReport({
      files: {
        'src/test.ts': {
          violations: [
            {
              filepath: 'src/test.ts',
              startLine: 1,
              endLine: 50,
              symbolName: 'heavy',
              symbolType: 'function',
              language: 'typescript',
              complexity: 200,
              threshold: 60,
              severity: 'warning',
              message: 'Time to understand',
              metricType: 'halstead_effort',
            },
          ],
          dependents: [],
          testAssociations: [],
          riskLevel: 'medium',
        },
      },
    });
    const sarif = JSON.parse(formatSarifReport(report));
    expect(sarif.runs[0].results[0].ruleId).toBe('lien/high-halstead-effort');
  });

  it('should map halstead_bugs violations to correct ruleId', () => {
    const report = createReport({
      files: {
        'src/test.ts': {
          violations: [
            {
              filepath: 'src/test.ts',
              startLine: 1,
              endLine: 100,
              symbolName: 'buggy',
              symbolType: 'function',
              language: 'typescript',
              complexity: 2.5,
              threshold: 1.5,
              severity: 'warning',
              message: 'Estimated bugs',
              metricType: 'halstead_bugs',
            },
          ],
          dependents: [],
          testAssociations: [],
          riskLevel: 'medium',
        },
      },
    });
    const sarif = JSON.parse(formatSarifReport(report));
    expect(sarif.runs[0].results[0].ruleId).toBe('lien/high-estimated-bugs');
  });

  it('should use fallback ruleId for unknown metric types', () => {
    const report = createReport({
      files: {
        'src/test.ts': {
          violations: [
            {
              filepath: 'src/test.ts',
              startLine: 1,
              endLine: 10,
              symbolName: 'unknown',
              symbolType: 'function',
              language: 'typescript',
              complexity: 20,
              threshold: 15,
              severity: 'warning',
              message: 'Unknown metric',
              metricType: 'unknown_metric' as any,
            },
          ],
          dependents: [],
          testAssociations: [],
          riskLevel: 'low',
        },
      },
    });
    const sarif = JSON.parse(formatSarifReport(report));
    expect(sarif.runs[0].results[0].ruleId).toBe('lien/high-complexity');
  });

  it('should include correct location data', () => {
    const report = createReport();
    const sarif = JSON.parse(formatSarifReport(report));
    const result = sarif.runs[0].results[0];
    const location = result.locations[0].physicalLocation;
    expect(location.artifactLocation.uri).toBe('src/utils.ts');
    expect(location.region.startLine).toBe(10);
    expect(location.region.endLine).toBe(40);
  });

  it('should include symbolName in result message', () => {
    const report = createReport();
    const sarif = JSON.parse(formatSarifReport(report));
    const result = sarif.runs[0].results[0];
    expect(result.message.text).toContain('processData');
  });

  it('should map severity correctly', () => {
    const report = createReport({
      files: {
        'src/a.ts': {
          violations: [
            {
              filepath: 'src/a.ts',
              startLine: 1,
              endLine: 10,
              symbolName: 'warn',
              symbolType: 'function',
              language: 'typescript',
              complexity: 20,
              threshold: 15,
              severity: 'warning',
              message: 'Warning',
              metricType: 'cyclomatic',
            },
            {
              filepath: 'src/a.ts',
              startLine: 15,
              endLine: 30,
              symbolName: 'err',
              symbolType: 'function',
              language: 'typescript',
              complexity: 35,
              threshold: 15,
              severity: 'error',
              message: 'Error',
              metricType: 'cyclomatic',
            },
          ],
          dependents: [],
          testAssociations: [],
          riskLevel: 'high',
        },
      },
    });
    const sarif = JSON.parse(formatSarifReport(report));
    const results = sarif.runs[0].results;
    expect(results[0].level).toBe('warning');
    expect(results[1].level).toBe('error');
  });

  it('should handle empty report with no violations', () => {
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
    const sarif = JSON.parse(formatSarifReport(report));
    expect(sarif.runs[0].results).toHaveLength(0);
    // Rules should still be defined even with no results
    expect(sarif.runs[0].tool.driver.rules).toHaveLength(4);
  });

  it('should handle multiple files with multiple violations', () => {
    const report = createReport({
      files: {
        'src/a.ts': {
          violations: [
            {
              filepath: 'src/a.ts',
              startLine: 1,
              endLine: 10,
              symbolName: 'fn1',
              symbolType: 'function',
              language: 'typescript',
              complexity: 20,
              threshold: 15,
              severity: 'warning',
              message: 'Cyclomatic',
              metricType: 'cyclomatic',
            },
          ],
          dependents: [],
          testAssociations: [],
          riskLevel: 'low',
        },
        'src/b.ts': {
          violations: [
            {
              filepath: 'src/b.ts',
              startLine: 5,
              endLine: 25,
              symbolName: 'fn2',
              symbolType: 'method',
              language: 'typescript',
              complexity: 30,
              threshold: 15,
              severity: 'error',
              message: 'Cognitive',
              metricType: 'cognitive',
            },
            {
              filepath: 'src/b.ts',
              startLine: 30,
              endLine: 80,
              symbolName: 'fn3',
              symbolType: 'function',
              language: 'typescript',
              complexity: 200,
              threshold: 60,
              severity: 'warning',
              message: 'Halstead',
              metricType: 'halstead_effort',
            },
          ],
          dependents: [],
          testAssociations: [],
          riskLevel: 'high',
        },
      },
    });
    const sarif = JSON.parse(formatSarifReport(report));
    expect(sarif.runs[0].results).toHaveLength(3);
  });

  it('should skip files with empty violations arrays', () => {
    const report = createReport({
      files: {
        'src/clean.ts': {
          violations: [],
          dependents: [],
          testAssociations: [],
          riskLevel: 'low',
        },
        'src/dirty.ts': {
          violations: [
            {
              filepath: 'src/dirty.ts',
              startLine: 1,
              endLine: 10,
              symbolName: 'fn',
              symbolType: 'function',
              language: 'typescript',
              complexity: 20,
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
    const sarif = JSON.parse(formatSarifReport(report));
    // Only the dirty.ts violation should appear
    expect(sarif.runs[0].results).toHaveLength(1);
    expect(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri).toBe(
      'src/dirty.ts',
    );
  });
});
