import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseLogicReviewResponse } from '../src/logic-response.js';
import type { Logger } from '../src/logger.js';

const mockLogger: Logger = {
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe('parseLogicReviewResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses valid JSON response', () => {
    const content = JSON.stringify({
      'src/auth.ts::validateToken': {
        valid: true,
        comment: 'This export removal will break 5 files.',
        category: 'breaking_change',
      },
    });

    const result = parseLogicReviewResponse(content, mockLogger);
    expect(result).not.toBeNull();
    expect(result!['src/auth.ts::validateToken'].valid).toBe(true);
    expect(result!['src/auth.ts::validateToken'].comment).toContain('break 5 files');
  });

  it('extracts JSON from markdown code block', () => {
    const content =
      '```json\n{"src/file.ts::func": {"valid": false, "comment": "False positive", "category": "unchecked_return"}}\n```';
    const result = parseLogicReviewResponse(content, mockLogger);
    expect(result).not.toBeNull();
    expect(result!['src/file.ts::func'].valid).toBe(false);
  });

  it('handles multiple entries', () => {
    const content = JSON.stringify({
      'src/a.ts::funcA': { valid: true, comment: 'Real issue', category: 'breaking_change' },
      'src/b.ts::funcB': {
        valid: false,
        comment: 'Not an issue',
        category: 'missing_tests',
      },
    });

    const result = parseLogicReviewResponse(content, mockLogger);
    expect(result).not.toBeNull();
    expect(Object.keys(result!)).toHaveLength(2);
  });

  it('returns null for completely invalid content', () => {
    const result = parseLogicReviewResponse('This is not JSON', mockLogger);
    expect(result).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    const result = parseLogicReviewResponse('{"broken": ', mockLogger);
    expect(result).toBeNull();
  });

  it('recovers with aggressive JSON extraction', () => {
    const content =
      'Here is my analysis:\n{"src/file.ts::func": {"valid": true, "comment": "Issue found", "category": "breaking_change"}}\nEnd of analysis.';
    const result = parseLogicReviewResponse(content, mockLogger);
    expect(result).not.toBeNull();
    expect(result!['src/file.ts::func'].valid).toBe(true);
  });
});
