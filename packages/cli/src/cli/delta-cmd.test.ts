import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
  fmtValue,
  deltaCommand,
  type DeltaOptions,
} from './delta-cmd.js';

const execFileAsync = promisify(execFile);

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

  it('renders the header against a custom baseLabel (--base <ref>)', () => {
    const result = computeComplexityDelta(
      [{ filepath: 'src/foo.ts', before: BODY.twoNest, after: BODY.threeNest }],
      COG_ONLY,
    );
    const text = stripAnsi(formatDeltaText(result, 7, 'origin/main'));
    expect(text).toContain('lien delta — complexity vs origin/main');
    expect(text).not.toContain('vs HEAD');
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

describe('fmtValue — display formatting guards', () => {
  it('renders null as an em-dash', () => {
    expect(fmtValue(null, 'cognitive')).toBe('–');
  });

  it('renders NaN and Infinity as an em-dash, never "NaNm"/"Infinitym"', () => {
    expect(fmtValue(Number.NaN, 'halstead_effort')).toBe('–');
    expect(fmtValue(Number.POSITIVE_INFINITY, 'halstead_effort')).toBe('–');
    expect(fmtValue(Number.NaN, 'cognitive')).toBe('–');
    expect(fmtValue(Number.NaN, 'halstead_bugs')).toBe('–');
  });

  it('floors halstead effort minutes so display never overstates past a limit', () => {
    expect(fmtValue(59.7, 'halstead_effort')).toBe('59m');
  });

  it('formats bugs with two decimals and integers verbatim', () => {
    expect(fmtValue(1.5, 'halstead_bugs')).toBe('1.50');
    expect(fmtValue(12, 'cognitive')).toBe('12');
  });
});

describe('deltaCommand — operational failures exit 2 (Phase-1 findings #2, #3)', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Throw a sentinel encoding the exit code so a mocked process.exit actually
    // halts deltaCommand (as the real one would) — the sentinel `__exit__:2`
    // asserted below is what proves exit(2) was reached.
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
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

  it('exits 2 on an empty --file (usage error, not silence)', async () => {
    await expect(deltaCommand({ format: 'text', file: '' })).rejects.toThrow('__exit__:2');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('non-empty path'));
  });

  it('exits 2 on a whitespace-only --file', async () => {
    await expect(deltaCommand({ format: 'text', file: '   ' })).rejects.toThrow('__exit__:2');
  });

  it('exits 2 on an empty --base (usage error, not "use HEAD")', async () => {
    await expect(deltaCommand({ format: 'text', base: '' })).rejects.toThrow('__exit__:2');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('non-empty ref'));
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

describe('deltaCommand — --base <ref> integration (real git fixtures)', () => {
  let dir: string;
  let originalCwd: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  async function git(...args: string[]): Promise<void> {
    await execFileAsync('git', args, { cwd: dir });
  }

  async function write(rel: string, content: string): Promise<void> {
    const full = path.join(dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf-8');
  }

  async function initRepo(): Promise<void> {
    await git('init', '-q');
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('config', 'commit.gpgsign', 'false');
  }

  async function commitAll(msg: string): Promise<void> {
    await git('add', '-A');
    await git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', msg);
  }

  async function revParse(ref: string): Promise<string> {
    const { stdout } = await execFileAsync('git', ['rev-parse', ref], { cwd: dir });
    return stdout.trim();
  }

  /** Run deltaCommand and resolve to the exit code, instead of throwing the sentinel. */
  async function runDelta(options: DeltaOptions): Promise<number> {
    try {
      await deltaCommand(options);
    } catch (error) {
      const match = /__exit__:(\d+)/.exec(error instanceof Error ? error.message : String(error));
      if (match) return Number(match[1]);
      throw error;
    }
    return 0;
  }

  /** Parses the last console.log call as JSON, stripping the timing-noise field. */
  function lastJsonLog(): Record<string, unknown> {
    const call = logSpy.mock.calls.at(-1);
    const { elapsedMs: _elapsedMs, ...rest } = JSON.parse(String(call?.[0]));
    return rest;
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-delta-cmd-'));
    dir = await fs.realpath(dir); // resolve macOS /var -> /private/var
    originalCwd = process.cwd();
    process.chdir(dir);

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code}`);
    }) as never);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('--base <HEAD sha> is equivalent to the default (no --base)', async () => {
    await initRepo();
    await write('a.ts', BODY.oneIf);
    await commitAll('init');
    await write('a.ts', BODY.twoNest); // uncommitted crossing (against threshold 2)

    const head = await revParse('HEAD');
    const exitDefault = await runDelta({ format: 'json', threshold: '2' });
    const resultDefault = lastJsonLog();
    const exitWithBase = await runDelta({ format: 'json', threshold: '2', base: head });
    const resultWithBase = lastJsonLog();

    expect(exitDefault).toBe(1);
    expect(exitWithBase).toBe(1);
    expect(resultWithBase).toEqual(resultDefault);
  });

  it('catches a crossing introduced relative to base but invisible vs HEAD (the CI case)', async () => {
    await initRepo();
    await write('a.ts', BODY.oneIf);
    await commitAll('init'); // this is the PR's base (e.g. origin/main)
    const base = await revParse('HEAD');

    await write('a.ts', BODY.twoNest);
    await commitAll('introduce crossing'); // committed: HEAD === working tree now

    // Plain `lien delta` (vs HEAD) sees no diff at all — nothing to flag.
    const exitVsHead = await runDelta({ format: 'json', threshold: '2' });
    expect(exitVsHead).toBe(0);
    expect((lastJsonLog() as { summary: { regressions: number } }).summary.regressions).toBe(0);

    // `lien delta --base <base>` sees the committed crossing.
    const exitVsBase = await runDelta({ format: 'json', threshold: '2', base });
    expect(exitVsBase).toBe(1);
    const result = lastJsonLog() as { summary: { regressions: number } };
    expect(result.summary.regressions).toBe(1);
  });

  it('exits 2 with a clear message when --base does not resolve to a commit', async () => {
    await initRepo();
    await write('a.ts', BODY.oneIf);
    await commitAll('init');

    const exitCode = await runDelta({ format: 'text', base: 'totally-not-a-ref' });
    expect(exitCode).toBe(2);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('base ref "totally-not-a-ref" not found'),
    );
  });

  it('loads complexity.thresholds from a real .lien.config.json on disk (no --threshold flag)', async () => {
    await initRepo();
    await write('a.ts', BODY.oneIf);
    await commitAll('init');
    // cog 3 — under the built-in default mentalLoad (15), so it would be
    // invisible without the config-loaded threshold below.
    await write('a.ts', BODY.twoNest);

    // No .lien.config.json yet: default thresholds see no regression.
    const exitBeforeConfig = await runDelta({ format: 'json' });
    expect(exitBeforeConfig).toBe(0);

    await write(
      '.lien.config.json',
      JSON.stringify({ complexity: { thresholds: { mentalLoad: 2 } } }),
    );

    // Same working tree, no --threshold flag: configService.load() must have
    // picked up complexity.thresholds.mentalLoad from disk for this to flag.
    const exitAfterConfig = await runDelta({ format: 'json' });
    expect(exitAfterConfig).toBe(1);
    expect((lastJsonLog() as { summary: { regressions: number } }).summary.regressions).toBe(1);
  });
});
