import { describe, it, expect } from 'vitest';
import { detectLogicFindings } from '../src/logic-review.js';
import type { CodeChunk } from '@liendev/parser';
import type { ComplexityReport } from '../src/types.js';

function createChunk(overrides: Partial<CodeChunk['metadata']> = {}, content = ''): CodeChunk {
  return {
    content,
    metadata: {
      file: 'src/auth.ts',
      startLine: 1,
      endLine: 20,
      type: 'function',
      language: 'typescript',
      symbolName: 'validateToken',
      symbolType: 'function',
      ...overrides,
    },
  };
}

function createReport(overrides: Partial<ComplexityReport> = {}): ComplexityReport {
  return {
    summary: {
      filesAnalyzed: 1,
      totalViolations: 0,
      bySeverity: { error: 0, warning: 0 },
      avgComplexity: 5,
      maxComplexity: 10,
    },
    files: {},
    ...overrides,
  };
}

function createViolation(symbolName: string, filepath = 'src/auth.ts') {
  return {
    filepath,
    symbolName,
    symbolType: 'function' as const,
    language: 'typescript',
    complexity: 5,
    threshold: 15,
    startLine: 1,
    endLine: 10,
    severity: 'warning' as const,
    message: `${symbolName} exceeds threshold`,
    metricType: 'cyclomatic' as const,
  };
}

describe('detectLogicFindings', () => {
  describe('missing_tests detection', () => {
    it('detects high-risk function with no tests', () => {
      const chunks = [
        createChunk({
          complexity: 15,
          file: 'src/auth.ts',
          symbolName: 'validateToken',
        }),
      ];
      const report = createReport({
        files: {
          'src/auth.ts': {
            violations: [],
            dependents: ['src/api.ts', 'src/middleware.ts', 'src/routes.ts'],
            dependentCount: 3,
            testAssociations: [],
            riskLevel: 'high',
          },
        },
      });

      const findings = detectLogicFindings(chunks, report, null, ['missing_tests']);
      expect(findings).toHaveLength(1);
      expect(findings[0].category).toBe('missing_tests');
      expect(findings[0].symbolName).toBe('validateToken');
    });

    it('does not flag function with tests', () => {
      const chunks = [createChunk({ complexity: 15, file: 'src/auth.ts' })];
      const report = createReport({
        files: {
          'src/auth.ts': {
            violations: [],
            dependents: ['src/api.ts', 'src/middleware.ts', 'src/routes.ts'],
            dependentCount: 3,
            testAssociations: ['test/auth.test.ts'],
            riskLevel: 'high',
          },
        },
      });

      const findings = detectLogicFindings(chunks, report, null, ['missing_tests']);
      expect(findings).toHaveLength(0);
    });

    it('does not flag low-complexity function', () => {
      const chunks = [createChunk({ complexity: 3, file: 'src/auth.ts' })];
      const report = createReport({
        files: {
          'src/auth.ts': {
            violations: [],
            dependents: ['a.ts', 'b.ts', 'c.ts'],
            dependentCount: 3,
            testAssociations: [],
            riskLevel: 'high',
          },
        },
      });

      const findings = detectLogicFindings(chunks, report, null, ['missing_tests']);
      expect(findings).toHaveLength(0);
    });

    it('does not flag function with few dependents', () => {
      const chunks = [createChunk({ complexity: 15, file: 'src/auth.ts' })];
      const report = createReport({
        files: {
          'src/auth.ts': {
            violations: [],
            dependents: ['a.ts'],
            dependentCount: 1,
            testAssociations: [],
            riskLevel: 'low',
          },
        },
      });

      const findings = detectLogicFindings(chunks, report, null, ['missing_tests']);
      expect(findings).toHaveLength(0);
    });
  });

  describe('unchecked_return detection', () => {
    it('detects standalone function call without assignment', () => {
      const content = 'function processData() {\n  validateInput(data);\n  return data;\n}';
      const chunks = [
        createChunk(
          {
            file: 'src/process.ts',
            symbolName: 'processData',
            startLine: 1,
            endLine: 4,
            callSites: [{ symbol: 'validateInput', line: 2 }],
          },
          content,
        ),
      ];
      const report = createReport();

      const findings = detectLogicFindings(chunks, report, null, ['unchecked_return']);
      expect(findings).toHaveLength(1);
      expect(findings[0].category).toBe('unchecked_return');
    });

    it('does not flag assigned function calls', () => {
      const content =
        'function processData() {\n  const result = validateInput(data);\n  return result;\n}';
      const chunks = [
        createChunk(
          {
            file: 'src/process.ts',
            symbolName: 'processData',
            startLine: 1,
            endLine: 4,
            callSites: [{ symbol: 'validateInput', line: 2 }],
          },
          content,
        ),
      ];
      const report = createReport();

      const findings = detectLogicFindings(chunks, report, null, ['unchecked_return']);
      expect(findings).toHaveLength(0);
    });

    it('does not flag property assignment', () => {
      const content =
        'function processData() {\n  obj.result = validateInput(data);\n  return obj;\n}';
      const chunks = [
        createChunk(
          {
            file: 'src/process.ts',
            symbolName: 'processData',
            startLine: 1,
            endLine: 4,
            callSites: [{ symbol: 'validateInput', line: 2 }],
          },
          content,
        ),
      ];
      const report = createReport();

      const findings = detectLogicFindings(chunks, report, null, ['unchecked_return']);
      expect(findings).toHaveLength(0);
    });

    it('does not flag chained method calls', () => {
      const content = 'function processData() {\n  fetchItems().then(handleResult);\n  return;\n}';
      const chunks = [
        createChunk(
          {
            file: 'src/process.ts',
            symbolName: 'processData',
            startLine: 1,
            endLine: 4,
            callSites: [{ symbol: 'fetchItems', line: 2 }],
          },
          content,
        ),
      ];
      const report = createReport();

      const findings = detectLogicFindings(chunks, report, null, ['unchecked_return']);
      expect(findings).toHaveLength(0);
    });

    it('does not flag return statements', () => {
      const content = 'function processData() {\n  return validateInput(data);\n}';
      const chunks = [
        createChunk(
          {
            file: 'src/process.ts',
            symbolName: 'processData',
            startLine: 1,
            endLine: 3,
            callSites: [{ symbol: 'validateInput', line: 2 }],
          },
          content,
        ),
      ];
      const report = createReport();

      const findings = detectLogicFindings(chunks, report, null, ['unchecked_return']);
      expect(findings).toHaveLength(0);
    });

    it('does not flag calls to void-returning functions', () => {
      const content = 'function caller() {\n  doSomething(data);\n  return;\n}';
      const chunks = [
        createChunk(
          {
            file: 'src/process.ts',
            symbolName: 'caller',
            startLine: 1,
            endLine: 4,
            callSites: [{ symbol: 'doSomething', line: 2 }],
          },
          content,
        ),
        createChunk({
          file: 'src/process.ts',
          symbolName: 'doSomething',
          returnType: 'void',
          startLine: 5,
          endLine: 8,
        }),
      ];
      const report = createReport();

      const findings = detectLogicFindings(chunks, report, null, ['unchecked_return']);
      expect(findings).toHaveLength(0);
    });

    it('does not flag this.method() calls to void-returning methods', () => {
      const content = 'function processEvent() {\n  this.notify(event);\n  return;\n}';
      const chunks = [
        createChunk(
          {
            file: 'src/events.ts',
            symbolName: 'processEvent',
            startLine: 1,
            endLine: 4,
            callSites: [{ symbol: 'notify', line: 2 }],
          },
          content,
        ),
        createChunk({
          file: 'src/events.ts',
          symbolName: 'notify',
          parentClass: 'EventManager',
          returnType: ': void',
          startLine: 5,
          endLine: 10,
        }),
      ];
      const report = createReport();

      const findings = detectLogicFindings(chunks, report, null, ['unchecked_return']);
      expect(findings).toHaveLength(0);
    });

    it('does not flag calls to Promise<void>-returning async functions', () => {
      const content = 'async function handler() {\n  await sendEmail(user);\n  return;\n}';
      const chunks = [
        createChunk(
          {
            file: 'src/handler.ts',
            symbolName: 'handler',
            startLine: 1,
            endLine: 4,
            callSites: [{ symbol: 'sendEmail', line: 2 }],
          },
          content,
        ),
        createChunk({
          file: 'src/handler.ts',
          symbolName: 'sendEmail',
          returnType: 'Promise<void>',
          startLine: 5,
          endLine: 10,
        }),
      ];
      const report = createReport();

      const findings = detectLogicFindings(chunks, report, null, ['unchecked_return']);
      expect(findings).toHaveLength(0);
    });

    it('does not flag await calls without assignment (side-effect pattern)', () => {
      const content = 'async function handler() {\n  await postComment(pr, body);\n  return;\n}';
      const chunks = [
        createChunk(
          {
            file: 'src/handler.ts',
            symbolName: 'handler',
            startLine: 1,
            endLine: 4,
            callSites: [{ symbol: 'postComment', line: 2 }],
          },
          content,
        ),
      ];
      const report = createReport();

      const findings = detectLogicFindings(chunks, report, null, ['unchecked_return']);
      expect(findings).toHaveLength(0);
    });

    it('does not flag compound assignment operators (+=, ||=)', () => {
      const content = 'function build() {\n  notes += buildSection(data);\n  return notes;\n}';
      const chunks = [
        createChunk(
          {
            file: 'src/build.ts',
            symbolName: 'build',
            startLine: 1,
            endLine: 4,
            callSites: [{ symbol: 'buildSection', line: 2 }],
          },
          content,
        ),
      ];
      const report = createReport();

      const findings = detectLogicFindings(chunks, report, null, ['unchecked_return']);
      expect(findings).toHaveLength(0);
    });

    it('does not flag calls used in binary expressions', () => {
      const content = 'function build() {\n  buildHeader(data) + buildFooter(data);\n  return;\n}';
      const chunks = [
        createChunk(
          {
            file: 'src/build.ts',
            symbolName: 'build',
            startLine: 1,
            endLine: 4,
            callSites: [{ symbol: 'buildHeader', line: 2 }],
          },
          content,
        ),
      ];
      const report = createReport();

      const findings = detectLogicFindings(chunks, report, null, ['unchecked_return']);
      expect(findings).toHaveLength(0);
    });

    it('still flags calls to non-void functions', () => {
      const content = 'function caller() {\n  getValue();\n  return;\n}';
      const chunks = [
        createChunk(
          {
            file: 'src/process.ts',
            symbolName: 'caller',
            startLine: 1,
            endLine: 4,
            callSites: [{ symbol: 'getValue', line: 2 }],
          },
          content,
        ),
        createChunk({
          file: 'src/process.ts',
          symbolName: 'getValue',
          returnType: 'string',
          startLine: 5,
          endLine: 8,
        }),
      ];
      const report = createReport();

      const findings = detectLogicFindings(chunks, report, null, ['unchecked_return']);
      expect(findings).toHaveLength(1);
    });

    it('still flags calls with unknown return type', () => {
      const content = 'function caller() {\n  mystery();\n  return;\n}';
      const chunks = [
        createChunk(
          {
            file: 'src/process.ts',
            symbolName: 'caller',
            startLine: 1,
            endLine: 4,
            callSites: [{ symbol: 'mystery', line: 2 }],
          },
          content,
        ),
        createChunk({
          file: 'src/process.ts',
          symbolName: 'mystery',
          startLine: 5,
          endLine: 8,
        }),
      ];
      const report = createReport();

      const findings = detectLogicFindings(chunks, report, null, ['unchecked_return']);
      expect(findings).toHaveLength(1);
    });
  });

  describe('breaking_change detection', () => {
    it('detects removed symbols with dependents', () => {
      const chunks = [
        createChunk({
          file: 'src/auth.ts',
          symbolName: 'newFunction',
          exports: ['newFunction'],
        }),
      ];
      const currentReport = createReport({
        files: {
          'src/auth.ts': {
            violations: [createViolation('newFunction')],
            dependents: ['src/api.ts'],
            dependentCount: 2,
            testAssociations: [],
            riskLevel: 'medium',
          },
        },
      });
      const baselineReport = createReport({
        files: {
          'src/auth.ts': {
            violations: [createViolation('validateToken'), createViolation('newFunction')],
            dependents: ['src/api.ts'],
            dependentCount: 2,
            testAssociations: [],
            riskLevel: 'medium',
          },
        },
      });

      const findings = detectLogicFindings(chunks, currentReport, baselineReport, [
        'breaking_change',
      ]);
      expect(findings.length).toBeGreaterThanOrEqual(1);
      expect(
        findings.some(f => f.category === 'breaking_change' && f.symbolName === 'validateToken'),
      ).toBe(true);
    });

    it('does not flag breaking changes without baseline', () => {
      const chunks = [createChunk()];
      const report = createReport();

      const findings = detectLogicFindings(chunks, report, null, ['breaking_change']);
      expect(findings).toHaveLength(0);
    });
  });

  describe('category filtering', () => {
    it('only runs enabled categories', () => {
      const chunks = [createChunk({ complexity: 15, file: 'src/auth.ts' })];
      const report = createReport({
        files: {
          'src/auth.ts': {
            violations: [],
            dependents: ['a.ts', 'b.ts', 'c.ts'],
            dependentCount: 3,
            testAssociations: [],
            riskLevel: 'high',
          },
        },
      });

      // Only enable breaking_change, not missing_tests
      const findings = detectLogicFindings(chunks, report, null, ['breaking_change']);
      expect(findings).toHaveLength(0); // No baseline, so no breaking changes
    });

    it('returns empty for no enabled categories', () => {
      const chunks = [createChunk({ complexity: 15 })];
      const report = createReport();
      const findings = detectLogicFindings(chunks, report, null, []);
      expect(findings).toHaveLength(0);
    });
  });
});
