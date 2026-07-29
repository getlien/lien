import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import os from 'os';
import * as coreModule from '@liendev/core';
import * as dependencyAnalyzerModule from '../mcp/handlers/dependency-analyzer.js';
import {
  annotateCommand,
  isTrivial,
  belowRiskFloor,
  formatDependents,
  formatTests,
  formatTestReminder,
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

// Spied (not replaced) so the `--tests-only` integration block below can
// assert `findDependents` is never called on that path — it's the whole
// point of `runTestsOnly` skipping the BFS/complexity work the full
// annotation needs.
vi.mock('../mcp/handlers/dependency-analyzer.js', async () => {
  const actual = await vi.importActual<typeof import('../mcp/handlers/dependency-analyzer.js')>(
    '../mcp/handlers/dependency-analyzer.js',
  );
  return {
    ...actual,
    findDependents: vi.fn(actual.findDependents),
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

  it('is never trivial when dependentAttributionIncomplete is true, even with test coverage present (#930/#936)', () => {
    expect(isTrivial(0, 0, 1, 0, true)).toBe(false);
  });

  it('defaults dependentAttributionIncomplete to false — pre-existing 4-arg callers are unaffected', () => {
    expect(isTrivial(0, 0, 1, 0)).toBe(true);
  });
});

describe('belowRiskFloor (habituation guard)', () => {
  it('never suppresses when no floor is set (default always-on behavior)', () => {
    expect(belowRiskFloor('low', 0, 0, undefined)).toBe(false);
    expect(belowRiskFloor('low', 0, 0, '')).toBe(false);
  });

  it('suppresses a below-floor risk level', () => {
    expect(belowRiskFloor('low', 0, 0, 'medium')).toBe(true);
    expect(belowRiskFloor('medium', 0, 0, 'high')).toBe(true);
  });

  it('does not suppress at or above the floor', () => {
    expect(belowRiskFloor('medium', 0, 0, 'medium')).toBe(false);
    expect(belowRiskFloor('high', 0, 0, 'medium')).toBe(false);
    expect(belowRiskFloor('critical', 0, 0, 'medium')).toBe(false);
  });

  it('always emits (never suppresses) when a complexity or headroom concern is present', () => {
    expect(belowRiskFloor('low', 1, 0, 'critical')).toBe(false); // complexity warning
    expect(belowRiskFloor('low', 0, 1, 'critical')).toBe(false); // headroom concern
  });

  it('treats an unknown floor as no floor (fail-open)', () => {
    expect(belowRiskFloor('low', 0, 0, 'bogus')).toBe(false);
  });

  it('treats an unknown risk level as the lowest rank', () => {
    expect(belowRiskFloor('mystery', 0, 0, 'medium')).toBe(true);
  });

  // Closes the gap Lien Review flagged on #938: isTrivial got the
  // dependentAttributionIncomplete carve-out, this guard sat three lines
  // below it and didn't — so a "0 dependents" annotation caused by
  // undeterminable attribution (not by an actual absence of dependents)
  // could still be silenced by --min-risk, restoring exactly the
  // false-all-clear misreading #930/#936/#938 shipped to prevent.
  it('clears the floor when dependent attribution is incomplete, even at the lowest risk level (#938 gap)', () => {
    expect(belowRiskFloor('low', 0, 0, 'critical', true)).toBe(false);
  });

  it('still suppresses the same below-floor case when attribution is complete', () => {
    expect(belowRiskFloor('low', 0, 0, 'critical', false)).toBe(true);
  });

  it('defaults dependentAttributionIncomplete to false — pre-existing 4-arg callers are unaffected', () => {
    expect(belowRiskFloor('low', 0, 0, 'medium')).toBe(true);
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

  // #869: whole-module-import languages (Swift confirmed) get an honest
  // "not determinable" signal instead of the misleading "No test coverage."
  // — import-based matching structurally cannot see per-file coverage for
  // these languages, so an empty array does not mean untested.
  it('reports not-determinable (not "no coverage") for an empty array on a Swift file', () => {
    expect(formatTests([], 'Sources/Alamofire/Session.swift')).toBe(
      'Test coverage not determinable from imports (whole-module import).',
    );
  });

  it('still reports "No test coverage." for an empty array on a non-whole-module-import language', () => {
    expect(formatTests([], 'src/user.ts')).toBe('No test coverage.');
  });

  it('still reports "No test coverage." for an empty array with no filepath given', () => {
    expect(formatTests([])).toBe('No test coverage.');
  });

  it('a non-empty array on a Swift file still lists the real tests, unaffected by the honesty branch', () => {
    expect(formatTests(['Tests/SessionTests.swift'], 'Sources/Alamofire/Session.swift')).toBe(
      'Test coverage: Tests/SessionTests.swift.',
    );
  });

  // #875: C# lets a nested namespace body reach an *enclosing* namespace's
  // members with zero `using` directive (AutoMapper.UnitTests -> AutoMapper),
  // so import-based matching has no per-file signal for a test that only
  // reaches its subject this way. Same honesty treatment as #869's Swift
  // case, via the separate `enclosingNamespaceAccess` flag.
  it('reports not-determinable (not "no coverage") for an empty array on a C# file', () => {
    expect(formatTests([], 'src/AutoMapper/TypeMap.cs')).toBe(
      'Test coverage not determinable from imports (enclosing-namespace access).',
    );
  });

  it('a non-empty array on a C# file still lists the real tests, unaffected by the honesty branch', () => {
    expect(formatTests(['src/UnitTests/Features.cs'], 'src/AutoMapper/TypeMap.cs')).toBe(
      'Test coverage: src/UnitTests/Features.cs.',
    );
  });

  // #902 tier 2: Go's same-package convention has real signal even when
  // `tests` (tier 1's basename pairing / imports) comes back empty --
  // package-level fallback gets its own distinct wording, never conflated
  // with a direct match or with Swift/C#'s "not determinable" (this case IS
  // determinable, just coarser).
  describe('Go package-level fallback (#902 tier 2)', () => {
    it('reports the distinct package-level wording when tests is empty but package-level tests exist', () => {
      expect(
        formatTests([], 'internal/licenses/embed_linux_amd64.go', [
          'internal/licenses/licenses_test.go',
        ]),
      ).toBe(
        'Test coverage (package-level, no dedicated test file for this specific file): internal/licenses/licenses_test.go.',
      );
    });

    it('truncates package-level fallback tests with a (+N more) suffix', () => {
      expect(
        formatTests([], 'pkg/cmd/codespace/root.go', [
          'pkg/cmd/codespace/create_test.go',
          'pkg/cmd/codespace/list_test.go',
          'pkg/cmd/codespace/edit_test.go',
        ]),
      ).toBe(
        'Test coverage (package-level, no dedicated test file for this specific file): pkg/cmd/codespace/create_test.go, pkg/cmd/codespace/list_test.go (+1 more).',
      );
    });

    it('still reports "No test coverage." when both tests and package-level tests are empty', () => {
      expect(formatTests([], 'pkg/cmd/label/untested.go', [])).toBe('No test coverage.');
    });

    it('ignores package-level tests entirely once a real (tier 1) association exists', () => {
      expect(
        formatTests(['pkg/cmd/label/list_test.go'], 'pkg/cmd/label/list.go', [
          'pkg/cmd/label/should-not-appear_test.go',
        ]),
      ).toBe('Test coverage: pkg/cmd/label/list_test.go.');
    });
  });

  // #869 measure-gated spike, tier 4 (lowest confidence): Swift's non-import
  // symbol-usage signal gets its own distinct "inferred" wording — never
  // conflated with a direct match or with the honest "not determinable"
  // label (this case has real, if lower-confidence, signal).
  describe('Swift symbol-usage fallback (#869 measure-gated spike)', () => {
    it('reports the distinct inferred wording when tests is empty but symbol-usage tests exist', () => {
      expect(
        formatTests([], 'Source/Core/HTTPHeaders.swift', [], ['Tests/HTTPHeadersTests.swift']),
      ).toBe(
        'Test coverage inferred from symbol usage (not import-verified): Tests/HTTPHeadersTests.swift.',
      );
    });

    it('truncates symbol-usage fallback tests with a (+N more) suffix', () => {
      expect(
        formatTests(
          [],
          'Source/Core/Request.swift',
          [],
          [
            'Tests/RequestTests.swift',
            'Tests/RequestRetryTests.swift',
            'Tests/RequestEventMonitorTests.swift',
          ],
        ),
      ).toBe(
        'Test coverage inferred from symbol usage (not import-verified): Tests/RequestTests.swift, Tests/RequestRetryTests.swift (+1 more).',
      );
    });

    it('still reports the honest "not determinable" label when symbol-usage tests are also empty', () => {
      expect(formatTests([], 'Source/Core/Untested.swift', [], [])).toBe(
        'Test coverage not determinable from imports (whole-module import).',
      );
    });

    it('ignores symbol-usage tests entirely once a real (tier 1) association exists', () => {
      expect(
        formatTests(
          ['Tests/SessionTests.swift'],
          'Source/Core/Session.swift',
          [],
          ['Tests/should-not-appear.swift'],
        ),
      ).toBe('Test coverage: Tests/SessionTests.swift.');
    });

    it('does not apply the Swift fallback wording on a non-whole-module-import language', () => {
      expect(formatTests([], 'src/user.ts', [], ['src/user-inferred.test.ts'])).toBe(
        'No test coverage.',
      );
    });
  });
});

describe('formatTestReminder', () => {
  it('renders the fixed reminder template for a single test', () => {
    expect(formatTestReminder('src/foo.ts', ['src/foo.test.ts'])).toBe(
      'Lien: you changed src/foo.ts — associated tests: src/foo.test.ts. Run them before completing.',
    );
  });

  it('lists up to MAX_TESTS_LISTED tests inline', () => {
    expect(formatTestReminder('src/foo.ts', ['a.test.ts', 'b.test.ts'])).toBe(
      'Lien: you changed src/foo.ts — associated tests: a.test.ts, b.test.ts. Run them before completing.',
    );
  });

  it('truncates extras with a (+N more) suffix', () => {
    expect(
      formatTestReminder('src/foo.ts', ['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts']),
    ).toBe(
      'Lien: you changed src/foo.ts — associated tests: a.test.ts, b.test.ts (+2 more). Run them before completing.',
    );
  });

  // #902 tier 2: mirrors formatTests's package-level fallback wording, for
  // the shorter post-edit reminder line.
  it('reports the package-level fallback wording when tests is empty but package-level tests exist', () => {
    expect(
      formatTestReminder(
        'internal/licenses/embed_linux_amd64.go',
        [],
        ['internal/licenses/licenses_test.go'],
      ),
    ).toBe(
      'Lien: you changed internal/licenses/embed_linux_amd64.go — no dedicated test file, but its package has: internal/licenses/licenses_test.go. Consider running them before completing.',
    );
  });

  it('prefers the direct-tests wording when both tests and package-level tests are non-empty', () => {
    expect(
      formatTestReminder('src/foo.ts', ['src/foo.test.ts'], ['should-not-appear.test.ts']),
    ).toBe(
      'Lien: you changed src/foo.ts — associated tests: src/foo.test.ts. Run them before completing.',
    );
  });

  // #869 measure-gated spike, tier 4: mirrors formatTests's inferred wording,
  // for the shorter post-edit reminder line. Consulted only when BOTH tests
  // and package-level tests are empty.
  it('reports the symbol-usage fallback wording when both tests and package-level tests are empty', () => {
    expect(
      formatTestReminder('Source/Core/HTTPHeaders.swift', [], [], ['Tests/HTTPHeadersTests.swift']),
    ).toBe(
      'Lien: you changed Source/Core/HTTPHeaders.swift — no import-verified test match, but symbol usage suggests: Tests/HTTPHeadersTests.swift (inferred, not import-verified). Consider running them before completing.',
    );
  });

  it('prefers the package-level wording over symbol-usage when both are non-empty', () => {
    expect(
      formatTestReminder(
        'internal/licenses/embed_linux_amd64.go',
        [],
        ['internal/licenses/licenses_test.go'],
        ['should-not-appear.swift'],
      ),
    ).toBe(
      'Lien: you changed internal/licenses/embed_linux_amd64.go — no dedicated test file, but its package has: internal/licenses/licenses_test.go. Consider running them before completing.',
    );
  });

  it('prefers the direct-tests wording over symbol-usage when both are non-empty', () => {
    expect(
      formatTestReminder(
        'Source/Core/Session.swift',
        ['Tests/SessionTests.swift'],
        [],
        ['should-not-appear.swift'],
      ),
    ).toBe(
      'Lien: you changed Source/Core/Session.swift — associated tests: Tests/SessionTests.swift. Run them before completing.',
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

  // #894: this used to be silent (an empty-but-plausible "no dependents/no
  // test coverage" annotation, or nothing at all) — now it's a loud,
  // one-line warning via stdout (never stderr — the read-hook pipes lien
  // annotate's stderr to /dev/null, so stdout is the only channel that
  // reaches the agent).
  it('warns loudly instead of silently analyzing an unindexed root (tmpHome has no index)', async () => {
    await annotateCommand('packages/cli/src/cli/index.ts');
    expect(errSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('Lien: no index found at the resolved project root');
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
      hasData: vi.fn().mockResolvedValue(true),
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
      hasData: vi.fn().mockResolvedValue(true),
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

describe('annotateCommand — --tests-only (integration)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  // Same stable target as the plan-time-nudge block above.
  const target = 'packages/cli/src/cli/index.ts';

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Earlier describe blocks in this file also exercise the real
    // `findDependents` (via the full, non-`testsOnly` path) without clearing
    // it themselves, so its call history can carry calls made before this
    // block ever runs. Reset here — not just in `afterEach` — so the first
    // test in this block starts from a clean slate too.
    vi.mocked(dependencyAnalyzerModule.findDependents).mockClear();
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    vi.mocked(coreModule.createVectorDB).mockClear();
    vi.mocked(dependencyAnalyzerModule.findDependents).mockClear();
  });

  it('prints the reminder line when a test imports the target file', async () => {
    const testChunk = {
      content: '',
      metadata: {
        file: 'packages/cli/src/cli/index.test.ts',
        startLine: 1,
        endLine: 5,
        type: 'function',
        language: 'typescript',
        symbolName: 'itWorks',
        symbolType: 'function',
        imports: [target],
      },
      score: 0,
      relevance: 'not_relevant',
    };
    vi.mocked(coreModule.createVectorDB).mockResolvedValueOnce({
      initialize: vi.fn().mockResolvedValue(undefined),
      hasData: vi.fn().mockResolvedValue(true),
      scanAll: vi.fn().mockResolvedValue([testChunk]),
    } as unknown as Awaited<ReturnType<typeof coreModule.createVectorDB>>);

    await annotateCommand(target, { testsOnly: true });

    expect(errSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toBe(
      `Lien: you changed ${target} — associated tests: packages/cli/src/cli/index.test.ts. Run them before completing.`,
    );
    // The whole point of --tests-only: skip findDependents's BFS entirely.
    expect(dependencyAnalyzerModule.findDependents).not.toHaveBeenCalled();
  });

  it('stays silent when the target file has no associated tests', async () => {
    const unrelatedChunk = {
      content: '',
      metadata: {
        file: 'packages/cli/src/cli/index.test.ts',
        startLine: 1,
        endLine: 5,
        type: 'function',
        language: 'typescript',
        symbolName: 'itWorks',
        symbolType: 'function',
        imports: ['some/other/file.ts'],
      },
      score: 0,
      relevance: 'not_relevant',
    };
    vi.mocked(coreModule.createVectorDB).mockResolvedValueOnce({
      initialize: vi.fn().mockResolvedValue(undefined),
      hasData: vi.fn().mockResolvedValue(true),
      scanAll: vi.fn().mockResolvedValue([unrelatedChunk]),
    } as unknown as Awaited<ReturnType<typeof coreModule.createVectorDB>>);

    await annotateCommand(target, { testsOnly: true });

    expect(errSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(dependencyAnalyzerModule.findDependents).not.toHaveBeenCalled();
  });

  // #869 measure-gated spike, end-to-end: a Swift source file with no import
  // signal at all (whole-module imports carry zero per-file information)
  // still surfaces its non-import symbol-usage fallback through the real
  // `scanTestAssociations` -> `computeSwiftSymbolUsageFallback` ->
  // `findSwiftSymbolUsageAssociations` -> `formatTestReminder` pipeline.
  //
  // `resolvePaths` requires the target to exist on disk, so this creates (and
  // cleans up) a throwaway `.swift` fixture under the real repo root rather
  // than mocking the filesystem — the only integration-safe way to exercise
  // this specific path with a Swift-detected extension.
  it('prints the symbol-usage fallback reminder for a Swift file with no import signal', async () => {
    const fs = await import('fs/promises');
    const repoRoot = path.resolve(process.cwd(), '..', '..');
    const fixtureDir = path.join(repoRoot, '__annotate_swift_fixture__');
    const swiftTarget = '__annotate_swift_fixture__/HTTPHeaders.swift';
    await fs.mkdir(fixtureDir, { recursive: true });
    await fs.writeFile(path.join(fixtureDir, 'HTTPHeaders.swift'), 'class HTTPHeaders {}\n');

    const declChunk = {
      content: '',
      metadata: {
        file: swiftTarget,
        startLine: 1,
        endLine: 20,
        type: 'class',
        language: 'swift',
        symbolName: 'HTTPHeaders',
        symbolType: 'class',
        signature: 'class HTTPHeaders',
      },
      score: 0,
      relevance: 'not_relevant',
    };
    const swiftTestChunk = {
      content: '',
      metadata: {
        file: 'Tests/HTTPHeadersTests.swift',
        startLine: 1,
        endLine: 10,
        type: 'function',
        language: 'swift',
        symbolName: 'testHeaders',
        symbolType: 'method',
        callSites: [{ symbol: 'HTTPHeaders', line: 5 }],
      },
      score: 0,
      relevance: 'not_relevant',
    };
    vi.mocked(coreModule.createVectorDB).mockResolvedValueOnce({
      initialize: vi.fn().mockResolvedValue(undefined),
      hasData: vi.fn().mockResolvedValue(true),
      scanAll: vi.fn().mockResolvedValue([declChunk, swiftTestChunk]),
    } as unknown as Awaited<ReturnType<typeof coreModule.createVectorDB>>);

    try {
      await annotateCommand(swiftTarget, { testsOnly: true });

      expect(errSpy).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0][0]).toBe(
        `Lien: you changed ${swiftTarget} — no import-verified test match, but symbol usage suggests: Tests/HTTPHeadersTests.swift (inferred, not import-verified). Consider running them before completing.`,
      );
    } finally {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });
});
