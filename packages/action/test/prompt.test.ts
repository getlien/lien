import { describe, it, expect } from 'vitest';
import {
  buildReviewPrompt,
  buildNoViolationsMessage,
  formatReviewComment,
  getViolationKey,
  buildBatchedCommentsPrompt,
  buildDescriptionBadge,
} from '../src/prompt.js';
import type { DeltaSummary } from '../src/types.js';
import type { ComplexityReport, PRContext } from '../src/types.js';

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
      codeSnippets.set('src/utils.ts::processData', 'function processData() { /* complex code */ }');

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

      const prompt = buildBatchedCommentsPrompt(violations, codeSnippets);

      expect(prompt).toContain('processData');
      expect(prompt).toContain('handleRequest');
      expect(prompt).toContain('Complexity**: 23');
      expect(prompt).toContain('Complexity**: 11');
    });

    it('should include code snippets when provided', () => {
      const violations = [mockReport.files['src/utils.ts'].violations[0]];
      const codeSnippets = new Map<string, string>();
      codeSnippets.set('src/utils.ts::processData', 'function processData() {}');

      const prompt = buildBatchedCommentsPrompt(violations, codeSnippets);

      expect(prompt).toContain('function processData() {}');
    });

    it('should include JSON response format with correct keys', () => {
      const violations = [
        mockReport.files['src/utils.ts'].violations[0],
        mockReport.files['src/handler.ts'].violations[0],
      ];

      const prompt = buildBatchedCommentsPrompt(violations, new Map());

      expect(prompt).toContain('"src/utils.ts::processData"');
      expect(prompt).toContain('"src/handler.ts::handleRequest"');
      expect(prompt).toContain('Respond with ONLY valid JSON');
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
      // mockReport has violations but delta is negative - show improved with pre-existing note
      expect(badge).toContain('✅ **Improved!**');
      expect(badge).toContain('pre-existing');
    });

    it('should show stable when pre-existing violations but no new ones', () => {
      const badge = buildDescriptionBadge(mockReport, null, null);

      // mockReport has violations but no delta info - show stable with pre-existing note
      expect(badge).toContain('➡️ **Stable**');
      expect(badge).toContain('pre-existing');
    });

    it('should show stable when warnings only and no delta', () => {
      const warningsOnlyReport: ComplexityReport = {
        summary: {
          filesAnalyzed: 2,
          totalViolations: 2,
          bySeverity: { error: 0, warning: 2 },
          avgComplexity: 12.0,
          maxComplexity: 14,
        },
        files: {},
      };

      const badge = buildDescriptionBadge(warningsOnlyReport, null, null);

      // No delta info, has violations - show stable with pre-existing note
      expect(badge).toContain('➡️ **Stable**');
      expect(badge).toContain('pre-existing');
    });

    it('should show improved when delta negative and no violations', () => {
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
      const deltaSummary: DeltaSummary = {
        totalDelta: -10,
        improved: 2,
        degraded: 0,
        newFunctions: 0,
        deletedFunctions: 0,
        unchanged: 0,
      };

      const badge = buildDescriptionBadge(cleanReport, deltaSummary, null);

      expect(badge).toContain('✅ **Improved!**');
      expect(badge).toContain('reduces complexity');
    });

    it('should show stable when delta positive but no violations', () => {
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
      const deltaSummary: DeltaSummary = {
        totalDelta: 5,
        improved: 0,
        degraded: 1,
        newFunctions: 0,
        deletedFunctions: 0,
        unchanged: 0,
      };

      const badge = buildDescriptionBadge(cleanReport, deltaSummary, null);

      expect(badge).toContain('➡️ **Stable**');
      expect(badge).toContain('increased slightly but within limits');
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

    it('should handle null report gracefully', () => {
      const deltaSummary: DeltaSummary = {
        totalDelta: -5,
        improved: 1,
        degraded: 0,
        newFunctions: 0,
        deletedFunctions: 0,
        unchanged: 0,
      };

      const badge = buildDescriptionBadge(null, deltaSummary, null);

      // Shows improved status with human-friendly message
      expect(badge).toContain('✅ **Improved!**');
      expect(badge).toContain('reduces complexity');
    });

    it('should format the metric table when violations have metricType', () => {
      // Create a report with metricType set on violations
      const reportWithMetrics: ComplexityReport = {
        summary: {
          filesAnalyzed: 2,
          totalViolations: 2,
          bySeverity: { error: 1, warning: 1 },
          avgComplexity: 15.0,
          maxComplexity: 20,
        },
        files: {
          'src/complex.ts': {
            violations: [
              {
                filepath: 'src/complex.ts',
                startLine: 10,
                endLine: 50,
                symbolName: 'complexFunction',
                symbolType: 'function',
                language: 'typescript',
                complexity: 20,
                threshold: 15,
                severity: 'error',
                message: 'Cyclomatic complexity exceeds threshold',
                metricType: 'cyclomatic',
              },
              {
                filepath: 'src/complex.ts',
                startLine: 60,
                endLine: 100,
                symbolName: 'anotherFunction',
                symbolType: 'function',
                language: 'typescript',
                complexity: 18,
                threshold: 15,
                severity: 'warning',
                message: 'Cognitive complexity exceeds threshold',
                metricType: 'cognitive',
              },
            ],
            dependents: [],
            testAssociations: [],
            riskLevel: 'high',
          },
        },
      };

      const badge = buildDescriptionBadge(reportWithMetrics, null, null);

      // Check metric table structure (only shown when violations have metricType)
      expect(badge).toContain('| Metric | Violations | Change |');
      expect(badge).toContain('|--------|:----------:|:------:|');
      expect(badge).toContain('🔀'); // cyclomatic emoji
      expect(badge).toContain('🧠'); // cognitive emoji
    });
  });
});

