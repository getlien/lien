import { describe, it, expect } from 'vitest';
import {
  parsePluginCommentKey,
  isDuplicateOfExistingComment,
  buildPluginCommentBody,
  DEDUP_LINE_TOLERANCE,
} from '../src/engine.js';
import type { ReviewFinding } from '../src/plugin-types.js';

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

  // -------------------------------------------------------------------------
  // NEW format: filepath::line::category::pass (issue #839 census follow-up —
  // per-pass finding attribution wasn't machine-recoverable from the marker)
  // -------------------------------------------------------------------------

  it('parses a well-formed NEW-format key (with pass provenance)', () => {
    expect(
      parsePluginCommentKey('packages/review/src/engine.ts::42::error_handling::doc-truth'),
    ).toEqual({
      filepath: 'packages/review/src/engine.ts',
      line: 42,
      category: 'error_handling',
      pass: 'doc-truth',
    });
  });

  it('parses a NEW-format key whose pass name itself contains a hyphen', () => {
    expect(parsePluginCommentKey('a.ts::1::bug::stale-duplicate-loop')).toEqual({
      filepath: 'a.ts',
      line: 1,
      category: 'bug',
      pass: 'stale-duplicate-loop',
    });
  });

  it('returns null for a NEW-format-shaped key with an empty pass segment', () => {
    expect(parsePluginCommentKey('a.ts::1::bug::')).toBeNull();
  });

  it('reassembles a filepath containing embedded "::" for both formats', () => {
    // Same defensive reassembly the original 3-segment parser already had
    // (`slice(0, -2)`), extended to `slice(0, -3)` for the 4-segment format.
    expect(parsePluginCommentKey('weird::path.ts::12::logic_error')).toEqual({
      filepath: 'weird::path.ts',
      line: 12,
      category: 'logic_error',
    });
    expect(parsePluginCommentKey('weird::path.ts::12::logic_error::main')).toEqual({
      filepath: 'weird::path.ts',
      line: 12,
      category: 'logic_error',
      pass: 'main',
    });
  });
});

describe('buildPluginCommentBody', () => {
  function baseFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
    return {
      pluginId: 'agent-review',
      filepath: 'src/foo.ts',
      line: 10,
      severity: 'warning',
      category: 'error_handling',
      message: 'msg',
      ...overrides,
    };
  }

  it('keeps the original 3-segment marker when the finding carries no sourcePass', () => {
    const body = buildPluginCommentBody(baseFinding(), '<!-- lien-plugin:agent-review:');
    expect(body).toContain('<!-- lien-plugin:agent-review:src/foo.ts::10::error_handling -->');
  });

  it('appends a 4th segment when metadata.sourcePass is present (issue #839)', () => {
    const body = buildPluginCommentBody(
      baseFinding({ metadata: { sourcePass: 'stale-duplicate-loop' } }),
      '<!-- lien-plugin:agent-review:',
    );
    expect(body).toContain(
      '<!-- lien-plugin:agent-review:src/foo.ts::10::error_handling::stale-duplicate-loop -->',
    );
  });

  it('round-trips through parsePluginCommentKey', () => {
    const body = buildPluginCommentBody(
      baseFinding({ metadata: { sourcePass: 'doc-truth' } }),
      '<!-- lien-plugin:agent-review:',
    );
    const key = body.match(/<!-- lien-plugin:agent-review:(.+?) -->/)?.[1];
    expect(parsePluginCommentKey(key!)).toEqual({
      filepath: 'src/foo.ts',
      line: 10,
      category: 'error_handling',
      pass: 'doc-truth',
    });
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

  // -------------------------------------------------------------------------
  // Mixed old/new marker format (issue #839 census follow-up): the CRITICAL
  // back-compat requirement — an OLD-format marker already posted on an
  // existing PR thread must still be recognized as a duplicate of its
  // NEW-format equivalent (and vice versa), or the format change alone would
  // cause a double-post on every already-reviewed open PR the day this ships.
  // -------------------------------------------------------------------------

  const newKey = (file: string, line: number, category = 'logic_error', pass = 'main') =>
    `${file}::${line}::${category}::${pass}`;

  it('matches a NEW-format candidate against an OLD-format existing marker (same file/line/category)', () => {
    const existing = new Set([key('src/a.ts', 10)]); // OLD format, no pass
    expect(
      isDuplicateOfExistingComment(newKey('src/a.ts', 10, 'logic_error', 'doc-truth'), existing),
    ).toBe(true);
  });

  it('matches an OLD-format candidate against a NEW-format existing marker', () => {
    const existing = new Set([newKey('src/a.ts', 10, 'logic_error', 'stale-duplicate-loop')]);
    expect(isDuplicateOfExistingComment(key('src/a.ts', 10), existing)).toBe(true);
  });

  it('matches across formats within the line-drift tolerance, not just exactly', () => {
    const existing = new Set([key('src/a.ts', 10)]); // OLD format
    expect(
      isDuplicateOfExistingComment(
        newKey('src/a.ts', 10 + DEDUP_LINE_TOLERANCE, 'logic_error', 'doc-truth'),
        existing,
      ),
    ).toBe(true);
  });

  it('does NOT match across formats when the pass differs but file/category/line also differ', () => {
    const existing = new Set([newKey('src/a.ts', 10, 'logic_error', 'main')]);
    // Different file — must not match regardless of format or pass name.
    expect(
      isDuplicateOfExistingComment(newKey('src/b.ts', 10, 'logic_error', 'main'), existing),
    ).toBe(false);
  });

  it('never double-posts across a mixed set of both old- and new-format existing markers', () => {
    const existing = new Set([
      key('src/a.ts', 10), // old format, from before this format change shipped
      newKey('src/c.ts', 20, 'bug', 'incomplete-handling-loop'), // new format, from after
    ]);
    expect(
      isDuplicateOfExistingComment(newKey('src/a.ts', 11, 'logic_error', 'doc-truth'), existing),
    ).toBe(true);
    expect(isDuplicateOfExistingComment(key('src/c.ts', 20, 'bug'), existing)).toBe(true);
    expect(isDuplicateOfExistingComment(newKey('src/d.ts', 1, 'bug', 'main'), existing)).toBe(
      false,
    );
  });
});
