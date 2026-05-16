import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import os from 'os';
import {
  annotateCommand,
  isTrivial,
  formatDependents,
  formatTests,
  formatComplexity,
} from './annotate-cmd.js';

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
  const dep = (filepath: string, isTestFile = false) => ({ filepath, isTestFile });

  it('singular form for one dependent, with its path listed', () => {
    expect(formatDependents([dep('src/auth.ts')], 'low', [])).toBe(
      '1 file imports this — src/auth.ts; risk: low.',
    );
  });

  it('plural form, listing up to MAX_DEPS_LISTED files, with reasoning', () => {
    const deps = [
      dep('handlers/login.ts'),
      dep('handlers/logout.ts'),
      dep('handlers/refresh.ts'),
      dep('handlers/session.ts'),
    ];
    expect(formatDependents(deps, 'high', ['4 callers', '1 untested'])).toBe(
      '4 files import this — handlers/login.ts, handlers/logout.ts, handlers/refresh.ts, handlers/session.ts; risk: high (4 callers, 1 untested).',
    );
  });

  it('truncates with +N more when over the listed cap', () => {
    const many = Array.from({ length: 14 }, (_, i) => dep(`src/file-${i}.ts`));
    const formatted = formatDependents(many, 'critical', ['14 callers']);
    expect(formatted).toContain('14 files import this');
    expect(formatted).toContain('src/file-0.ts');
    expect(formatted).toContain('src/file-3.ts');
    expect(formatted).toContain('+10 more');
    expect(formatted).toContain('risk: critical (14 callers)');
  });

  it('sorts production dependents before tests', () => {
    const deps = [
      dep('test/auth.test.ts', true),
      dep('src/api.ts'),
      dep('test/api.test.ts', true),
      dep('src/handlers.ts'),
    ];
    const formatted = formatDependents(deps, 'medium', []);
    // Both prod files should appear before either test file in the listing.
    const idxApi = formatted.indexOf('src/api.ts');
    const idxHandlers = formatted.indexOf('src/handlers.ts');
    const idxAuthTest = formatted.indexOf('test/auth.test.ts');
    expect(Math.max(idxApi, idxHandlers)).toBeLessThan(idxAuthTest);
  });

  it('omits the risk parenthetical when reasoning is empty', () => {
    expect(formatDependents([dep('src/a.ts'), dep('src/b.ts')], 'medium', [])).toBe(
      '2 files import this — src/a.ts, src/b.ts; risk: medium.',
    );
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
