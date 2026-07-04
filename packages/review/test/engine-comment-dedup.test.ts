import { describe, it, expect } from 'vitest';
import {
  parsePluginCommentKey,
  isDuplicateOfExistingComment,
  DEDUP_LINE_TOLERANCE,
} from '../src/engine.js';

describe('parsePluginCommentKey', () => {
  it('parses a well-formed key', () => {
    expect(parsePluginCommentKey('packages/core/src/indexer/index.ts::461::logic_error')).toEqual({
      filepath: 'packages/core/src/indexer/index.ts',
      line: 461,
      category: 'logic_error',
    });
  });

  it('returns null for keys with too few segments', () => {
    expect(parsePluginCommentKey('just-a-string')).toBeNull();
    expect(parsePluginCommentKey('file.ts::12')).toBeNull();
  });

  it('returns null for a non-integer line segment', () => {
    expect(parsePluginCommentKey('file.ts::abc::logic_error')).toBeNull();
  });

  it('returns null for an empty filepath or category', () => {
    expect(parsePluginCommentKey('::12::logic_error')).toBeNull();
    expect(parsePluginCommentKey('file.ts::12::')).toBeNull();
  });
});

describe('isDuplicateOfExistingComment', () => {
  const key = (file: string, line: number, category = 'logic_error') =>
    `${file}::${line}::${category}`;

  it('matches an identical key exactly', () => {
    const existing = new Set([key('src/a.ts', 10)]);
    expect(isDuplicateOfExistingComment(key('src/a.ts', 10), existing)).toBe(true);
  });

  it('matches the same file + category within the line tolerance', () => {
    const existing = new Set([key('src/a.ts', 10)]);
    expect(isDuplicateOfExistingComment(key('src/a.ts', 10 + DEDUP_LINE_TOLERANCE), existing)).toBe(
      true,
    );
  });

  it('does not match beyond the line tolerance', () => {
    const existing = new Set([key('src/a.ts', 10)]);
    expect(
      isDuplicateOfExistingComment(key('src/a.ts', 10 + DEDUP_LINE_TOLERANCE + 1), existing),
    ).toBe(false);
  });

  it('does not match a different category on the same line', () => {
    const existing = new Set([key('src/a.ts', 10, 'logic_error')]);
    expect(isDuplicateOfExistingComment(key('src/a.ts', 10, 'error_swallowing'), existing)).toBe(
      false,
    );
  });

  it('does not match a different file', () => {
    const existing = new Set([key('src/a.ts', 10)]);
    expect(isDuplicateOfExistingComment(key('src/b.ts', 10), existing)).toBe(false);
  });

  it('ignores malformed existing keys instead of throwing', () => {
    const existing = new Set(['not-a-key', key('src/a.ts', 10)]);
    expect(isDuplicateOfExistingComment(key('src/a.ts', 12), existing)).toBe(true);
    expect(isDuplicateOfExistingComment('also-not-a-key', existing)).toBe(false);
  });

  it('collapses the PR #667 line-drift incident: 461 → 483 → 486', () => {
    // Three consecutive review runs posted the same chunksCreated finding
    // at drifting lines; each later key must dedup against the earlier ones.
    const file = 'packages/core/src/indexer/index.ts';
    const afterRun1 = new Set([key(file, 461)]);
    expect(isDuplicateOfExistingComment(key(file, 483), afterRun1)).toBe(true);
    expect(isDuplicateOfExistingComment(key(file, 486), afterRun1)).toBe(true);
  });

  it('respects a custom tolerance argument', () => {
    const existing = new Set([key('src/a.ts', 10)]);
    expect(isDuplicateOfExistingComment(key('src/a.ts', 15), existing, 4)).toBe(false);
    expect(isDuplicateOfExistingComment(key('src/a.ts', 15), existing, 5)).toBe(true);
  });
});
