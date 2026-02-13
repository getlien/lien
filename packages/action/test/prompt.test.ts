import { describe, it, expect } from 'vitest';
import {
  buildNoViolationsMessage,
  getViolationKey,
  buildBatchedCommentsPrompt,
  buildDescriptionBadge,
  buildHeaderLine,
} from '@liendev/review';
import type { DeltaSummary, ComplexityReport, PRContext, ComplexityDelta } from '@liendev/review';

const mockPRContext: PRContext = {
  owner: 'testowner',
  repo: 'testrepo',
  pullNumber: 42,
  title: 'feat: add new feature',
  baseSha: 'abc123',
  headSha: 'def456',
};

const mockReport: ComplexityReport = {
  summary: {
    filesAnalyzed: 2,
    totalViolations: 3,
    bySeverity: { error: 1, warning: 2 },
    avgComplexity: 15.5,
    maxComplexity: 23,
  },
  files: {
    'src/utils.ts': {
      violations: [
        {
          filepath: 'src/utils.ts',
          startLine: 10,
          endLine: 50,
          symbolName: 'processData',
          symbolType: 'function',
          language: 'typescript',
          complexity: 23,
          threshold: 15,
          severity: 'error',
          message: 'Function complexity 23 exceeds threshold 15',
        },
        {
          filepath: 'src/utils.ts',
          startLine: 60,
          endLine: 80,
          symbolName: 'validateInput',
          symbolType: 'function',
          language: 'typescript',
          complexity: 12,
          threshold: 15,
          severity: 'warning',
          message: 'Function complexity 12 exceeds threshold 15',
        },
      ],
      dependents: [],
      testAssociations: [],
      riskLevel: 'high',
    },
    'src/handler.ts': {
      violations: [
        {
          filepath: 'src/handler.ts',
          startLine: 5,
          endLine: 25,
          symbolName: 'handleRequest',
          symbolType: 'function',
          language: 'typescript',
          complexity: 11,
          threshold: 15,
          severity: 'warning',
          message: 'Function complexity 11 exceeds threshold 15',
        },
      ],
      dependents: [],
      testAssociations: [],
      riskLevel: 'medium',
    },
  },
};

describe('prompt', () => {
  describe('buildNoViolationsMessage', () => {
    it('should include PR number', () => {
      const message = buildNoViolationsMessage(mockPRContext);

      expect(message).toContain('#42');
      expect(message).toContain('No complexity violations');
    });

    it('should include the comment marker', () => {
      const message = buildNoViolationsMessage(mockPRContext);

      expect(message).toContain('<!-- lien-ai-review -->');
    });
  });

  describe('getViolationKey', () => {
    it('should create a key from filepath and symbol name', () => {
      const violation = mockReport.files['src/utils.ts'].violations[0];
      const key = getViolationKey(violation);

      expect(key).toBe('src/utils.ts::processData');
    });
  });

  describe('buildBatchedCommentsPrompt', () => {
    it('should include all violations in the prompt', () => {
      const violations = [
        mockReport.files['src/utils.ts'].violations[0],
        mockReport.files['src/handler.ts'].violations[0],
      ];
      const codeSnippets = new Map<string, string>();

      const prompt = buildBatchedCommentsPrompt(violations, codeSnippets, mockReport);

      expect(prompt).toContain('processData');
      expect(prompt).toContain('handleRequest');
      // Violations without metricType default to 'cyclomatic' → 'test paths'
      expect(prompt).toContain('23 tests');
      expect(prompt).toContain('11');
    });

    it('should include code snippets when provided', () => {
      const violations = [mockReport.files['src/utils.ts'].violations[0]];
      const codeSnippets = new Map<string, string>();
      codeSnippets.set('src/utils.ts::processData', 'function processData() {}');

      const prompt = buildBatchedCommentsPrompt(violations, codeSnippets, mockReport);

      expect(prompt).toContain('function processData() {}');
    });

    it('should include JSON response format with correct keys', () => {
      const violations = [
        mockReport.files['src/utils.ts'].violations[0],
        mockReport.files['src/handler.ts'].violations[0],
      ];

      const prompt = buildBatchedCommentsPrompt(violations, new Map(), mockReport);

      expect(prompt).toContain('"src/utils.ts::processData"');
      expect(prompt).toContain('"src/handler.ts::handleRequest"');
      expect(prompt).toContain('Respond with ONLY valid JSON');
    });

    it('should include dependency context when file has dependents', () => {
      const reportWithDependents: ComplexityReport = {
        summary: {
          filesAnalyzed: 1,
          totalViolations: 1,
          bySeverity: { error: 1, warning: 0 },
          avgComplexity: 20.0,
          maxComplexity: 20,
        },
        files: {
          'src/auth.ts': {
            violations: [
              {
                filepath: 'src/auth.ts',
                startLine: 10,
                endLine: 50,
                symbolName: 'validateToken',
                symbolType: 'function',
                language: 'typescript',
                complexity: 20,
                threshold: 15,
                severity: 'error',
                message: 'Complexity exceeds threshold',
                metricType: 'cyclomatic',
              },
            ],
            dependents: ['src/api/login.ts', 'src/middleware/auth.ts'],
            dependentCount: 12,
            testAssociations: [],
            riskLevel: 'high',
            dependentComplexityMetrics: {
              averageComplexity: 8.5,
              maxComplexity: 15,
              filesWithComplexityData: 10,
            },
          },
        },
      };

      const violations = [reportWithDependents.files['src/auth.ts'].violations[0]];
      const prompt = buildBatchedCommentsPrompt(violations, new Map(), reportWithDependents);

      expect(prompt).toContain('**Dependency Impact**:');
      expect(prompt).toContain('12 file(s) import this');
      expect(prompt).toContain('src/api/login.ts');
      expect(prompt).toContain('Dependent complexity');
    });
  });

  describe('buildBatchedCommentsPrompt - few-shot examples', () => {
    it('should include cyclomatic example when violations are mostly cyclomatic', () => {
      const violations = [
        {
          filepath: 'src/test.ts',
          startLine: 1,
          endLine: 20,
          symbolName: 'func1',
          symbolType: 'function',
          language: 'typescript',
          complexity: 20,
          threshold: 15,
          severity: 'error',
          message: 'Too complex',
          metricType: 'cyclomatic',
        },
        {
          filepath: 'src/test.ts',
          startLine: 21,
          endLine: 40,
          symbolName: 'func2',
          symbolType: 'function',
          language: 'typescript',
          complexity: 18,
          threshold: 15,
          severity: 'warning',
          message: 'Too complex',
          metricType: 'cyclomatic',
        },
      ];

      const prompt = buildBatchedCommentsPrompt(violations, new Map(), mockReport);

      expect(prompt).toContain('Example of a good comment:');
      expect(prompt).toContain('permission cases');
      expect(prompt).toContain('checkAdminAccess');
    });

    it('should include cognitive example when violations are mostly cognitive', () => {
      const violations = [
        {
          filepath: 'src/test.ts',
          startLine: 1,
          endLine: 20,
          symbolName: 'func1',
          symbolType: 'function',
          language: 'typescript',
          complexity: 25,
          threshold: 15,
          severity: 'error',
          message: 'Too complex',
          metricType: 'cognitive',
        },
        {
          filepath: 'src/test.ts',
          startLine: 21,
          endLine: 40,
          symbolName: 'func2',
          symbolType: 'function',
          language: 'typescript',
          complexity: 20,
          threshold: 15,
          severity: 'warning',
          message: 'Too complex',
          metricType: 'cognitive',
        },
      ];

      const prompt = buildBatchedCommentsPrompt(violations, new Map(), mockReport);

      expect(prompt).toContain('Example of a good comment:');
      expect(prompt).toContain('levels of nesting');
      expect(prompt).toContain('guard clauses');
    });

    it('should pick most common metric when multiple types exist', () => {
      const violations = [
        {
          filepath: 'src/test.ts',
          startLine: 1,
          endLine: 20,
          symbolName: 'func1',
          symbolType: 'function',
          language: 'typescript',
          complexity: 20,
          threshold: 15,
          severity: 'error',
          message: 'Too complex',
          metricType: 'cognitive',
        },
        {
          filepath: 'src/test.ts',
          startLine: 21,
          endLine: 40,
          symbolName: 'func2',
          symbolType: 'function',
          language: 'typescript',
          complexity: 18,
          threshold: 15,
          severity: 'warning',
          message: 'Too complex',
          metricType: 'cognitive',
        },
        {
          filepath: 'src/test.ts',
          startLine: 41,
          endLine: 60,
          symbolName: 'func3',
          symbolType: 'function',
          language: 'typescript',
          complexity: 16,
          threshold: 15,
          severity: 'warning',
          message: 'Too complex',
          metricType: 'cyclomatic',
        },
      ];

      const prompt = buildBatchedCommentsPrompt(violations, new Map(), mockReport);

      // Should use cognitive example (2 cognitive vs 1 cyclomatic)
      expect(prompt).toContain('Example of a good comment:');
      expect(prompt).toContain('levels of nesting');
      expect(prompt).toContain('guard clauses');
    });
  });

  describe('buildDescriptionBadge', () => {
    it('should show improved when complexity reduced even with pre-existing violations', () => {
      const deltaSummary: DeltaSummary = {
        totalDelta: -15,
        improved: 2,
        degraded: 0,
        newFunctions: 0,
        deletedFunctions: 1,
        unchanged: 0,
      };

      const badge = buildDescriptionBadge(mockReport, deltaSummary, null);

      expect(badge).toContain('### 👁️ Veille');
      expect(badge).toContain('✅ **Improved!**');
      expect(badge).toContain('pre-existing');
    });

    it('should show stable when pre-existing violations but no new ones', () => {
      const badge = buildDescriptionBadge(mockReport, null, null);

      expect(badge).toContain('➡️ **Stable**');
      expect(badge).toContain('pre-existing');
    });

    it('should show good when no violations and no delta change', () => {
      const cleanReport: ComplexityReport = {
        summary: {
          filesAnalyzed: 5,
          totalViolations: 0,
          bySeverity: { error: 0, warning: 0 },
          avgComplexity: 5.0,
          maxComplexity: 8,
        },
        files: {},
      };

      const badge = buildDescriptionBadge(cleanReport, null, null);

      expect(badge).toContain('✅ **Good**');
      expect(badge).toContain('No complexity issues found');
    });
  });

  describe('buildHeaderLine', () => {
    it('should fall back to total count when no deltas', () => {
      const header = buildHeaderLine(7, null);
      expect(header).toBe('7 issues spotted in this PR.');
    });

    it('should fall back to total count with empty deltas', () => {
      const header = buildHeaderLine(3, []);
      expect(header).toBe('3 issues spotted in this PR.');
    });

    it('should handle singular issue', () => {
      const header = buildHeaderLine(1, null);
      expect(header).toBe('1 issue spotted in this PR.');
    });

    it('should show "No new complexity" when all violations are pre-existing (delta=0)', () => {
      const deltas: ComplexityDelta[] = [
        {
          filepath: 'a.ts',
          symbolName: 'fn1',
          symbolType: 'function',
          startLine: 1,
          metricType: 'cyclomatic',
          baseComplexity: 20,
          headComplexity: 20,
          delta: 0,
          threshold: 15,
          severity: 'warning',
        },
        {
          filepath: 'a.ts',
          symbolName: 'fn2',
          symbolType: 'function',
          startLine: 10,
          metricType: 'cognitive',
          baseComplexity: 18,
          headComplexity: 18,
          delta: 0,
          threshold: 15,
          severity: 'warning',
        },
      ];
      const header = buildHeaderLine(2, deltas);
      expect(header).toContain('No new complexity introduced.');
      expect(header).toContain('2 pre-existing issues in touched files.');
    });

    it('should show new count when PR introduces new violations', () => {
      const deltas: ComplexityDelta[] = [
        {
          filepath: 'a.ts',
          symbolName: 'fn1',
          symbolType: 'function',
          startLine: 1,
          metricType: 'cyclomatic',
          baseComplexity: null,
          headComplexity: 20,
          delta: 20,
          threshold: 15,
          severity: 'new',
        },
        {
          filepath: 'a.ts',
          symbolName: 'fn2',
          symbolType: 'function',
          startLine: 10,
          metricType: 'cognitive',
          baseComplexity: 18,
          headComplexity: 18,
          delta: 0,
          threshold: 15,
          severity: 'warning',
        },
      ];
      const header = buildHeaderLine(2, deltas);
      expect(header).toContain('1 new issue spotted in this PR.');
      expect(header).toContain('1 pre-existing issue in touched files.');
    });

    it('should count worsened violations as new', () => {
      const deltas: ComplexityDelta[] = [
        {
          filepath: 'a.ts',
          symbolName: 'fn1',
          symbolType: 'function',
          startLine: 1,
          metricType: 'cyclomatic',
          baseComplexity: 16,
          headComplexity: 25,
          delta: 9,
          threshold: 15,
          severity: 'warning',
        },
        {
          filepath: 'a.ts',
          symbolName: 'fn2',
          symbolType: 'function',
          startLine: 10,
          metricType: 'cognitive',
          baseComplexity: 12,
          headComplexity: 18,
          delta: 6,
          threshold: 15,
          severity: 'error',
        },
      ];
      const header = buildHeaderLine(2, deltas);
      expect(header).toContain('2 new issues spotted in this PR.');
      expect(header).not.toContain('pre-existing');
    });

    it('should note improved functions', () => {
      const deltas: ComplexityDelta[] = [
        {
          filepath: 'a.ts',
          symbolName: 'fn1',
          symbolType: 'function',
          startLine: 1,
          metricType: 'cyclomatic',
          baseComplexity: 25,
          headComplexity: 18,
          delta: -7,
          threshold: 15,
          severity: 'improved',
        },
        {
          filepath: 'a.ts',
          symbolName: 'fn2',
          symbolType: 'function',
          startLine: 10,
          metricType: 'cognitive',
          baseComplexity: 18,
          headComplexity: 18,
          delta: 0,
          threshold: 15,
          severity: 'warning',
        },
      ];
      const header = buildHeaderLine(2, deltas);
      expect(header).toContain('No new complexity introduced.');
      expect(header).toContain('1 function improved.');
      expect(header).toContain('pre-existing');
    });
  });
});
