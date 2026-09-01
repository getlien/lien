import { describe, it, expect } from 'vitest';
import type { ComplexityReport } from '../insights/types.js';
import type { SignalContext } from './signal-context.js';
import {
  computeTestCoverageGaps,
  renderTestCoverageGaps,
  renderTestCoverageSection,
} from './test-coverage-signals.js';

/** Minimal SignalContext for these tests — only `changedFiles`/`complexityReport` matter. */
function createTestContext(opts: {
  changedFiles: string[];
  complexityReport: ComplexityReport;
}): SignalContext {
  return { chunks: [], ...opts } as unknown as SignalContext;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** One `complexityReport.files[path]` entry with the given test associations. */
function fileEntry(testAssociations: string[]): ComplexityReport['files'][string] {
  return {
    violations: [],
    dependents: [],
    testAssociations,
    riskLevel: 'low',
  };
}

function makeReport(files: Record<string, string[]>): ComplexityReport {
  const entries: ComplexityReport['files'] = {};
  for (const [file, associations] of Object.entries(files)) {
    entries[file] = fileEntry(associations);
  }
  return {
    files: entries,
    summary: {
      filesAnalyzed: Object.keys(entries).length,
      totalViolations: 0,
      bySeverity: { error: 0, warning: 0 },
      avgComplexity: 0,
      maxComplexity: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// computeTestCoverageGaps
// ---------------------------------------------------------------------------

describe('computeTestCoverageGaps', () => {
  it('flags a changed file with a report entry but no test associations', () => {
    const context = createTestContext({
      changedFiles: ['src/new-module.ts'],
      complexityReport: makeReport({ 'src/new-module.ts': [] }),
    });
    expect(computeTestCoverageGaps(context)).toEqual(['src/new-module.ts']);
  });

  it('does not flag a file with at least one test association', () => {
    const context = createTestContext({
      changedFiles: ['src/auth.ts'],
      complexityReport: makeReport({ 'src/auth.ts': ['test/auth.test.ts'] }),
    });
    expect(computeTestCoverageGaps(context)).toEqual([]);
  });

  it('skips a changed file with no complexity-report entry at all (no data, not a gap)', () => {
    const context = createTestContext({
      changedFiles: ['src/not-analyzed.ts'],
      complexityReport: makeReport({}),
    });
    expect(computeTestCoverageGaps(context)).toEqual([]);
  });

  it('mixes tested, gap, and no-data files correctly', () => {
    const context = createTestContext({
      changedFiles: ['src/auth.ts', 'src/new-module.ts', 'src/not-analyzed.ts'],
      complexityReport: makeReport({
        'src/auth.ts': ['test/auth.test.ts'],
        'src/new-module.ts': [],
      }),
    });
    expect(computeTestCoverageGaps(context)).toEqual(['src/new-module.ts']);
  });

  it('returns [] when complexityReport.files is empty (enrichment never ran)', () => {
    const context = createTestContext({
      changedFiles: ['src/a.ts', 'src/b.ts'],
      complexityReport: makeReport({}),
    });
    expect(computeTestCoverageGaps(context)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// renderTestCoverageGaps
// ---------------------------------------------------------------------------

describe('renderTestCoverageGaps', () => {
  it('returns "" for no gaps', () => {
    expect(renderTestCoverageGaps([])).toBe('');
  });

  it('renders a block listing every gap file', () => {
    const md = renderTestCoverageGaps(['src/new-module.ts', 'src/utils/helper.ts']);
    expect(md).toContain('<test_coverage>');
    expect(md).toContain('</test_coverage>');
    expect(md).toContain('- src/new-module.ts');
    expect(md).toContain('- src/utils/helper.ts');
  });

  it('caps at 10 files with an explicit omission note', () => {
    const gaps = Array.from({ length: 13 }, (_, i) => `src/file${i}.ts`);
    const md = renderTestCoverageGaps(gaps);
    for (let i = 0; i < 10; i++) expect(md).toContain(`src/file${i}.ts`);
    expect(md).not.toContain('src/file10.ts');
    expect(md).toContain('+3 more changed file(s) with no associated tests omitted');
  });

  it('header warns that absence from the list does not mean the boundary-change divergence input is covered', () => {
    const md = renderTestCoverageGaps(['src/a.ts']);
    expect(md).toContain(
      'It does NOT substitute for the boundary-change protocol’s MANDATORY get_files_context call',
    );
  });
});

// ---------------------------------------------------------------------------
// renderTestCoverageSection
// ---------------------------------------------------------------------------

describe('renderTestCoverageSection', () => {
  it('returns "" when every changed file has test associations', () => {
    const context = createTestContext({
      changedFiles: ['src/auth.ts'],
      complexityReport: makeReport({ 'src/auth.ts': ['test/auth.test.ts'] }),
    });
    expect(renderTestCoverageSection(context)).toBe('');
  });

  it('returns "" when no changed file has complexity data', () => {
    const context = createTestContext({
      changedFiles: ['src/a.ts'],
      complexityReport: makeReport({}),
    });
    expect(renderTestCoverageSection(context)).toBe('');
  });

  it('renders the gap block otherwise', () => {
    const context = createTestContext({
      changedFiles: ['src/new-module.ts'],
      complexityReport: makeReport({ 'src/new-module.ts': [] }),
    });
    expect(renderTestCoverageSection(context)).toContain('<test_coverage>');
  });
});
