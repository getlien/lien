import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  computeComplexityDelta,
  DEFAULT_COMPLEXITY_DELTA_THRESHOLDS,
  type ComplexityDeltaThresholds,
} from '@liendev/parser';
import * as core from '@liendev/core';
import {
  resolveDeltaThresholds,
  parseThresholdFlag,
  deltaExitCode,
  formatDeltaText,
  deltaCommand,
} from './delta-cmd.js';

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

  it('--threshold override applies to cyclomatic + cognitive only', () => {
    const resolved = resolveDeltaThresholds({ testPaths: 20, mentalLoad: 20 }, 7);
    expect(resolved.testPaths).toBe(7);
    expect(resolved.mentalLoad).toBe(7);
    expect(resolved.timeToUnderstandMinutes).toBe(
      DEFAULT_COMPLEXITY_DELTA_THRESHOLDS.timeToUnderstandMinutes,
    );
  });
});

describe('parseThresholdFlag', () => {
  it('returns undefined when the flag is absent', () => {
    expect(parseThresholdFlag(undefined)).toBeUndefined();
  });

  it('parses a positive integer', () => {
    expect(parseThresholdFlag('7')).toBe(7);
    expect(parseThresholdFlag(' 12 ')).toBe(12); // tolerant of surrounding whitespace
  });

  it('rejects a negative value (would make every function a regression)', () => {
    expect(() => parseThresholdFlag('-5')).toThrow(/positive integer/);
  });

  it('rejects a float (parseInt would silently truncate it)', () => {
    expect(() => parseThresholdFlag('5.7')).toThrow(/positive integer/);
  });

  it('rejects zero', () => {
    expect(() => parseThresholdFlag('0')).toThrow(/greater than 0/);
  });

  it('rejects a non-numeric value', () => {
    expect(() => parseThresholdFlag('abc')).toThrow(/positive integer/);
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

describe('deltaCommand — operational failures exit 2 (Phase-1 findings #2, #3)', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Throw a sentinel so a mocked process.exit actually halts deltaCommand,
    // exactly as the real one would (rather than letting it run on).
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code}`);
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits 2 on a negative --threshold (validated before any git/config work)', async () => {
    await expect(deltaCommand({ format: 'text', threshold: '-5' })).rejects.toThrow('__exit__:2');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('positive integer'));
  });

  it('exits 2 on a float --threshold', async () => {
    await expect(deltaCommand({ format: 'text', threshold: '5.7' })).rejects.toThrow('__exit__:2');
  });

  it('exits 2 when config fails to load (malformed .lien.config.json)', async () => {
    vi.spyOn(core.configService, 'load').mockRejectedValue(
      new SyntaxError('Unexpected token } in JSON'),
    );
    await expect(deltaCommand({ format: 'text' })).rejects.toThrow('__exit__:2');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('failed to load config'));
    // No report is printed on the error path.
    expect(logSpy).not.toHaveBeenCalled();
  });
});
