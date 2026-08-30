import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { CodeChunk, ComplexityReport } from '@liendev/parser';
import {
  scoreRisk,
  classifyShape,
  describeShape,
  recommendFor,
  analyzeHealth,
  buildEntries,
  cognitiveFor,
  computeCoverage,
  describeScanFailure,
  plural,
  renderNothingShown,
  toJson,
  renderText,
  type HealthResult,
  type RiskEntry,
} from './health-cmd.js';

const stripAnsi = (s: string): string => s.replace(/\[[0-9;]*m/g, '');

function chunk(
  file: string,
  startLine: number,
  language: string,
  cognitiveComplexity?: number,
): CodeChunk {
  return {
    content: '',
    metadata: {
      file,
      startLine,
      endLine: startLine + 10,
      type: 'function',
      language,
      symbolName: 'fn',
      cognitiveComplexity,
    },
  } as CodeChunk;
}

function report(
  files: Record<string, Array<{ startLine: number; symbolName: string; complexity: number }>>,
): ComplexityReport {
  const entries = Object.entries(files).map(([filepath, violations]) => [
    filepath,
    {
      violations: violations.map(v => ({
        filepath,
        startLine: v.startLine,
        endLine: v.startLine + 10,
        symbolName: v.symbolName,
        symbolType: 'function',
        language: 'typescript',
        complexity: v.complexity,
        threshold: 10,
        severity: 'warning',
        message: 'too complex',
        metricType: 'cognitive',
      })),
      dependents: [],
      testAssociations: [],
    },
  ]);

  return {
    summary: {
      filesAnalyzed: entries.length,
      totalViolations: Object.values(files).flat().length,
      bySeverity: { error: 0, warning: Object.values(files).flat().length },
      avgComplexity: 1,
      maxComplexity: 1,
    },
    files: Object.fromEntries(entries),
  } as unknown as ComplexityReport;
}

describe('scoreRisk', () => {
  it('never returns zero for a complex function with no dependents', () => {
    // log2(1+0) is 0; the +1 offset is what keeps isolated debt on the board.
    expect(scoreRisk(20, 0, true)).toBeGreaterThan(0);
  });

  it('doubles the score when a function is untested', () => {
    expect(scoreRisk(10, 3, false)).toBe(scoreRisk(10, 3, true) * 2);
  });

  it('damps fan-in logarithmically so one mega-imported file cannot dominate', () => {
    const tenfold = scoreRisk(10, 100, true) / scoreRisk(10, 10, true);
    expect(tenfold).toBeLessThan(2);
  });

  it('rises with complexity', () => {
    expect(scoreRisk(30, 5, true)).toBeGreaterThan(scoreRisk(10, 5, true));
  });
});

describe('describeScanFailure', () => {
  it('reports the scanner’s own error when the scan failed', () => {
    expect(describeScanFailure(false, 'No files found to index', 0)).toBe(
      'No files found to index',
    );
  });

  it('still reports a failure when the scanner gave no reason', () => {
    expect(describeScanFailure(false, undefined, 0)).toContain('unreported reason');
  });

  it('treats a successful scan with zero chunks as no data, not as clean', () => {
    expect(describeScanFailure(true, undefined, 0)).toContain('no parseable chunks');
  });

  it('returns undefined only when the scan genuinely produced content', () => {
    expect(describeScanFailure(true, undefined, 42)).toBeUndefined();
  });
});

describe('cognitiveFor', () => {
  const violation = (metricType: string, complexity: number) =>
    ({ metricType, complexity }) as never;

  it('prefers the chunk’s measured cognitive complexity', () => {
    expect(cognitiveFor(chunk('a.ts', 1, 'typescript', 12), violation('cognitive', 99))).toBe(12);
  });

  it('accepts a cognitive violation as a stand-in when the chunk has none', () => {
    expect(cognitiveFor(chunk('a.ts', 1, 'typescript'), violation('cognitive', 19))).toBe(19);
  });

  it('accepts cyclomatic as a stand-in — comparable scale', () => {
    expect(cognitiveFor(chunk('a.ts', 1, 'typescript'), violation('cyclomatic', 19))).toBe(19);
  });

  it('refuses Halstead effort as a stand-in — thousands-scale would dominate the ranking', () => {
    expect(cognitiveFor(chunk('a.ts', 1, 'typescript'), violation('halstead_effort', 7087))).toBe(
      0,
    );
  });

  it('refuses Halstead bugs as a stand-in', () => {
    expect(cognitiveFor(chunk('a.ts', 1, 'typescript'), violation('halstead_bugs', 2))).toBe(0);
  });

  it('handles a missing chunk entirely', () => {
    expect(cognitiveFor(undefined, violation('cognitive', 8))).toBe(8);
  });
});

describe('classifyShape', () => {
  it('calls a complex, widely-used, untested function dangerous', () => {
    expect(classifyShape(20, 10, false)).toBe('dangerous');
  });

  it('calls the same function expensive once it has tests', () => {
    expect(classifyShape(20, 10, true)).toBe('expensive');
  });

  it('calls a simple, widely-used, untested function a cheap win', () => {
    expect(classifyShape(3, 10, false)).toBe('cheap-win');
  });

  it('calls complex code nothing depends on isolated', () => {
    expect(classifyShape(20, 0, false)).toBe('isolated');
  });

  it('does not flag a simple, widely-used, tested function', () => {
    expect(classifyShape(3, 10, true)).toBe('isolated');
  });
});

describe('describeShape / recommendFor', () => {
  it('gives every shape a description and a recommendation', () => {
    (['dangerous', 'expensive', 'cheap-win', 'isolated'] as const).forEach(shape => {
      expect(describeShape(shape).length).toBeGreaterThan(0);
      expect(recommendFor(shape).length).toBeGreaterThan(0);
    });
  });
});

describe('buildEntries', () => {
  it('collapses a function’s multiple metric violations into one entry', () => {
    const r = report({
      'a.ts': [
        { startLine: 1, symbolName: 'run', complexity: 30 },
        { startLine: 1, symbolName: 'run', complexity: 40 },
      ],
    });
    const entries = buildEntries(r, [chunk('a.ts', 1, 'typescript', 25)], new Map(), new Map());
    expect(entries).toHaveLength(1);
  });

  it('prefers the chunk’s cognitive complexity over the violation metric', () => {
    const r = report({ 'a.ts': [{ startLine: 1, symbolName: 'run', complexity: 99 }] });
    const entries = buildEntries(r, [chunk('a.ts', 1, 'typescript', 25)], new Map(), new Map());
    expect(entries[0].cognitive).toBe(25);
  });

  it('falls back to the violation metric when the chunk has no cognitive value', () => {
    const r = report({ 'a.ts': [{ startLine: 1, symbolName: 'run', complexity: 99 }] });
    const entries = buildEntries(r, [chunk('a.ts', 1, 'typescript')], new Map(), new Map());
    expect(entries[0].cognitive).toBe(99);
  });

  it('joins fan-in and test associations onto the entry', () => {
    const r = report({ 'a.ts': [{ startLine: 1, symbolName: 'run', complexity: 20 }] });
    const entries = buildEntries(
      r,
      [chunk('a.ts', 1, 'typescript', 20)],
      new Map([['a.ts', 7]]),
      new Map([['a.ts', ['a.test.ts']]]),
    );
    expect(entries[0].dependents).toBe(7);
    expect(entries[0].tests).toEqual(['a.test.ts']);
    expect(entries[0].shape).toBe('expensive');
  });

  it('sorts by descending risk', () => {
    const r = report({
      'low.ts': [{ startLine: 1, symbolName: 'small', complexity: 11 }],
      'high.ts': [{ startLine: 1, symbolName: 'big', complexity: 40 }],
    });
    const entries = buildEntries(
      r,
      [chunk('low.ts', 1, 'typescript', 11), chunk('high.ts', 1, 'typescript', 40)],
      new Map(),
      new Map(),
    );
    expect(entries[0].symbolName).toBe('big');
  });

  it('treats a file with no fan-in entry as zero dependents', () => {
    const r = report({ 'a.ts': [{ startLine: 1, symbolName: 'run', complexity: 20 }] });
    const entries = buildEntries(r, [chunk('a.ts', 1, 'typescript', 20)], new Map(), new Map());
    expect(entries[0].dependents).toBe(0);
  });

  it('ranks a dangerous function above an isolated one that outscores it', () => {
    // Score alone contradicts the shape table: a very complex self-contained
    // function (76 × 1 × 2 = 152) outscores a borderline-complex one that
    // five files depend on and nothing tests (15 × 3.58 × 2 ≈ 107), even
    // though the table calls the former low priority and the latter the thing
    // to fix first. Shape must win the sort.
    const r = report({
      'lonely.ts': [{ startLine: 1, symbolName: 'huge', complexity: 76 }],
      'shared.ts': [{ startLine: 1, symbolName: 'used', complexity: 15 }],
    });
    const entries = buildEntries(
      r,
      [chunk('lonely.ts', 1, 'typescript', 76), chunk('shared.ts', 1, 'typescript', 15)],
      new Map([['shared.ts', 5]]),
      new Map(),
    );
    expect(entries.map(e => e.symbolName)).toEqual(['used', 'huge']);
    expect(entries[0].shape).toBe('dangerous');
    expect(entries[1].shape).toBe('isolated');
    expect(entries[1].score).toBeGreaterThan(entries[0].score);
  });

  it('still orders by score within a single shape', () => {
    const r = report({
      'a.ts': [{ startLine: 1, symbolName: 'smaller', complexity: 20 }],
      'b.ts': [{ startLine: 1, symbolName: 'bigger', complexity: 40 }],
    });
    const entries = buildEntries(
      r,
      [chunk('a.ts', 1, 'typescript', 20), chunk('b.ts', 1, 'typescript', 40)],
      new Map([
        ['a.ts', 6],
        ['b.ts', 6],
      ]),
      new Map(),
    );
    expect(entries.map(e => e.symbolName)).toEqual(['bigger', 'smaller']);
  });

  it('excludes test files by default', () => {
    const r = report({ 'src/a.test.ts': [{ startLine: 1, symbolName: 'spec', complexity: 40 }] });
    const entries = buildEntries(
      r,
      [chunk('src/a.test.ts', 1, 'typescript', 40)],
      new Map(),
      new Map(),
    );
    expect(entries).toEqual([]);
  });

  it('includes test files when asked', () => {
    const r = report({ 'src/a.test.ts': [{ startLine: 1, symbolName: 'spec', complexity: 40 }] });
    const entries = buildEntries(
      r,
      [chunk('src/a.test.ts', 1, 'typescript', 40)],
      new Map(),
      new Map(),
      true,
    );
    expect(entries).toHaveLength(1);
  });
});

describe('computeCoverage', () => {
  it('marks a language resolved when any of its files has fan-in', () => {
    const chunks = [chunk('a.ts', 1, 'typescript'), chunk('b.ts', 1, 'typescript')];
    const rows = computeCoverage(chunks, new Map([['b.ts', 3]]));
    expect(rows).toEqual([{ language: 'typescript', files: 2, resolved: true }]);
  });

  it('marks a language unresolved when no file has fan-in', () => {
    const rows = computeCoverage([chunk('A.swift', 1, 'swift')], new Map());
    expect(rows[0]).toEqual({ language: 'swift', files: 1, resolved: false });
  });

  it('counts distinct files, not chunks', () => {
    const chunks = [chunk('a.ts', 1, 'typescript'), chunk('a.ts', 20, 'typescript')];
    expect(computeCoverage(chunks, new Map())[0].files).toBe(1);
  });

  it('orders languages by file count', () => {
    const chunks = [
      chunk('a.ts', 1, 'typescript'),
      chunk('b.ts', 1, 'typescript'),
      chunk('A.swift', 1, 'swift'),
    ];
    expect(computeCoverage(chunks, new Map()).map(r => r.language)).toEqual([
      'typescript',
      'swift',
    ]);
  });
});

describe('renderText', () => {
  const entry: RiskEntry = {
    filepath: 'a.ts',
    startLine: 12,
    symbolName: 'run',
    language: 'typescript',
    cognitive: 33,
    dependents: 4,
    tests: [],
    score: 100,
    shape: 'dangerous',
  };

  const result: HealthResult = {
    filesAnalyzed: 10,
    chunks: 100,
    durationMs: 2000,
    totalViolations: 12,
    entries: [entry],
    coverage: [
      { language: 'typescript', files: 10, resolved: true },
      { language: 'swift', files: 2, resolved: false },
    ],
  };

  it('shows the location, the three raw numbers and the recommendation', () => {
    const out = stripAnsi(renderText(result, [entry]));
    expect(out).toContain('a.ts:12');
    expect(out).toContain('mental load 33');
    expect(out).toContain('imported by 4');
    expect(out).toContain('no tests');
    expect(out).toContain('add a test before touching it');
  });

  it('names languages with no resolved fan-in rather than ranking them silently', () => {
    const out = stripAnsi(renderText(result, [entry]));
    expect(out).toContain('no fan-in found');
    expect(out).toContain('swift (2)');
    expect(out).toContain('not judged safe');
  });

  it('pluralises the test count', () => {
    const one = stripAnsi(renderText(result, [{ ...entry, tests: ['a.test.ts'] }]));
    expect(one).toContain('· 1 test');
    expect(one).not.toContain('1 tests');

    const two = stripAnsi(renderText(result, [{ ...entry, tests: ['a.test.ts', 'b.test.ts'] }]));
    expect(two).toContain('· 2 tests');
  });

  it('points at lien complexity for the violations it did not show', () => {
    const out = stripAnsi(renderText(result, [entry]));
    expect(out).toContain('11 other threshold violations');
  });

  it('omits the remainder line when everything was shown', () => {
    const out = stripAnsi(renderText({ ...result, totalViolations: 1 }, [entry]));
    expect(out).not.toContain('other threshold violations');
  });

  it('reports a clean repo without inventing findings', () => {
    const out = stripAnsi(renderText({ ...result, totalViolations: 0, entries: [] }, []));
    expect(out).toContain('Nothing ranked as risky to change.');
  });

  it('never renders a failed scan as a clean bill of health', () => {
    const failed = {
      ...result,
      totalViolations: 0,
      entries: [],
      scanError: 'No files found to index',
    };
    const out = stripAnsi(renderText(failed, []));
    expect(out).toContain('No health data');
    expect(out).toContain('No files found to index');
    expect(out).toContain('NOT a clean bill of health');
    expect(out).not.toContain('Nothing ranked as risky to change.');
  });

  it('suppresses the coverage footer when there is no data to cover', () => {
    const failed = { ...result, entries: [], scanError: 'boom' };
    expect(stripAnsi(renderText(failed, []))).not.toContain('fan-in resolved');
  });

  it('omits the unresolved-language line when every language resolved', () => {
    const clean = { ...result, coverage: [{ language: 'typescript', files: 10, resolved: true }] };
    expect(stripAnsi(renderText(clean, [entry]))).not.toContain('no fan-in found');
  });
});
describe('plural', () => {
  it('does not say "1 files"', () => {
    expect(plural(1, 'file')).toBe('1 file');
    expect(plural(0, 'file')).toBe('0 files');
    expect(plural(2, 'file')).toBe('2 files');
  });
});

describe('renderNothingShown', () => {
  const base: HealthResult = {
    filesAnalyzed: 10,
    chunks: 100,
    durationMs: 100,
    totalViolations: 0,
    entries: [],
    coverage: [],
  };

  it('reports a genuinely clean repo as clean', () => {
    expect(stripAnsi(renderNothingShown(base).join('\n'))).toContain(
      'Nothing ranked as risky to change.',
    );
  });

  it('distinguishes "--path matched nothing" from clean', () => {
    const withEntries = { ...base, entries: [{ filepath: 'a.ts' }] as never };
    const out = stripAnsi(renderNothingShown(withEntries, 'src/').join('\n'));
    expect(out).toContain('No risky functions under "src/"');
    expect(out).not.toContain('Nothing ranked as risky to change.');
  });

  it('distinguishes "everything was in test files" and names the escape hatch', () => {
    const allTests = { ...base, totalViolations: 7 };
    const out = stripAnsi(renderNothingShown(allTests).join('\n'));
    expect(out).toContain('outside test files');
    expect(out).toContain('--include-tests');
    expect(out).not.toContain('Nothing ranked as risky to change.');
  });
});

describe('toJson', () => {
  const jsonEntry: RiskEntry = {
    filepath: 'a.ts',
    startLine: 1,
    symbolName: 'run',
    language: 'typescript',
    cognitive: 20,
    dependents: 3,
    tests: [],
    score: 89.62406251802891,
    shape: 'dangerous',
  };
  const jsonResult: HealthResult = {
    filesAnalyzed: 10,
    chunks: 100,
    durationMs: 100,
    totalViolations: 65,
    entries: [jsonEntry, jsonEntry, jsonEntry],
    coverage: [],
  };

  it('states how many were shown out of how many ranked', () => {
    const json = toJson(jsonResult, jsonResult.entries, [jsonEntry]);
    expect(json.shown).toBe(1);
    expect(json.rankedTotal).toBe(3);
  });

  it('rounds the score rather than emitting float noise', () => {
    const json = toJson(jsonResult, jsonResult.entries, [jsonEntry]);
    expect((json.entries as RiskEntry[])[0].score).toBe(89.6);
  });

  it('reports the path-scoped count only when a path filter is in play', () => {
    expect(toJson(jsonResult, jsonResult.entries, [jsonEntry]).rankedUnderPath).toBeUndefined();
    expect(toJson(jsonResult, [jsonEntry], [jsonEntry], 'src/').rankedUnderPath).toBe(1);
  });
});

const GNARLY = [
  'export function tangle(a, b, c, d) {',
  '  if (a) { if (b) { if (c) { if (d) { for (const x of a) { if (x) { while (b) { if (c) { return 1; } } } } } } } }',
  '  if (b) { if (c) { if (d) { switch (a) { case 1: if (b) return 2; default: return 3; } } } }',
  '  if (c) { if (d) { if (a) { if (b) { try { return 4; } catch { if (a) return 5; } } } } }',
  '  return 0;',
  '}',
].join('\n');

describe('analyzeHealth (integration — real parse, no index)', () => {
  async function fixtureDir(files: Record<string, string>): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-health-'));
    for (const [name, body] of Object.entries(files)) {
      const full = path.join(dir, name);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, body);
    }
    return dir;
  }

  it('reports no data for an empty directory instead of a clean bill of health', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-health-empty-'));
    const result = await analyzeHealth(dir);
    expect(result.scanError).toBeTruthy();
    expect(result.entries).toEqual([]);
    expect(stripAnsi(renderText(result, []))).toContain('NOT a clean bill of health');
  });

  it('ranks a complex untested function from real source', async () => {
    const dir = await fixtureDir({ 'src/tangle.js': GNARLY });
    const result = await analyzeHealth(dir);

    expect(result.scanError).toBeUndefined();
    expect(result.chunks).toBeGreaterThan(0);
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries[0].symbolName).toBe('tangle');
    expect(result.entries[0].tests).toEqual([]);
  });

  it('excludes test files from the ranking by default, and includes them on request', async () => {
    const dir = await fixtureDir({ 'src/thing.test.js': GNARLY });

    expect((await analyzeHealth(dir)).entries).toEqual([]);
    expect((await analyzeHealth(dir, true)).entries.length).toBeGreaterThan(0);
  });
});
