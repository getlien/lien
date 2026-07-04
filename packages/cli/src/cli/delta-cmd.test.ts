import { describe, it, expect } from 'vitest';
import {
  computeComplexityDelta,
  DEFAULT_COMPLEXITY_DELTA_THRESHOLDS,
  type ComplexityDeltaThresholds,
} from '@liendev/parser';
import { resolveDeltaThresholds, deltaExitCode, formatDeltaText } from './delta-cmd.js';

const stripAnsi = (s: string): string => s.replace(/\[[0-9;]*m/g, '');

const BODY = {
  oneIf: 'function target(x){ if(x){return 1;} return 2; }', // cog 1
  twoNest: 'function target(x){ if(x){ if(x>1){ return 1; } } return 2; }', // cog 3
  threeNest: 'function target(x){ if(x){ if(x>1){ if(x>2){ return 1; } } } return 2; }', // cog 6
} as const;

const COG_ONLY: ComplexityDeltaThresholds = {
  testPaths: 1000,
  mentalLoad: 5,
  timeToUnderstandMinutes: 100000,
  estimatedBugs: 1000,
};

describe('resolveDeltaThresholds', () => {
  it('returns defaults when no config and no flag', () => {
    expect(resolveDeltaThresholds(undefined, undefined)).toEqual(
      DEFAULT_COMPLEXITY_DELTA_THRESHOLDS,
    );
  });

  it('takes defined config values and ignores missing ones (no undefined clobber)', () => {
    const resolved = resolveDeltaThresholds({ testPaths: 20, mentalLoad: 25 }, undefined);
    expect(resolved.testPaths).toBe(20);
    expect(resolved.mentalLoad).toBe(25);
    // untouched keys keep their defaults
    expect(resolved.timeToUnderstandMinutes).toBe(
      DEFAULT_COMPLEXITY_DELTA_THRESHOLDS.timeToUnderstandMinutes,
    );
    expect(resolved.estimatedBugs).toBe(DEFAULT_COMPLEXITY_DELTA_THRESHOLDS.estimatedBugs);
  });

  it('--threshold overrides cyclomatic + cognitive only', () => {
    const resolved = resolveDeltaThresholds({ testPaths: 20, mentalLoad: 20 }, '7');
    expect(resolved.testPaths).toBe(7);
    expect(resolved.mentalLoad).toBe(7);
    expect(resolved.timeToUnderstandMinutes).toBe(
      DEFAULT_COMPLEXITY_DELTA_THRESHOLDS.timeToUnderstandMinutes,
    );
  });

  it('ignores a non-numeric --threshold', () => {
    const resolved = resolveDeltaThresholds({ testPaths: 20, mentalLoad: 20 }, 'abc');
    expect(resolved.testPaths).toBe(20);
    expect(resolved.mentalLoad).toBe(20);
  });
});

describe('deltaExitCode', () => {
  const withRegression = computeComplexityDelta(
    [{ filepath: 'a.ts', before: BODY.twoNest, after: BODY.threeNest }],
    COG_ONLY,
  );
  const clean = computeComplexityDelta(
    [{ filepath: 'a.ts', before: BODY.threeNest, after: BODY.oneIf }],
    COG_ONLY,
  );

  it('exits 1 on a regression', () => {
    expect(deltaExitCode(withRegression, false)).toBe(1);
  });

  it('exits 0 when clean', () => {
    expect(deltaExitCode(clean, false)).toBe(0);
  });

  it('--soft forces exit 0 even with a regression', () => {
    expect(deltaExitCode(withRegression, true)).toBe(0);
  });
});

describe('formatDeltaText', () => {
  it('renders a crossing with the metric, values, limit and a call-to-action footer', () => {
    const result = computeComplexityDelta(
      [{ filepath: 'src/foo.ts', before: BODY.twoNest, after: BODY.threeNest }],
      COG_ONLY,
    );
    const text = stripAnsi(formatDeltaText(result, 42));
    expect(text).toContain('src/foo.ts');
    expect(text).toContain('crossed');
    expect(text).toContain('target');
    expect(text).toContain('cognitive 3 → 6');
    expect(text).toContain('(limit 5)');
    expect(text).toContain('1 new crossing');
    expect(text).toContain('42 ms');
    expect(text).toContain('Simplify before committing');
  });

  it('renders improvements without a failure footer', () => {
    const result = computeComplexityDelta(
      [{ filepath: 'src/foo.ts', before: BODY.threeNest, after: BODY.oneIf }],
      COG_ONLY,
    );
    const text = stripAnsi(formatDeltaText(result, 10));
    expect(text).toContain('improved');
    expect(text).toContain('1 improved');
    expect(text).not.toContain('Simplify before committing');
  });

  it('reports a clean line when there are no changes', () => {
    const text = stripAnsi(formatDeltaText(computeComplexityDelta([], COG_ONLY), 5));
    expect(text).toContain('no complexity-affecting changes vs HEAD');
    expect(text).toContain('5 ms');
  });

  it('labels renamed files', () => {
    const result = computeComplexityDelta(
      [{ filepath: 'new.ts', oldPath: 'old.ts', before: BODY.twoNest, after: BODY.threeNest }],
      COG_ONLY,
    );
    const text = stripAnsi(formatDeltaText(result, 1));
    expect(text).toContain('new.ts');
    expect(text).toContain('renamed from old.ts');
  });
});
