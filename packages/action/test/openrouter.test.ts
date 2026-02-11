/**
 * Tests for openrouter.ts utility functions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseCommentsResponse, mapCommentsToViolations, type Logger } from '@liendev/review';
import type { ComplexityViolation } from '@liendev/review';

const mockLogger: Logger = {
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe('parseCommentsResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses valid JSON directly', () => {
    const content = '{"file.ts::func": "This is a comment"}';
    const result = parseCommentsResponse(content, mockLogger);

    expect(result).toEqual({ 'file.ts::func': 'This is a comment' });
  });

  it('extracts JSON from markdown code block', () => {
    const content = '```json\n{"file.ts::func": "Comment in code block"}\n```';
    const result = parseCommentsResponse(content, mockLogger);

    expect(result).toEqual({ 'file.ts::func': 'Comment in code block' });
  });

  it('extracts JSON from code block without language tag', () => {
    const content = '```\n{"file.ts::func": "Comment"}\n```';
    const result = parseCommentsResponse(content, mockLogger);

    expect(result).toEqual({ 'file.ts::func': 'Comment' });
  });

  it('handles multiple comments', () => {
    const content = JSON.stringify({
      'src/file1.ts::functionA': 'Comment for A',
      'src/file2.ts::functionB': 'Comment for B',
      'src/file3.ts::functionC': 'Comment for C',
    });
    const result = parseCommentsResponse(content, mockLogger);

    expect(result).toHaveProperty('src/file1.ts::functionA');
    expect(result).toHaveProperty('src/file2.ts::functionB');
    expect(result).toHaveProperty('src/file3.ts::functionC');
  });

  it('recovers JSON with aggressive parsing when surrounded by text', () => {
    const content = 'Here is my response:\n{"file.ts::func": "Comment"}\nThat was my analysis.';
    const result = parseCommentsResponse(content, mockLogger);

    expect(result).toEqual({ 'file.ts::func': 'Comment' });
  });

  it('returns null for completely invalid content', () => {
    const content = 'This is not JSON at all, just plain text.';
    const result = parseCommentsResponse(content, mockLogger);

    expect(result).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    const content = '{"file.ts::func": "unclosed string';
    const result = parseCommentsResponse(content, mockLogger);

    expect(result).toBeNull();
  });

  it('handles JSON with escaped newlines', () => {
    const content = '{"file.ts::func": "Line 1\\nLine 2\\nLine 3"}';
    const result = parseCommentsResponse(content, mockLogger);

    expect(result).toEqual({ 'file.ts::func': 'Line 1\nLine 2\nLine 3' });
  });

  it('handles empty JSON object', () => {
    const content = '{}';
    const result = parseCommentsResponse(content, mockLogger);

    expect(result).toEqual({});
  });

  it('handles whitespace around JSON', () => {
    const content = '  \n  {"file.ts::func": "Comment"}  \n  ';
    const result = parseCommentsResponse(content, mockLogger);

    expect(result).toEqual({ 'file.ts::func': 'Comment' });
  });
});

describe('mapCommentsToViolations', () => {
  const createViolation = (
    filepath: string,
    symbolName: string,
    symbolType = 'function',
  ): ComplexityViolation => ({
    filepath,
    symbolName,
    symbolType,
    complexity: 15,
    threshold: 15,
    startLine: 1,
    endLine: 10,
    severity: 'warning',
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps comments to matching violations', () => {
    const violations = [
      createViolation('src/file.ts', 'functionA'),
      createViolation('src/file.ts', 'functionB'),
    ];
    const commentsMap = {
      'src/file.ts::functionA': 'Comment for A',
      'src/file.ts::functionB': 'Comment for B',
    };

    const result = mapCommentsToViolations(commentsMap, violations, mockLogger);

    expect(result.get(violations[0])).toBe('Comment for A');
    expect(result.get(violations[1])).toBe('Comment for B');
  });

  it('uses fallback for missing comments', () => {
    const violations = [
      createViolation('src/file.ts', 'functionA'),
      createViolation('src/file.ts', 'functionB'),
    ];
    const commentsMap = {
      'src/file.ts::functionA': 'Comment for A',
      // functionB is missing
    };

    const result = mapCommentsToViolations(commentsMap, violations, mockLogger);

    expect(result.get(violations[0])).toBe('Comment for A');
    expect(result.get(violations[1])).toContain('exceeds the complexity threshold');
  });

  it('uses fallback for all violations when commentsMap is null', () => {
    const violations = [
      createViolation('src/file.ts', 'functionA'),
      createViolation('src/other.ts', 'functionB', 'method'),
    ];

    const result = mapCommentsToViolations(null, violations, mockLogger);

    expect(result.get(violations[0])).toContain('This function exceeds');
    expect(result.get(violations[1])).toContain('This method exceeds');
  });

  it('unescapes newlines in comments', () => {
    const violations = [createViolation('src/file.ts', 'func')];
    const commentsMap = {
      'src/file.ts::func': 'Line 1\\nLine 2\\nLine 3',
    };

    const result = mapCommentsToViolations(commentsMap, violations, mockLogger);

    expect(result.get(violations[0])).toBe('Line 1\nLine 2\nLine 3');
  });

  it('handles empty violations array', () => {
    const commentsMap = { 'src/file.ts::func': 'Comment' };
    const result = mapCommentsToViolations(commentsMap, [], mockLogger);

    expect(result.size).toBe(0);
  });

  it('handles empty commentsMap', () => {
    const violations = [createViolation('src/file.ts', 'func')];
    const result = mapCommentsToViolations({}, violations, mockLogger);

    // Should use fallback for all
    expect(result.get(violations[0])).toContain('exceeds the complexity threshold');
  });

  it('preserves violation objects as keys', () => {
    const violation = createViolation('src/file.ts', 'func');
    const commentsMap = { 'src/file.ts::func': 'Comment' };

    const result = mapCommentsToViolations(commentsMap, [violation], mockLogger);

    // Should be able to get by the exact same object
    expect(result.has(violation)).toBe(true);
  });

  it('includes symbol type in fallback message', () => {
    const methodViolation = createViolation('src/file.ts', 'method', 'method');
    const classViolation = createViolation('src/file.ts', 'MyClass', 'class');

    const result = mapCommentsToViolations(null, [methodViolation, classViolation], mockLogger);

    expect(result.get(methodViolation)).toContain('This method');
    expect(result.get(classViolation)).toContain('This class');
  });
});
