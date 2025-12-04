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
          threshold: 10,
          severity: 'error',
          message: 'Function complexity 23 exceeds threshold 10',
        },
        {
          filepath: 'src/utils.ts',
          startLine: 60,
          endLine: 80,
          symbolName: 'validateInput',
          symbolType: 'function',
          language: 'typescript',
          complexity: 12,
          threshold: 10,
          severity: 'warning',
          message: 'Function complexity 12 exceeds threshold 10',
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
          threshold: 10,
          severity: 'warning',
          message: 'Function complexity 11 exceeds threshold 10',
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
      expect(comment).toContain('3 complexity violations');
      expect(comment).toContain('1 error');
      expect(comment).toContain('2 warnings');
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

      expect(comment).toContain('1 complexity violation');
      expect(comment).toContain('1 error');
      expect(comment).toContain('0 warnings');
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
    it('should show improved status when delta is negative', () => {
      const deltaSummary: DeltaSummary = {
        totalDelta: -15,
        improved: 2,
        degraded: 0,
        newViolations: 0,
        removedViolations: 1,
      };

      const badge = buildDescriptionBadge(mockReport, deltaSummary);

      expect(badge).toContain('### 🔍 Lien Complexity');
      expect(badge).toContain('-15 ⬇️');
      expect(badge).toContain('✅ Improved');
      expect(badge).toContain('3'); // violations
      expect(badge).toContain('23'); // max complexity
      expect(badge).toContain('2 improved');
    });

    it('should show degraded status when delta is positive', () => {
      const deltaSummary: DeltaSummary = {
        totalDelta: 10,
        improved: 0,
        degraded: 2,
        newViolations: 1,
        removedViolations: 0,
      };

      const badge = buildDescriptionBadge(mockReport, deltaSummary);

      expect(badge).toContain('+10 ⬆️');
      expect(badge).toContain('⚠️ Degraded');
      expect(badge).toContain('2 degraded');
    });

    it('should show no change when delta is zero', () => {
      const deltaSummary: DeltaSummary = {
        totalDelta: 0,
        improved: 1,
        degraded: 1,
        newViolations: 0,
        removedViolations: 0,
      };

      const badge = buildDescriptionBadge(mockReport, deltaSummary);

      expect(badge).toContain('+0 ➡️');
      expect(badge).toContain('➡️ No change');
      expect(badge).toContain('1 improved');
      expect(badge).toContain('1 degraded');
    });

    it('should show clean status when no violations and no delta', () => {
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

      const badge = buildDescriptionBadge(cleanReport, null);

      expect(badge).toContain('0'); // violations
      expect(badge).toContain('8'); // max complexity
      expect(badge).toContain('—'); // delta (dash for no delta)
      expect(badge).toContain('✅ Clean');
    });

    it('should show violations count in status when no delta but has violations', () => {
      const badge = buildDescriptionBadge(mockReport, null);

      expect(badge).toContain('3'); // violations in table
      expect(badge).toContain('⚠️ 3 violations');
    });

    it('should handle null report gracefully', () => {
      const deltaSummary: DeltaSummary = {
        totalDelta: -5,
        improved: 1,
        degraded: 0,
        newViolations: 0,
        removedViolations: 0,
      };

      const badge = buildDescriptionBadge(null, deltaSummary);

      expect(badge).toContain('0'); // violations default
      expect(badge).toContain('—'); // max complexity default
      expect(badge).toContain('-5 ⬇️');
    });

    it('should format the table correctly', () => {
      const badge = buildDescriptionBadge(mockReport, null);

      // Check table structure
      expect(badge).toContain('| Violations | Max | Delta | Status |');
      expect(badge).toContain('|:----------:|:---:|:-----:|:------:|');
    });

    it('should not show improvement details when both are zero', () => {
      const deltaSummary: DeltaSummary = {
        totalDelta: 0,
        improved: 0,
        degraded: 0,
        newViolations: 0,
        removedViolations: 0,
      };

      const badge = buildDescriptionBadge(mockReport, deltaSummary);

      // Should not contain the italicized improvement details
      expect(badge).not.toContain('*0 improved');
      expect(badge).not.toContain('*0 degraded');
    });
  });
});

