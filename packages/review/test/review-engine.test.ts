import { describe, it, expect } from 'vitest';
import type { ComplexityViolation, ComplexityDelta } from '@liendev/core';
import type { LineComment } from '../src/types.js';
import {
  determineReviewEvent,
  isMarginalViolation,
  filterDuplicateComments,
  buildDedupNote,
} from '../src/review-engine.js';
import {
  parseVeilleMarker,
  parseVeilleLogicMarker,
  VEILLE_COMMENT_MARKER_PREFIX,
  VEILLE_LOGIC_MARKER_PREFIX,
} from '../src/github-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeViolation(overrides: Partial<ComplexityViolation> = {}): ComplexityViolation {
  return {
    filepath: 'src/test.ts',
    symbolName: 'testFn',
    symbolType: 'function',
    startLine: 1,
    endLine: 10,
    complexity: 20,
    threshold: 15,
    metricType: 'cognitive',
    severity: 'warning',
    ...overrides,
  };
}

function makeDelta(overrides: Partial<ComplexityDelta> = {}): ComplexityDelta {
  return {
    filepath: 'src/test.ts',
    symbolName: 'testFn',
    metricType: 'cognitive',
    severity: 'new',
    baseValue: 0,
    headValue: 20,
    delta: 20,
    ...overrides,
  } as ComplexityDelta;
}

function makeProcessed(
  violations: Array<{ violation: ComplexityViolation; commentLine: number }> = [],
) {
  return {
    withLines: violations,
    uncovered: [],
    newOrDegraded: violations,
    skipped: [],
    marginal: [],
  };
}

// ---------------------------------------------------------------------------
// isMarginalViolation
// ---------------------------------------------------------------------------

describe('isMarginalViolation', () => {
  it('returns true when violation is exactly at threshold', () => {
    expect(isMarginalViolation(makeViolation({ complexity: 15, threshold: 15 }))).toBe(true);
  });

  it('returns true when violation is within 15% of threshold', () => {
    // 17 / 15 = 13% over
    expect(isMarginalViolation(makeViolation({ complexity: 17, threshold: 15 }))).toBe(true);
  });

  it('returns true at exactly 15% over', () => {
    // 17.25 / 15 = 15% over
    expect(isMarginalViolation(makeViolation({ complexity: 17.25, threshold: 15 }))).toBe(true);
  });

  it('returns false when violation is more than 15% over threshold', () => {
    // 18 / 15 = 20% over
    expect(isMarginalViolation(makeViolation({ complexity: 18, threshold: 15 }))).toBe(false);
  });

  it('returns false when violation is well over threshold', () => {
    expect(isMarginalViolation(makeViolation({ complexity: 50, threshold: 15 }))).toBe(false);
  });

  it('returns false when threshold is 0', () => {
    expect(isMarginalViolation(makeViolation({ complexity: 5, threshold: 0 }))).toBe(false);
  });

  it('returns false when threshold is negative', () => {
    expect(isMarginalViolation(makeViolation({ complexity: 5, threshold: -1 }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// determineReviewEvent
// ---------------------------------------------------------------------------

describe('determineReviewEvent', () => {
  it('returns COMMENT when blockOnNewErrors is false', () => {
    const violation = makeViolation({ severity: 'error' });
    const processed = makeProcessed([{ violation, commentLine: 1 }]);
    const deltaMap = new Map();

    expect(determineReviewEvent(processed, deltaMap, false)).toBe('COMMENT');
  });

  it('returns COMMENT when there are no violations', () => {
    const processed = makeProcessed([]);
    expect(determineReviewEvent(processed, new Map(), true)).toBe('COMMENT');
  });

  it('returns COMMENT when all violations are warnings (not errors)', () => {
    const violation = makeViolation({ severity: 'warning' });
    const processed = makeProcessed([{ violation, commentLine: 1 }]);

    expect(determineReviewEvent(processed, new Map(), true)).toBe('COMMENT');
  });

  it('returns REQUEST_CHANGES for new error-level violation (no delta)', () => {
    const violation = makeViolation({ severity: 'error' });
    const processed = makeProcessed([{ violation, commentLine: 1 }]);

    // No delta entry means it's new
    expect(determineReviewEvent(processed, new Map(), true)).toBe('REQUEST_CHANGES');
  });

  it('returns REQUEST_CHANGES for new error-level violation (delta severity=new)', () => {
    const violation = makeViolation({ severity: 'error' });
    const processed = makeProcessed([{ violation, commentLine: 1 }]);
    const deltaMap = new Map([['src/test.ts::testFn::cognitive', makeDelta({ severity: 'new' })]]);

    expect(determineReviewEvent(processed, deltaMap, true)).toBe('REQUEST_CHANGES');
  });

  it('returns REQUEST_CHANGES for degraded error-level violation (delta > 0)', () => {
    const violation = makeViolation({ severity: 'error' });
    const processed = makeProcessed([{ violation, commentLine: 1 }]);
    const deltaMap = new Map([
      [
        'src/test.ts::testFn::cognitive',
        makeDelta({ severity: 'degraded', delta: 5, baseValue: 15, headValue: 20 }),
      ],
    ]);

    expect(determineReviewEvent(processed, deltaMap, true)).toBe('REQUEST_CHANGES');
  });

  it('returns COMMENT for pre-existing error-level violation (delta = 0)', () => {
    const violation = makeViolation({ severity: 'error' });
    const processed = makeProcessed([{ violation, commentLine: 1 }]);
    const deltaMap = new Map([
      [
        'src/test.ts::testFn::cognitive',
        makeDelta({ severity: 'unchanged', delta: 0, baseValue: 20, headValue: 20 }),
      ],
    ]);

    expect(determineReviewEvent(processed, deltaMap, true)).toBe('COMMENT');
  });

  it('returns COMMENT for improved error-level violation (delta < 0)', () => {
    const violation = makeViolation({ severity: 'error' });
    const processed = makeProcessed([{ violation, commentLine: 1 }]);
    const deltaMap = new Map([
      [
        'src/test.ts::testFn::cognitive',
        makeDelta({ severity: 'improved', delta: -3, baseValue: 23, headValue: 20 }),
      ],
    ]);

    expect(determineReviewEvent(processed, deltaMap, true)).toBe('COMMENT');
  });

  it('returns REQUEST_CHANGES if any violation is a new error (mixed severities)', () => {
    const warning = makeViolation({ severity: 'warning', symbolName: 'warnFn' });
    const error = makeViolation({ severity: 'error', symbolName: 'errorFn' });
    const processed = makeProcessed([
      { violation: warning, commentLine: 1 },
      { violation: error, commentLine: 5 },
    ]);

    expect(determineReviewEvent(processed, new Map(), true)).toBe('REQUEST_CHANGES');
  });
});

// ---------------------------------------------------------------------------
// parseVeilleMarker / parseVeilleLogicMarker
// ---------------------------------------------------------------------------

describe('parseVeilleMarker', () => {
  it('extracts key from a valid complexity marker', () => {
    const body = '<!-- veille:src/auth.ts::handleLogin -->\n🟡 🧠 **Mental load: 25**';
    expect(parseVeilleMarker(body)).toBe('src/auth.ts::handleLogin');
  });

  it('returns null when no marker is present', () => {
    expect(parseVeilleMarker('🟡 some comment without marker')).toBeNull();
  });

  it('returns null when marker is malformed (missing closing)', () => {
    expect(parseVeilleMarker('<!-- veille:src/auth.ts::handleLogin')).toBeNull();
  });

  it('extracts key from logic marker', () => {
    const body = '<!-- veille-logic:src/api.ts::42::unchecked_error -->\n**Logic Review** (beta)';
    expect(parseVeilleLogicMarker(body)).toBe('src/api.ts::42::unchecked_error');
  });

  it('returns null for logic marker on complexity body', () => {
    const body = '<!-- veille:src/auth.ts::handleLogin -->\n🟡 comment';
    expect(parseVeilleLogicMarker(body)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// filterDuplicateComments
// ---------------------------------------------------------------------------

describe('filterDuplicateComments', () => {
  function makeComment(filepath: string, symbolName: string, extra = ''): LineComment {
    return {
      path: filepath,
      line: 10,
      body: `${VEILLE_COMMENT_MARKER_PREFIX}${filepath}::${symbolName} -->\n🟡 comment${extra}`,
    };
  }

  function makeLogicComment(
    filepath: string,
    line: number,
    category = 'unchecked_error',
  ): LineComment {
    return {
      path: filepath,
      line,
      body: `${VEILLE_LOGIC_MARKER_PREFIX}${filepath}::${line}::${category} -->\n**Logic Review** (beta)`,
    };
  }

  it('returns all comments when no existing keys', () => {
    const comments = [makeComment('a.ts', 'foo'), makeComment('b.ts', 'bar')];
    const { kept, skippedKeys } = filterDuplicateComments(
      comments,
      new Set(),
      VEILLE_COMMENT_MARKER_PREFIX,
    );
    expect(kept).toHaveLength(2);
    expect(skippedKeys).toHaveLength(0);
  });

  it('filters out comments matching existing keys', () => {
    const comments = [makeComment('a.ts', 'foo'), makeComment('b.ts', 'bar')];
    const existing = new Set(['a.ts::foo']);
    const { kept, skippedKeys } = filterDuplicateComments(
      comments,
      existing,
      VEILLE_COMMENT_MARKER_PREFIX,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].path).toBe('b.ts');
    expect(skippedKeys).toEqual(['a.ts::foo']);
  });

  it('filters all comments when all already exist', () => {
    const comments = [makeComment('a.ts', 'foo'), makeComment('b.ts', 'bar')];
    const existing = new Set(['a.ts::foo', 'b.ts::bar']);
    const { kept, skippedKeys } = filterDuplicateComments(
      comments,
      existing,
      VEILLE_COMMENT_MARKER_PREFIX,
    );
    expect(kept).toHaveLength(0);
    expect(skippedKeys).toHaveLength(2);
  });

  it('keeps comments without markers', () => {
    const noMarker: LineComment = { path: 'c.ts', line: 5, body: 'plain comment' };
    const comments = [makeComment('a.ts', 'foo'), noMarker];
    const existing = new Set(['a.ts::foo']);
    const { kept } = filterDuplicateComments(comments, existing, VEILLE_COMMENT_MARKER_PREFIX);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toBe(noMarker);
  });

  it('filters logic comments with logic marker prefix', () => {
    const comments = [makeLogicComment('a.ts', 10), makeLogicComment('b.ts', 20)];
    const existing = new Set(['a.ts::10::unchecked_error']);
    const { kept } = filterDuplicateComments(comments, existing, VEILLE_LOGIC_MARKER_PREFIX);
    expect(kept).toHaveLength(1);
    expect(kept[0].path).toBe('b.ts');
  });

  it('does not cross-match complexity keys against logic comments', () => {
    const comments = [makeLogicComment('a.ts', 10)];
    const complexityKeys = new Set(['a.ts::foo']);
    const { kept } = filterDuplicateComments(comments, complexityKeys, VEILLE_LOGIC_MARKER_PREFIX);
    expect(kept).toHaveLength(1); // no match — different marker prefix
  });

  it('does not dedup logic comments with different categories on the same line', () => {
    const comments = [
      makeLogicComment('a.ts', 10, 'unchecked_error'),
      makeLogicComment('a.ts', 10, 'null_deref'),
    ];
    const existing = new Set(['a.ts::10::unchecked_error']);
    const { kept } = filterDuplicateComments(comments, existing, VEILLE_LOGIC_MARKER_PREFIX);
    expect(kept).toHaveLength(1);
    expect(kept[0].body).toContain('null_deref');
  });
});

// ---------------------------------------------------------------------------
// buildDedupNote
// ---------------------------------------------------------------------------

describe('buildDedupNote', () => {
  it('returns empty string when no skipped keys', () => {
    expect(buildDedupNote([], [], new Map())).toBe('');
  });

  it('renders a single violation with severity and metric emojis', () => {
    const violation = makeViolation({
      filepath: 'src/auth.ts',
      symbolName: 'login',
      metricType: 'cognitive',
      complexity: 25,
      threshold: 15,
      severity: 'warning',
    });
    const result = buildDedupNote(['src/auth.ts::login'], [violation], new Map());
    expect(result).toContain('`login` in `src/auth.ts`');
    expect(result).toContain('🟡 🧠 mental load: 25');
    expect(result).toContain('(threshold: 15)');
    expect(result).toContain('1 violation already reviewed');
  });

  it('groups multiple metrics under one symbol heading', () => {
    const v1 = makeViolation({
      filepath: 'src/api.ts',
      symbolName: 'process',
      metricType: 'cyclomatic',
      complexity: 44,
      threshold: 30,
      severity: 'error',
    });
    const v2 = makeViolation({
      filepath: 'src/api.ts',
      symbolName: 'process',
      metricType: 'cognitive',
      complexity: 105,
      threshold: 30,
      severity: 'warning',
    });
    const result = buildDedupNote(['src/api.ts::process'], [v1, v2], new Map());

    // Symbol heading appears once
    const symbolMatches = result.match(/`process` in `src\/api\.ts`/g);
    expect(symbolMatches).toHaveLength(1);

    // Both metrics present as sub-items
    expect(result).toContain('🔴 🔀 test paths: 44 tests');
    expect(result).toContain('🟡 🧠 mental load: 105');
  });

  it('includes comment link when URL is available', () => {
    const violation = makeViolation({
      filepath: 'src/auth.ts',
      symbolName: 'login',
    });
    const urls = new Map([
      ['src/auth.ts::login', 'https://github.com/org/repo/pull/1#comment-123'],
    ]);
    const result = buildDedupNote(['src/auth.ts::login'], [violation], urls);
    expect(result).toContain('[review comment](https://github.com/org/repo/pull/1#comment-123)');
  });

  it('omits comment link when URL is not available', () => {
    const violation = makeViolation({
      filepath: 'src/auth.ts',
      symbolName: 'login',
    });
    const result = buildDedupNote(['src/auth.ts::login'], [violation], new Map());
    expect(result).not.toContain('review comment');
    expect(result).toContain('`login` in `src/auth.ts`');
  });

  it('renders fallback for skipped key with no matching violation', () => {
    const result = buildDedupNote(['src/old.ts::removed'], [], new Map());
    expect(result).toContain('`removed` in `src/old.ts`');
    // No metric sub-items
    expect(result).not.toContain('🔴');
    expect(result).not.toContain('🟡');
  });

  it('uses error emoji for error severity violations', () => {
    const violation = makeViolation({
      filepath: 'src/x.ts',
      symbolName: 'fn',
      severity: 'error',
      metricType: 'halstead_effort',
      complexity: 500000,
      threshold: 200000,
    });
    const result = buildDedupNote(['src/x.ts::fn'], [violation], new Map());
    expect(result).toContain('🔴 ⏱️');
  });

  it('pluralises correctly for multiple violations', () => {
    const v1 = makeViolation({ filepath: 'a.ts', symbolName: 'f1' });
    const v2 = makeViolation({ filepath: 'b.ts', symbolName: 'f2' });
    const result = buildDedupNote(['a.ts::f1', 'b.ts::f2'], [v1, v2], new Map());
    expect(result).toContain('2 violations already reviewed');
  });

  it('uses singular for exactly one violation', () => {
    const violation = makeViolation({ filepath: 'a.ts', symbolName: 'f1' });
    const result = buildDedupNote(['a.ts::f1'], [violation], new Map());
    expect(result).toContain('1 violation already reviewed');
    expect(result).not.toContain('1 violations');
  });
});
