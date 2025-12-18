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

      const prompt = buildBatchedCommentsPrompt(violations, codeSnippets, mockReport);

      expect(prompt).toContain('processData');
      expect(prompt).toContain('handleRequest');
      expect(prompt).toContain('Complexity**: 23');
      expect(prompt).toContain('Complexity**: 11');
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

    it('should include dependency impact summary when files have dependents', () => {
      const reportWithDependents: ComplexityReport = {
        summary: {
          filesAnalyzed: 2,
          totalViolations: 2,
          bySeverity: { error: 1, warning: 1 },
          avgComplexity: 15.0,
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
          'src/utils.ts': {
            violations: [
              {
                filepath: 'src/utils.ts',
                startLine: 5,
                endLine: 25,
                symbolName: 'helper',
                symbolType: 'function',
                language: 'typescript',
                complexity: 18,
                threshold: 15,
                severity: 'warning',
                message: 'Complexity exceeds threshold',
                metricType: 'cognitive',
              },
            ],
            dependents: ['src/api/handler.ts'],
            dependentCount: 3,
            testAssociations: [],
            riskLevel: 'critical',
          },
        },
      };

      const badge = buildDescriptionBadge(reportWithDependents, null, null);

      // Should show impact summary for high-risk files with dependents
      expect(badge).toContain('🔗 **Impact**:');
      expect(badge).toContain('high-risk file(s)');
      expect(badge).toContain('total dependents');
      // Should count both files (high and critical are both high-risk)
      expect(badge).toContain('2 high-risk file(s)');
      // Total dependents: 12 + 3 = 15
      expect(badge).toContain('15 total dependents');
    });

    it('should not show dependency impact when no high-risk files have dependents', () => {
      const reportWithoutHighRisk: ComplexityReport = {
        summary: {
          filesAnalyzed: 1,
          totalViolations: 1,
          bySeverity: { error: 0, warning: 1 },
          avgComplexity: 12.0,
          maxComplexity: 14,
        },
        files: {
          'src/utils.ts': {
            violations: [
              {
                filepath: 'src/utils.ts',
                startLine: 5,
                endLine: 25,
                symbolName: 'helper',
                symbolType: 'function',
                language: 'typescript',
                complexity: 14,
                threshold: 15,
                severity: 'warning',
                message: 'Complexity exceeds threshold',
                metricType: 'cognitive',
              },
            ],
            dependents: ['src/api/handler.ts'],
            dependentCount: 1,
            testAssociations: [],
            riskLevel: 'low', // Low risk, so no impact summary
          },
        },
      };

      const badge = buildDescriptionBadge(reportWithoutHighRisk, null, null);

      // Should not show impact summary for low-risk files
      expect(badge).not.toContain('🔗 **Impact**:');
    });
  });

  describe('buildReviewPrompt with dependency context', () => {
    it('should include dependency context in violations summary', () => {
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
            dependents: ['src/api/login.ts', 'src/middleware/auth.ts', 'src/components/UserProfile.tsx'],
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

      const prompt = buildReviewPrompt(reportWithDependents, mockPRContext, new Map());

      // Should include dependency impact section
      expect(prompt).toContain('**Dependency Impact**:');
      expect(prompt).toContain('HIGH risk');
      expect(prompt).toContain('12 file(s) import this');
      expect(prompt).toContain('**Key dependents:**');
      expect(prompt).toContain('src/api/login.ts');
      expect(prompt).toContain('src/middleware/auth.ts');
      expect(prompt).toContain('Dependent complexity');
      expect(prompt).toContain('Avg 8.5');
      expect(prompt).toContain('Max 15');
      expect(prompt).toContain('Review focus');
    });

    it('should not include dependency context when file has no dependents', () => {
      const reportWithoutDependents: ComplexityReport = {
        summary: {
          filesAnalyzed: 1,
          totalViolations: 1,
          bySeverity: { error: 1, warning: 0 },
          avgComplexity: 20.0,
          maxComplexity: 20,
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
                complexity: 20,
                threshold: 15,
                severity: 'error',
                message: 'Complexity exceeds threshold',
                metricType: 'cyclomatic',
              },
            ],
            dependents: [],
            dependentCount: 0,
            testAssociations: [],
            riskLevel: 'high',
          },
        },
      };

      const prompt = buildReviewPrompt(reportWithoutDependents, mockPRContext, new Map());

      // Should not include dependency impact section
      expect(prompt).not.toContain('**Dependency Impact**:');
      expect(prompt).not.toContain('file(s) import this');
    });

    it('should limit dependents list to 10 in dependency context', () => {
      const manyDependents = Array.from({ length: 15 }, (_, i) => `src/dep${i}.ts`);
      const reportWithManyDependents: ComplexityReport = {
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
            dependents: manyDependents,
            dependentCount: 15,
            testAssociations: [],
            riskLevel: 'high',
          },
        },
      };

      const prompt = buildReviewPrompt(reportWithManyDependents, mockPRContext, new Map());

      // Should show first 10 dependents
      expect(prompt).toContain('src/dep0.ts');
      expect(prompt).toContain('src/dep9.ts');
      // Should not show dep10 or later
      expect(prompt).not.toContain('src/dep10.ts');
      // Should show "... (and more)" note
      expect(prompt).toContain('... (and more)');
    });
  });
});

