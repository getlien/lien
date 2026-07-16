import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import os from 'os';
import * as coreModule from '@liendev/core';
import {
  annotateCommand,
  isTrivial,
  formatDependents,
  formatTests,
  formatComplexity,
  withHeadroomWarning,
} from './annotate-cmd.js';

// Only `createVectorDB` is mocked (and only used by the plan-time-nudge
// integration block below) — every other integration test in this file
// exercises the real factory against an empty tmp home. `...actual` keeps
// `ComplexityAnalyzer` (also imported by annotate-cmd.ts) real throughout.
vi.mock('@liendev/core', async () => {
  const actual = await vi.importActual<typeof import('@liendev/core')>('@liendev/core');
  return {
    ...actual,
    createVectorDB: vi.fn(actual.createVectorDB),
  };
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

  it('defaults headroomCount to 0 — pre-existing 3-arg callers are unaffected', () => {
    expect(isTrivial(0, 0, 1)).toBe(true);
  });

  it('is non-trivial when a function is near/over its complexity budget, even otherwise-trivial', () => {
    expect(isTrivial(0, 0, 1, 1)).toBe(false);
    expect(isTrivial(1, 0, 1, 2)).toBe(false);
  });

  it('is trivial when headroomCount is explicitly 0', () => {
    expect(isTrivial(0, 0, 1, 0)).toBe(true);
  });
});

describe('withHeadroomWarning', () => {
  const lines = ['Lien impact for src/a.ts:', '  • No test coverage.'];

  it('passes lines through unchanged when there are no headroom entries', () => {
    expect(withHeadroomWarning(lines, { entries: [], overflow: 0 })).toBe(lines);
  });

  it('prepends the shared nudge line ahead of the existing lines', () => {
    const result = withHeadroomWarning(lines, {
      entries: [{ symbol: 'scanPatches', metric: 'cognitive', value: 18, threshold: 15 }],
      overflow: 0,
    });
    expect(result[0]).toBe(
      '⚠ Lien: scanPatches cognitive 18/15 (over) — avoid adding complexity here; prefer extraction.',
    );
    expect(result.slice(1)).toEqual(lines);
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

describe('annotateCommand — plan-time nudge (integration)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  // A real, stable file so `resolvePaths`' existsSync check passes — same
  // one the "missing index" test above already relies on resolving cleanly.
  const target = 'packages/cli/src/cli/index.ts';

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    vi.mocked(coreModule.createVectorDB).mockClear();
  });

  it('leads the printed annotation with the shared headroom nudge line', async () => {
    const overBudgetChunk = {
      content: '',
      metadata: {
        file: target,
        startLine: 1,
        endLine: 20,
        type: 'function',
        language: 'typescript',
        symbolName: 'overBudgetFn',
        symbolType: 'function',
        cognitiveComplexity: 20,
        imports: [],
      },
      score: 0,
      relevance: 'not_relevant',
    };
    vi.mocked(coreModule.createVectorDB).mockResolvedValueOnce({
      initialize: vi.fn().mockResolvedValue(undefined),
      scanAll: vi.fn().mockResolvedValue([overBudgetChunk]),
    } as unknown as Awaited<ReturnType<typeof coreModule.createVectorDB>>);

    await annotateCommand(target);

    expect(errSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    const printed = logSpy.mock.calls[0][0] as string;
    const printedLines = printed.split('\n');
    expect(printedLines[0]).toBe(
      '⚠ Lien: overBudgetFn cognitive 20/15 (over) — avoid adding complexity here; prefer extraction.',
    );
    expect(printed).toContain(`Lien impact for ${target}:`);
  });

  it('stays on the non-nudge path (no leading warning line) when nothing is near budget', async () => {
    const quietChunk = {
      content: '',
      metadata: {
        file: target,
        startLine: 1,
        endLine: 5,
        type: 'function',
        language: 'typescript',
        symbolName: 'tidyFn',
        symbolType: 'function',
        cognitiveComplexity: 2,
        imports: [],
      },
      score: 0,
      relevance: 'not_relevant',
    };
    vi.mocked(coreModule.createVectorDB).mockResolvedValueOnce({
      initialize: vi.fn().mockResolvedValue(undefined),
      scanAll: vi.fn().mockResolvedValue([quietChunk]),
    } as unknown as Awaited<ReturnType<typeof coreModule.createVectorDB>>);

    await annotateCommand(target);

    expect(errSpy).not.toHaveBeenCalled();
    // Still non-trivial (no test coverage), so it prints — but the first line
    // must be the impact header, not a nudge, since nothing is near budget.
    expect(logSpy).toHaveBeenCalledTimes(1);
    const printed = logSpy.mock.calls[0][0] as string;
    expect(printed.split('\n')[0]).toBe(`Lien impact for ${target}:`);
    expect(printed).not.toContain('avoid adding complexity');
  });
});
