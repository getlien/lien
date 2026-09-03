import { describe, it, expect } from 'vitest';
import {
  normalizeFilePath,
  matchesAnyFile,
  createViolation,
  createHalsteadViolation,
  effortToMinutes,
  minutesToEffort,
  formatTime,
  checkChunkComplexity,
  getUniqueFunctionChunks,
  findViolations,
  calculateRiskLevel,
  buildReport,
  enrichWithDependencies,
  analyzeComplexityFromChunks,
  DEFAULT_COMPLEXITY_THRESHOLDS,
} from './chunk-complexity.js';
import type { ChunkMetadata, CodeChunk } from '../types.js';

/**
 * Characterization tests for chunk-complexity.ts.
 *
 * These tests PIN today's behavior so a future refactor (making this file the
 * canonical complexity implementation, with `packages/core` delegating to it)
 * can be verified against a stable baseline. Where behavior looks surprising,
 * a `// NOTE:` comment records what it does and why it's suspicious — those
 * items are NOT fixed here, only documented (see PR body for the list).
 */

/** Build a ChunkMetadata with sensible function defaults, override as needed. */
function meta(overrides: Partial<ChunkMetadata> & { file: string }): ChunkMetadata {
  return {
    startLine: 1,
    endLine: 10,
    type: 'function',
    language: 'typescript',
    symbolType: 'function',
    symbolName: 'fn',
    ...overrides,
  };
}

/** Build a CodeChunk wrapping the given metadata. */
function chunk(overrides: Partial<ChunkMetadata> & { file: string }): CodeChunk {
  return { content: '// stub', metadata: meta(overrides) };
}

describe('normalizeFilePath', () => {
  it('strips the workspace root prefix from an absolute path', () => {
    const abs = `${process.cwd()}/src/foo.ts`;
    expect(normalizeFilePath(abs)).toBe('src/foo.ts');
  });

  it('normalizes backslashes to forward slashes', () => {
    expect(normalizeFilePath('src\\foo\\bar.ts')).toBe('src/foo/bar.ts');
  });

  it('leaves an already-relative path untouched', () => {
    expect(normalizeFilePath('src/foo.ts')).toBe('src/foo.ts');
  });

  it('does NOT strip the root without a trailing slash boundary (#988 fix)', () => {
    // Fixed in #988: normalizeFilePath used to have a second, unguarded
    // `startsWith(normalizedRoot)` branch with no separator check, so any
    // string merely starting with the same characters as cwd — not an actual
    // path-boundary match — was stripped too. It now delegates entirely to
    // `getCanonicalPath` (../utils/path-matching.ts), which only strips at a
    // real `/` boundary, so a non-boundary "match" like this passes through
    // unchanged instead of being mangled.
    const abs = process.cwd() + 'x/weird.ts';
    expect(normalizeFilePath(abs)).toBe(abs);
  });

  it('does not mangle a sibling directory sharing the root name as a prefix (#988)', () => {
    // The real-world shape #988 reported: workspace root `.../lien` and a
    // sibling `.../lien-review-testbed` — the old unguarded branch stripped
    // `.../lien` off the front regardless of the missing `/` boundary,
    // producing a leading-`-` path ("-review-testbed/x.py") that matches
    // nothing downstream, silently dropping the chunk from complexity
    // reporting. The fix (delegating to getCanonicalPath) leaves any path
    // that isn't actually under the root unchanged.
    const root = process.cwd();
    const sibling = `${root}-review-testbed/x.py`;
    expect(normalizeFilePath(sibling)).toBe(sibling);

    const otherSibling = `${root}-other/y.ts`;
    expect(normalizeFilePath(otherSibling)).toBe(otherSibling);
  });

  it('still strips a real path under the root sharing a sibling-like suffix', () => {
    // Sanity check alongside the sibling-prefix case above: an actual file
    // under the root is still stripped correctly.
    const abs = `${process.cwd()}/lien-review-testbed/x.py`;
    expect(normalizeFilePath(abs)).toBe('lien-review-testbed/x.py');
  });
});

describe('matchesAnyFile', () => {
  it('matches an exact path', () => {
    expect(matchesAnyFile('src/foo.ts', ['src/foo.ts'])).toBe(true);
  });

  it('matches when the target is a path-boundary suffix of the chunk file', () => {
    expect(matchesAnyFile('packages/parser/src/foo.ts', ['src/foo.ts'])).toBe(true);
  });

  it('does not match a bare substring that is not at a path boundary', () => {
    expect(matchesAnyFile('src/notfoo.ts', ['foo.ts'])).toBe(false);
  });

  it('returns false when no target matches', () => {
    expect(matchesAnyFile('src/foo.ts', ['src/bar.ts', 'src/baz.ts'])).toBe(false);
  });

  it('normalizes backslashes on both sides before comparing', () => {
    expect(matchesAnyFile('src\\foo.ts', ['src/foo.ts'])).toBe(true);
  });
});

describe('createViolation — severity multipliers', () => {
  it('returns null when complexity is below the warning threshold', () => {
    expect(createViolation(meta({ file: 'a.ts' }), 14, 15, 'cyclomatic')).toBeNull();
  });

  it('is a warning exactly at 1x the base threshold', () => {
    const v = createViolation(meta({ file: 'a.ts' }), 15, 15, 'cyclomatic');
    expect(v?.severity).toBe('warning');
    expect(v?.threshold).toBe(15);
  });

  it('is still a warning just under 2x the base threshold', () => {
    const v = createViolation(meta({ file: 'a.ts' }), 29, 15, 'cyclomatic');
    expect(v?.severity).toBe('warning');
  });

  it('is an error exactly at 2x the base threshold', () => {
    const v = createViolation(meta({ file: 'a.ts' }), 30, 15, 'cyclomatic');
    expect(v?.severity).toBe('error');
    expect(v?.threshold).toBe(30);
  });

  it('is an error above 2x the base threshold', () => {
    const v = createViolation(meta({ file: 'a.ts' }), 100, 15, 'cyclomatic');
    expect(v?.severity).toBe('error');
  });

  it('produces a cyclomatic-specific message', () => {
    const v = createViolation(meta({ file: 'a.ts' }), 20, 15, 'cyclomatic');
    expect(v?.message).toBe('Needs ~20 test cases for full coverage (threshold: 15)');
  });

  it('produces a cognitive-specific message', () => {
    const v = createViolation(meta({ file: 'a.ts' }), 20, 15, 'cognitive');
    expect(v?.message).toBe('Mental load 20 exceeds threshold 15 (hard to follow)');
  });

  it('falls back to "unknown" for a missing symbolName', () => {
    const v = createViolation(meta({ file: 'a.ts', symbolName: undefined }), 20, 15, 'cyclomatic');
    expect(v?.symbolName).toBe('unknown');
  });

  it('copies filepath/location/language straight from metadata', () => {
    const m = meta({ file: 'src/a.ts', startLine: 5, endLine: 9, language: 'python' });
    const v = createViolation(m, 20, 15, 'cyclomatic');
    expect(v).toMatchObject({
      filepath: 'src/a.ts',
      startLine: 5,
      endLine: 9,
      language: 'python',
      complexity: 20,
      metricType: 'cyclomatic',
    });
  });
});

describe('effortToMinutes / minutesToEffort / formatTime', () => {
  it('round-trip is exact (linear conversion)', () => {
    expect(effortToMinutes(minutesToEffort(42))).toBe(42);
  });

  it('effortToMinutes divides by 1080 (18 * 60)', () => {
    expect(effortToMinutes(1080)).toBe(1);
    expect(effortToMinutes(2160)).toBe(2);
  });

  it('formatTime renders under an hour as whole minutes', () => {
    expect(formatTime(45)).toBe('45m');
    expect(formatTime(45.6)).toBe('46m'); // rounds
  });

  it('formatTime renders exactly one hour with no minute remainder', () => {
    expect(formatTime(60)).toBe('1h');
  });

  it('formatTime renders hours plus a minute remainder', () => {
    expect(formatTime(150)).toBe('2h 30m');
  });

  it('formatTime rounds a fractional remainder within the hour', () => {
    expect(formatTime(125.6)).toBe('2h 6m');
  });
});

describe('createHalsteadViolation', () => {
  it('returns null below the warning threshold', () => {
    const m = meta({ file: 'a.ts', halsteadEffort: 500 });
    expect(createHalsteadViolation(m, 500, 1000, 'halstead_effort')).toBeNull();
  });

  it('halstead_effort: complexity/threshold are stored as rounded minutes, not raw effort', () => {
    const m = meta({ file: 'a.ts', halsteadEffort: 216000 }); // 200 minutes
    const v = createHalsteadViolation(m, 216000, 108000, 'halstead_effort'); // threshold: 100 min
    expect(v?.severity).toBe('error'); // 216000 >= 2x108000
    expect(v?.complexity).toBe(200); // effortToMinutes(216000)
    expect(v?.threshold).toBe(200); // effortToMinutes(2 * 108000)
    expect(v?.message).toBe('Time to understand ~3h 20m exceeds threshold 3h 20m');
  });

  it('halstead_bugs: complexity/threshold are kept as raw decimals', () => {
    // metricValue 2.5 is below the error threshold (2x1.5 = 3), so this is a
    // warning at the 1x threshold (1.5), not an error at 2x.
    const m = meta({ file: 'a.ts', halsteadBugs: 2.5 });
    const v = createHalsteadViolation(m, 2.5, 1.5, 'halstead_bugs');
    expect(v?.severity).toBe('warning');
    expect(v?.complexity).toBe(2.5);
    expect(v?.threshold).toBe(1.5);
    expect(v?.message).toBe('Estimated bugs 2.50 exceeds threshold 1.5');
  });

  it('halstead_bugs error severity uses the 2x threshold', () => {
    const m = meta({ file: 'a.ts', halsteadBugs: 3.2 });
    const v = createHalsteadViolation(m, 3.2, 1.5, 'halstead_bugs');
    expect(v?.severity).toBe('error');
    expect(v?.threshold).toBe(3); // 2x1.5
    expect(v?.message).toBe('Estimated bugs 3.20 exceeds threshold 3.0');
  });

  it('halsteadDetails default to 0 for any missing Halstead field on metadata', () => {
    const m = meta({ file: 'a.ts', halsteadBugs: 2.5 }); // no volume/difficulty/effort set
    const v = createHalsteadViolation(m, 2.5, 1.5, 'halstead_bugs');
    expect(v?.halsteadDetails).toEqual({ volume: 0, difficulty: 0, effort: 0, bugs: 2.5 });
  });
});

describe('checkChunkComplexity', () => {
  const thresholds = { testPaths: 15, mentalLoad: 15, halsteadEffort: 64800, estimatedBugs: 1.5 };

  it('produces no violations for a chunk with no complexity metadata', () => {
    expect(checkChunkComplexity(meta({ file: 'a.ts' }), thresholds)).toEqual([]);
  });

  it('checks cyclomatic and cognitive independently', () => {
    const violations = checkChunkComplexity(
      meta({ file: 'a.ts', complexity: 20, cognitiveComplexity: 5 }),
      thresholds,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].metricType).toBe('cyclomatic');
  });

  it('skips halstead_effort when the threshold is not provided, even if metadata has it', () => {
    const violations = checkChunkComplexity(meta({ file: 'a.ts', halsteadEffort: 999999999 }), {
      testPaths: 15,
      mentalLoad: 15,
      // halsteadEffort threshold omitted
    });
    expect(violations).toEqual([]);
  });

  it('skips estimatedBugs when the metadata field is absent, even if the threshold is set', () => {
    const violations = checkChunkComplexity(meta({ file: 'a.ts' }), {
      ...thresholds,
      estimatedBugs: 0.001, // would trigger on almost anything
    });
    expect(violations).toEqual([]);
  });

  it('can produce all four violation kinds for one chunk at once', () => {
    const violations = checkChunkComplexity(
      meta({
        file: 'a.ts',
        complexity: 40,
        cognitiveComplexity: 40,
        halsteadEffort: 200000,
        halsteadBugs: 5,
      }),
      thresholds,
    );
    expect(violations.map(v => v.metricType).sort()).toEqual([
      'cognitive',
      'cyclomatic',
      'halstead_bugs',
      'halstead_effort',
    ]);
  });
});

describe('getUniqueFunctionChunks', () => {
  it('keeps only function and method symbol types', () => {
    const chunks = [
      chunk({ file: 'a.ts', symbolType: 'function' }),
      chunk({ file: 'a.ts', symbolType: 'method', startLine: 20, endLine: 30 }),
      chunk({ file: 'a.ts', symbolType: 'class', startLine: 40, endLine: 50 }),
      chunk({ file: 'a.ts', symbolType: 'interface', startLine: 60, endLine: 70 }),
    ];
    const result = getUniqueFunctionChunks(chunks);
    expect(result).toHaveLength(2);
    expect(result.map(m => m.symbolType).sort()).toEqual(['function', 'method']);
  });

  it('dedupes by normalized-file + line range, keeping the first occurrence', () => {
    const chunks = [
      chunk({ file: 'a.ts', symbolName: 'first', complexity: 1 }),
      chunk({ file: 'a.ts', symbolName: 'duplicate', complexity: 999 }), // same file:startLine-endLine
    ];
    const result = getUniqueFunctionChunks(chunks);
    expect(result).toHaveLength(1);
    // NOTE: dedup keeps whichever chunk was seen FIRST in iteration order, not
    // the "best" or "last" one — a reindex that appends a corrected duplicate
    // after the original would silently be ignored.
    expect(result[0].symbolName).toBe('first');
  });

  it('does not dedupe identical line ranges across different files', () => {
    const chunks = [chunk({ file: 'a.ts' }), chunk({ file: 'b.ts' })];
    expect(getUniqueFunctionChunks(chunks)).toHaveLength(2);
  });
});

describe('findViolations', () => {
  const thresholds = {
    testPaths: 15,
    mentalLoad: 15,
    timeToUnderstandMinutes: 60,
    estimatedBugs: 1.5,
  };

  it('ignores non-function/method chunks even if they carry complexity data', () => {
    const chunks = [chunk({ file: 'a.ts', symbolType: 'class', complexity: 999 })];
    expect(findViolations(chunks, thresholds)).toEqual([]);
  });

  it('converts timeToUnderstandMinutes to a halstead effort threshold internally', () => {
    // 60 minutes -> 64800 effort (60 * 1080); this chunk's effort is just at that line.
    const chunks = [chunk({ file: 'a.ts', halsteadEffort: 64800 })];
    const violations = findViolations(chunks, thresholds);
    expect(violations).toHaveLength(1);
    expect(violations[0].metricType).toBe('halstead_effort');
  });

  it('aggregates violations across multiple function chunks', () => {
    const chunks = [
      chunk({ file: 'a.ts', symbolName: 'f1', complexity: 20 }),
      chunk({ file: 'a.ts', symbolName: 'f2', startLine: 20, endLine: 30, complexity: 5 }),
    ];
    expect(findViolations(chunks, thresholds)).toHaveLength(1);
  });
});

describe('calculateRiskLevel', () => {
  const warning = (n = 1) =>
    Array.from({ length: n }, () => createViolation(meta({ file: 'a.ts' }), 20, 15, 'cyclomatic')!);
  const error = (n = 1) =>
    Array.from({ length: n }, () => createViolation(meta({ file: 'a.ts' }), 40, 15, 'cyclomatic')!);

  it('is low with no violations', () => {
    expect(calculateRiskLevel([])).toBe('low');
  });

  it('is low with 1-2 warnings (below the medium count threshold)', () => {
    expect(calculateRiskLevel(warning(2))).toBe('low');
  });

  it('is medium at 3+ warnings with no errors', () => {
    expect(calculateRiskLevel(warning(3))).toBe('medium');
  });

  it('is high with even a single error, regardless of warning count', () => {
    expect(calculateRiskLevel(error(1))).toBe('high');
  });

  it('is high (not critical) with 2 errors', () => {
    expect(calculateRiskLevel(error(2))).toBe('high');
  });

  it('is critical at 3+ errors', () => {
    expect(calculateRiskLevel(error(3))).toBe('critical');
  });

  it('errorCount >= 3 wins over the warning-count check even when mixed', () => {
    expect(calculateRiskLevel([...error(3), ...warning(5)])).toBe('critical');
  });
});

describe('buildReport', () => {
  it('includes every analyzed file, even ones with zero violations', () => {
    const allChunks = [
      chunk({ file: 'clean.ts', complexity: 2 }),
      chunk({ file: 'dirty.ts', complexity: 40 }),
    ];
    const violations = findViolations(allChunks, {
      testPaths: 15,
      mentalLoad: 15,
      timeToUnderstandMinutes: 60,
      estimatedBugs: 1.5,
    });
    const report = buildReport(violations, allChunks);

    expect(Object.keys(report.files).sort()).toEqual(['clean.ts', 'dirty.ts']);
    expect(report.files['clean.ts'].violations).toEqual([]);
    expect(report.files['clean.ts'].riskLevel).toBe('low');
    expect(report.files['dirty.ts'].violations).toHaveLength(1);
  });

  it('includes non-function chunks (e.g. doc/config) in the analyzed-file set', () => {
    const allChunks = [chunk({ file: 'README.md', type: 'doc', symbolType: undefined })];
    const report = buildReport([], allChunks);
    expect(report.summary.filesAnalyzed).toBe(1);
    expect(report.files['README.md']).toBeDefined();
  });

  it('summary counts violations by severity', () => {
    const v1 = createViolation(meta({ file: 'a.ts' }), 20, 15, 'cyclomatic')!; // warning
    const v2 = createViolation(meta({ file: 'a.ts' }), 40, 15, 'cyclomatic')!; // error
    const report = buildReport([v1, v2], [chunk({ file: 'a.ts' })]);
    expect(report.summary.bySeverity).toEqual({ error: 1, warning: 1 });
    expect(report.summary.totalViolations).toBe(2);
  });

  it('normalizes violation filepaths AND mutates the input violation objects in place', () => {
    // NOTE: buildReport reassigns `violation.filepath = normalizedPath` on the
    // objects it was given, rather than cloning. Any other holder of the same
    // violation reference (e.g. a caller that kept its own array) observes
    // the mutation too. Pinned here rather than fixed.
    const absFile = `${process.cwd()}/src/abs.ts`;
    const v = createViolation(meta({ file: absFile }), 20, 15, 'cyclomatic')!;
    expect(v.filepath).toBe(absFile);

    const report = buildReport([v], [chunk({ file: absFile })]);

    expect(Object.keys(report.files)).toEqual(['src/abs.ts']);
    expect(v.filepath).toBe('src/abs.ts'); // same object, mutated
  });

  it('avgComplexity/maxComplexity are computed over ALL chunks with complexity > 0, not just function chunks', () => {
    // NOTE: computeComplexityStats runs over the full allChunks array passed
    // to buildReport (i.e. every analyzed chunk), not the function-only
    // subset used for violation detection. A 'class'-typed chunk that
    // happens to carry a `complexity` value still moves the average/max.
    const allChunks = [
      chunk({ file: 'a.ts', symbolType: 'class', complexity: 50 }),
      chunk({ file: 'a.ts', symbolName: 'f', complexity: 10, startLine: 20, endLine: 30 }),
    ];
    const report = buildReport([], allChunks);
    expect(report.summary.avgComplexity).toBe(30); // (50 + 10) / 2
    expect(report.summary.maxComplexity).toBe(50);
  });

  it('chunks with complexity 0 or undefined are excluded from the average', () => {
    const allChunks = [
      chunk({ file: 'a.ts', complexity: 0 }),
      chunk({ file: 'a.ts', symbolName: 'f2', startLine: 20, endLine: 30 }), // no complexity field
      chunk({ file: 'a.ts', symbolName: 'f3', startLine: 40, endLine: 50, complexity: 10 }),
    ];
    const report = buildReport([], allChunks);
    expect(report.summary.avgComplexity).toBe(10);
    expect(report.summary.maxComplexity).toBe(10);
  });

  it('an empty chunk array produces an empty, zeroed-out report', () => {
    const report = buildReport([], []);
    expect(report).toEqual({
      summary: {
        filesAnalyzed: 0,
        totalViolations: 0,
        bySeverity: { error: 0, warning: 0 },
        avgComplexity: 0,
        maxComplexity: 0,
      },
      files: {},
    });
  });
});

describe('enrichWithDependencies', () => {
  it('adds dependents, dependentCount, and dependentComplexityMetrics only to files with violations', () => {
    const violatingChunk = chunk({ file: 'src/utils.ts', complexity: 40, imports: [] });
    const cleanChunk = chunk({ file: 'src/simple.ts', complexity: 2, imports: [] });
    const dependentChunk: CodeChunk = {
      content: 'import { x } from "./utils";',
      metadata: meta({
        file: 'src/app.ts',
        symbolName: undefined,
        symbolType: undefined,
        imports: ['src/utils.ts'],
        complexity: 8,
      }),
    };

    const allChunks = [violatingChunk, cleanChunk, dependentChunk];
    const violations = findViolations(allChunks, {
      testPaths: 15,
      mentalLoad: 15,
      timeToUnderstandMinutes: 60,
      estimatedBugs: 1.5,
    });
    const report = buildReport(violations, allChunks);
    enrichWithDependencies(report, allChunks);

    const utils = report.files['src/utils.ts'];
    expect(utils.dependentCount).toBe(1);
    expect(utils.dependents).toEqual(['src/app.ts']);
    expect(utils.dependentComplexityMetrics).toEqual({
      averageComplexity: 8,
      maxComplexity: 8,
      filesWithComplexityData: 1,
    });

    const simple = report.files['src/simple.ts'];
    expect(simple.dependentCount).toBeUndefined();
    expect(simple.dependents).toEqual([]);
  });

  it('boosts riskLevel from dependency analysis but never downgrades it', () => {
    const violatingChunk = chunk({ file: 'src/hot.ts', complexity: 18, imports: [] }); // 1 warning -> 'low'
    const manyDependents: CodeChunk[] = Array.from({ length: 35 }, (_, i) => ({
      content: 'import { x } from "./hot";',
      metadata: meta({
        file: `src/dep${i}.ts`,
        symbolName: undefined,
        symbolType: undefined,
        imports: ['src/hot.ts'],
      }),
    }));

    const allChunks = [violatingChunk, ...manyDependents];
    const violations = findViolations(allChunks, {
      testPaths: 15,
      mentalLoad: 15,
      timeToUnderstandMinutes: 60,
      estimatedBugs: 1.5,
    });
    const report = buildReport(violations, allChunks);
    expect(report.files['src/hot.ts'].riskLevel).toBe('low');

    enrichWithDependencies(report, allChunks);

    // 35 dependents > HIGH(30) threshold -> 'critical', which beats the
    // violation-only 'low' verdict.
    expect(report.files['src/hot.ts'].riskLevel).toBe('critical');
  });
});

describe('analyzeComplexityFromChunks — entry point', () => {
  it('finds violations and builds a full report from raw chunks', () => {
    const chunks = [
      chunk({ file: 'src/a.ts', symbolName: 'complex', complexity: 20 }),
      chunk({
        file: 'src/a.ts',
        symbolName: 'simple',
        startLine: 20,
        endLine: 30,
        complexity: 5,
      }),
    ];
    const report = analyzeComplexityFromChunks(chunks);

    expect(report.summary.totalViolations).toBe(1);
    expect(report.summary.filesAnalyzed).toBe(1);
    expect(report.files['src/a.ts'].violations).toHaveLength(1);
    expect(report.files['src/a.ts'].violations[0].symbolName).toBe('complex');
  });

  it('DEFAULT_COMPLEXITY_THRESHOLDS gates at testPaths=15, mentalLoad=15, timeToUnderstandMinutes=60, estimatedBugs=1.5', () => {
    expect(DEFAULT_COMPLEXITY_THRESHOLDS).toEqual({
      testPaths: 15,
      mentalLoad: 15,
      timeToUnderstandMinutes: 60,
      estimatedBugs: 1.5,
    });

    // Reads the threshold from the canonical constant rather than a
    // hardcoded literal (#988), so this fails if analyzeComplexityFromChunks
    // ever stops actually gating at DEFAULT_COMPLEXITY_THRESHOLDS.testPaths.
    const t = DEFAULT_COMPLEXITY_THRESHOLDS.testPaths;
    const chunks = [chunk({ file: 'src/a.ts', complexity: t - 1 })]; // just under default
    expect(analyzeComplexityFromChunks(chunks).summary.totalViolations).toBe(0);

    const chunks2 = [chunk({ file: 'src/a.ts', complexity: t })]; // at default
    expect(analyzeComplexityFromChunks(chunks2).summary.totalViolations).toBe(1);
  });

  it('thresholdOverrides.testPaths lowers the cyclomatic gate', () => {
    const chunks = [chunk({ file: 'src/a.ts', complexity: 12 })]; // under default 15
    expect(analyzeComplexityFromChunks(chunks).summary.totalViolations).toBe(0);
    expect(
      analyzeComplexityFromChunks(chunks, undefined, { testPaths: 10 }).summary.totalViolations,
    ).toBe(1);
  });

  it('thresholdOverrides.mentalLoad lowers the cognitive gate independently of testPaths', () => {
    const chunks = [chunk({ file: 'src/a.ts', cognitiveComplexity: 12 })];
    expect(analyzeComplexityFromChunks(chunks).summary.totalViolations).toBe(0);
    expect(
      analyzeComplexityFromChunks(chunks, undefined, { mentalLoad: 10 }).summary.totalViolations,
    ).toBe(1);
  });

  it(// NOTE (possible gap, not fixed here): the public `thresholdOverrides` type only
  // allows `testPaths`/`mentalLoad`. There is no supported way to override
  // `timeToUnderstandMinutes` or `estimatedBugs` through this entry point — every
  // real caller (annotate-cmd, review-pr, analysis.ts, agent-tools) only ever
  // maps a single CLI `--threshold` flag onto testPaths+mentalLoad, so in
  // practice Halstead thresholds are permanently pinned to the defaults.
  // Additionally, the restriction is TYPE-ONLY: the implementation does a plain
  // object spread (`{ ...DEFAULT_COMPLEXITY_THRESHOLDS, ...thresholdOverrides }`)
  // with no runtime validation, so a caller that defeats the type (via `as any`) CAN
  // still override the Halstead thresholds too, as this test demonstrates. This
  // looks like an unintentionally narrow public type rather than a deliberate
  // guard — worth filing separately.
  'thresholdOverrides has no runtime enforcement beyond its TS type: an unlisted key still applies', () => {
    const chunks = [chunk({ file: 'src/a.ts', halsteadBugs: 1.0 })]; // under default 1.5, would violate at 0.5
    expect(analyzeComplexityFromChunks(chunks).summary.totalViolations).toBe(0);

    const escapedOverride = { estimatedBugs: 0.5 } as unknown as {
      testPaths?: number;
      mentalLoad?: number;
    };
    expect(
      analyzeComplexityFromChunks(chunks, undefined, escapedOverride).summary.totalViolations,
    ).toBe(1);
  });

  it('files filter narrows report.files, but dependency/test-association enrichment still sees the full chunk universe', () => {
    // NOTE: this used to be pinned separately because packages/core's instance
    // `analyze()` had an independently hand-maintained copy of this same
    // "fetch all chunks even with --files filter" design (#994 Phase 4 found
    // and removed it). `analyze()` now delegates straight into
    // `analyzeComplexityFromChunks`, so there is nothing left to keep in sync
    // — this test is the only place the behavior is pinned. Kept because it's
    // easy to assume `files` scopes everything.
    const target = chunk({ file: 'src/target.ts', complexity: 40, imports: [] });
    const outsideImporter: CodeChunk = {
      content: 'import { x } from "./target";',
      metadata: meta({
        file: 'src/outside.ts',
        symbolName: undefined,
        symbolType: undefined,
        imports: ['src/target.ts'],
      }),
    };

    const report = analyzeComplexityFromChunks([target, outsideImporter], ['src/target.ts']);

    expect(Object.keys(report.files)).toEqual(['src/target.ts']);
    expect(report.files['src/target.ts'].dependents).toEqual(['src/outside.ts']);
  });

  it('enriches testAssociations for a violating file when a test chunk imports it exactly', () => {
    const target = chunk({ file: 'src/target.ts', complexity: 40 });
    const testChunk: CodeChunk = {
      content: 'import target from "src/target.ts"; test(...)',
      metadata: meta({
        file: 'src/target.test.ts',
        symbolName: undefined,
        symbolType: undefined,
        imports: ['src/target.ts'], // exact literal match to the target's own file path
      }),
    };

    const report = analyzeComplexityFromChunks([target, testChunk]);
    expect(report.files['src/target.ts'].testAssociations).toEqual(['src/target.test.ts']);
  });

  it('does NOT enrich testAssociations for a clean (non-violating) file, even if a test imports it', () => {
    // testAssociations is only looked up for `filesWithViolations` — a file with
    // zero violations never gets test-association enrichment, so it stays [].
    const clean = chunk({ file: 'src/clean.ts', complexity: 2 });
    const testChunk: CodeChunk = {
      content: 'import clean from "src/clean.ts"; test(...)',
      metadata: meta({
        file: 'src/clean.test.ts',
        symbolName: undefined,
        symbolType: undefined,
        imports: ['src/clean.ts'],
      }),
    };

    const report = analyzeComplexityFromChunks([clean, testChunk]);
    expect(report.files['src/clean.ts'].testAssociations).toEqual([]);
  });

  it('handles an empty chunk array', () => {
    const report = analyzeComplexityFromChunks([]);
    expect(report.summary).toEqual({
      filesAnalyzed: 0,
      totalViolations: 0,
      bySeverity: { error: 0, warning: 0 },
      avgComplexity: 0,
      maxComplexity: 0,
    });
    expect(report.files).toEqual({});
  });

  it('a chunk with no complexity metadata at all produces a clean, zero-violation file entry', () => {
    const chunks = [
      chunk({ file: 'src/plain.ts', complexity: undefined, cognitiveComplexity: undefined }),
    ];
    const report = analyzeComplexityFromChunks(chunks);
    expect(report.files['src/plain.ts']).toMatchObject({
      violations: [],
      riskLevel: 'low',
      dependents: [],
      testAssociations: [],
    });
  });
});
