import { describe, it, expect } from 'vitest';
import {
  buildReviewPrompt,
  buildNoViolationsMessage,
  formatReviewComment,
  getViolationKey,
} from '../src/prompt.js';
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
});

