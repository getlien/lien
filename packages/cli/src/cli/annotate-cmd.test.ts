import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import os from 'os';
import {
  annotateCommand,
  toRelative,
  isTrivial,
  formatDependents,
  formatTests,
  formatComplexity,
} from './annotate-cmd.js';

describe('toRelative', () => {
  const root = '/repo/root';

  it('returns clean relative input untouched', () => {
    expect(toRelative('src/foo.ts', root)).toBe('src/foo.ts');
  });

  it('strips an absolute path that lives under root', () => {
    expect(toRelative('/repo/root/src/foo.ts', root)).toBe('src/foo.ts');
  });

  it('returns the input untouched when resolved path escapes root', () => {
    expect(toRelative('../outside.ts', root)).toBe('../outside.ts');
  });

  it('returns empty for empty input', () => {
    expect(toRelative('', root)).toBe('');
  });
});

describe('isTrivial', () => {
  it('is trivial when no deps, no complexity, and tests present', () => {
    expect(isTrivial(0, 0, 1)).toBe(true);
    expect(isTrivial(1, 0, 1)).toBe(true);
  });

  it('is non-trivial without test coverage', () => {
    expect(isTrivial(0, 0, 0)).toBe(false);
  });

  it('is non-trivial when there are complexity warnings', () => {
    expect(isTrivial(0, 1, 1)).toBe(false);
  });

  it('is non-trivial above the dependent threshold', () => {
    expect(isTrivial(2, 0, 1)).toBe(false);
  });
});

describe('formatDependents', () => {
  it('singular form for one dependent', () => {
    expect(formatDependents(1, 'low', [])).toBe('1 file imports this; risk: low.');
  });

  it('plural form and reasoning when present', () => {
    expect(formatDependents(14, 'high', ['14 callers', '3 untested'])).toBe(
      '14 files import this; risk: high (14 callers, 3 untested).',
    );
  });

  it('omits the parenthetical when reasoning is empty', () => {
    expect(formatDependents(3, 'medium', [])).toBe('3 files import this; risk: medium.');
  });
});

describe('formatTests', () => {
  it('reports no coverage when array is empty', () => {
    expect(formatTests([])).toBe('No test coverage.');
  });

  it('lists up to two test files inline', () => {
    expect(formatTests(['a.test.ts', 'b.test.ts'])).toBe('Test coverage: a.test.ts, b.test.ts.');
  });

  it('truncates extras with a (+N more) suffix', () => {
    expect(formatTests(['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts'])).toBe(
      'Test coverage: a.test.ts, b.test.ts (+2 more).',
    );
  });
});

describe('formatComplexity', () => {
  it('singular for one violation', () => {
    expect(formatComplexity({ max: 12, warningCount: 1 })).toBe(
      'Max cyclomatic complexity: 12 (1 function over warn threshold).',
    );
  });

  it('plural for multiple', () => {
    expect(formatComplexity({ max: 18, warningCount: 3 })).toBe(
      'Max cyclomatic complexity: 18 (3 functions over warn threshold).',
    );
  });
});

describe('annotateCommand (integration)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let tmpHome: string;
  let homeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Redirect home so a real-world `~/.lien` index never gets touched.
    const fs = await import('fs/promises');
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-annotate-test-'));
    homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
  });

  afterEach(async () => {
    const fs = await import('fs/promises');
    logSpy.mockRestore();
    errSpy.mockRestore();
    homeSpy.mockRestore();
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it('silently exits for a non-existent file', async () => {
    await annotateCommand('this/path/does/not/exist.ts');
    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('silently exits for an empty path', async () => {
    await annotateCommand('');
    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('silently exits when the index is missing (tmpHome has none)', async () => {
    await annotateCommand('packages/cli/src/cli/index.ts');
    // VectorDB init against an empty tmp home should fail or return empty;
    // either way, the command must not throw or print errors.
    expect(errSpy).not.toHaveBeenCalled();
  });
});
