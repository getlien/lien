import { describe, it, expect } from 'vitest';
import {
  buildReviewPrompt,
  buildNoViolationsMessage,
  formatReviewComment,
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
  describe('buildReviewPrompt', () => {
    it('should build a prompt with PR context', () => {
      const codeSnippets = new Map<string, string>();
      codeSnippets.set(
        'src/utils.ts::processData',
        'function processData() { /* complex code */ }',
      );

      const prompt = buildReviewPrompt(mockReport, mockPRContext, codeSnippets);

      expect(prompt).toContain('testowner/testrepo');
      expect(prompt).toContain('#42');
      expect(prompt).toContain('feat: add new feature');
      expect(prompt).toContain('3'); // total violations
    });

    it('should include violations summary', () => {
      const prompt = buildReviewPrompt(mockReport, mockPRContext, new Map());

      expect(prompt).toContain('src/utils.ts');
      expect(prompt).toContain('processData');
      expect(prompt).toContain('complexity 23');
      expect(prompt).toContain('error');
    });

    it('should include code snippets when provided', () => {
      const codeSnippets = new Map<string, string>();
      codeSnippets.set('src/utils.ts::processData', 'const x = 1;');

      const prompt = buildReviewPrompt(mockReport, mockPRContext, codeSnippets);

      expect(prompt).toContain('const x = 1;');
      expect(prompt).toContain('src/utils.ts - processData');
    });

    it('should handle empty code snippets', () => {
      const prompt = buildReviewPrompt(mockReport, mockPRContext, new Map());

      expect(prompt).toContain('No code snippets available');
    });
  });

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

  describe('formatReviewComment', () => {
    it('should format AI review with summary', () => {
      const aiReview = 'This is the AI review content.';
      const comment = formatReviewComment(aiReview, mockReport);

      expect(comment).toContain('<!-- lien-ai-review -->');
      expect(comment).toContain('3 issues spotted in this PR.');
      expect(comment).toContain(aiReview);
    });

    it('should include analysis details', () => {
      const comment = formatReviewComment('Review', mockReport);

      expect(comment).toContain('Files analyzed: 2');
      expect(comment).toContain('Average complexity: 15.5');
      expect(comment).toContain('Max complexity: 23');
    });

    it('should handle singular violation', () => {
      const singleViolationReport: ComplexityReport = {
        ...mockReport,
        summary: {
          ...mockReport.summary,
          totalViolations: 1,
          bySeverity: { error: 1, warning: 0 },
        },
      };

      const comment = formatReviewComment('Review', singleViolationReport);

      expect(comment).toContain('1 issue spotted in this PR.');
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

  describe('formatReviewComment with new/pre-existing separation', () => {
    it('should show new vs pre-existing header when deltas provided', () => {
      const deltas: ComplexityDelta[] = [
        {
          filepath: 'src/utils.ts',
          symbolName: 'processData',
          symbolType: 'function',
          startLine: 10,
          metricType: 'cyclomatic',
          baseComplexity: 20,
          headComplexity: 23,
          delta: 3,
          threshold: 15,
          severity: 'warning',
        },
        {
          filepath: 'src/utils.ts',
          symbolName: 'validateInput',
          symbolType: 'function',
          startLine: 60,
          metricType: 'cyclomatic',
          baseComplexity: 12,
          headComplexity: 12,
          delta: 0,
          threshold: 15,
          severity: 'warning',
        },
        {
          filepath: 'src/handler.ts',
          symbolName: 'handleRequest',
          symbolType: 'function',
          startLine: 5,
          metricType: 'cyclomatic',
          baseComplexity: 11,
          headComplexity: 11,
          delta: 0,
          threshold: 15,
          severity: 'warning',
        },
      ];
      const comment = formatReviewComment('Review', mockReport, false, undefined, deltas);
      expect(comment).toContain('1 new issue spotted in this PR.');
      expect(comment).toContain('2 pre-existing issues in touched files.');
    });

    it('should show "No new complexity" when all deltas are zero', () => {
      const deltas: ComplexityDelta[] = [
        {
          filepath: 'src/utils.ts',
          symbolName: 'processData',
          symbolType: 'function',
          startLine: 10,
          metricType: 'cyclomatic',
          baseComplexity: 23,
          headComplexity: 23,
          delta: 0,
          threshold: 15,
          severity: 'warning',
        },
      ];
      const reportOneViolation: ComplexityReport = {
        ...mockReport,
        summary: { ...mockReport.summary, totalViolations: 1 },
      };
      const comment = formatReviewComment('Review', reportOneViolation, false, undefined, deltas);
      expect(comment).toContain('No new complexity introduced.');
      expect(comment).toContain('1 pre-existing issue in touched files.');
      expect(comment).toContain('**Complexity:** No change from this PR.');
    });
  });

  describe('buildReviewPrompt with new/pre-existing separation', () => {
    it('should separate violations into new vs pre-existing when deltas provided', () => {
      const reportWithMetrics: ComplexityReport = {
        summary: mockReport.summary,
        files: {
          'src/utils.ts': {
            violations: [
              { ...mockReport.files['src/utils.ts'].violations[0], metricType: 'cyclomatic' },
            ],
            dependents: [],
            testAssociations: [],
            riskLevel: 'high',
          },
          'src/handler.ts': {
            violations: [
              { ...mockReport.files['src/handler.ts'].violations[0], metricType: 'cyclomatic' },
            ],
            dependents: [],
            testAssociations: [],
            riskLevel: 'medium',
          },
        },
      };
      const deltas: ComplexityDelta[] = [
        {
          filepath: 'src/utils.ts',
          symbolName: 'processData',
          symbolType: 'function',
          startLine: 10,
          metricType: 'cyclomatic',
          baseComplexity: null,
          headComplexity: 23,
          delta: 23,
          threshold: 15,
          severity: 'new',
        },
        {
          filepath: 'src/handler.ts',
          symbolName: 'handleRequest',
          symbolType: 'function',
          startLine: 5,
          metricType: 'cyclomatic',
          baseComplexity: 11,
          headComplexity: 11,
          delta: 0,
          threshold: 15,
          severity: 'warning',
        },
      ];
      const prompt = buildReviewPrompt(reportWithMetrics, mockPRContext, new Map(), deltas);
      expect(prompt).toContain('New/Worsened Violations');
      expect(prompt).toContain('Pre-existing Violations');
    });

    it('should not separate when no deltas provided', () => {
      const prompt = buildReviewPrompt(mockReport, mockPRContext, new Map());
      expect(prompt).not.toContain('New/Worsened Violations');
      expect(prompt).not.toContain('Pre-existing Violations');
    });
  });
});
