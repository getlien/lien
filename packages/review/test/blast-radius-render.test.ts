import { describe, it, expect } from 'vitest';
import { renderBlastRadiusMarkdown } from '../src/blast-radius-render.js';
import type { BlastRadiusReport, BlastRadiusEntry } from '../src/blast-radius.js';

function makeEntry(overrides?: Partial<BlastRadiusEntry>): BlastRadiusEntry {
  return {
    seed: {
      filepath: 'src/seed.ts',
      symbolName: 'seed',
      symbolType: 'function',
      complexity: 0,
    },
    dependents: [
      {
        filepath: 'src/caller.ts',
        symbolName: 'caller',
        hops: 1,
        callSiteLine: 10,
        complexity: 8,
        hasTestCoverage: true,
      },
    ],
    risk: { level: 'low', reasoning: ['1 caller'] },
    truncated: false,
    ...overrides,
  };
}

function makeReport(overrides?: Partial<BlastRadiusReport>): BlastRadiusReport {
  return {
    entries: [makeEntry()],
    totalDistinctDependents: 1,
    globalRisk: { level: 'low', reasoning: ['1 caller'] },
    truncated: false,
    ...overrides,
  };
}

describe('renderBlastRadiusMarkdown', () => {
  it('returns an empty string when the report has no entries', () => {
    const empty: BlastRadiusReport = {
      entries: [],
      totalDistinctDependents: 0,
      globalRisk: { level: 'low', reasoning: [] },
      truncated: false,
    };
    expect(renderBlastRadiusMarkdown(empty)).toBe('');
  });

  it('wraps the output in <blast_radius> XML tags', () => {
    const out = renderBlastRadiusMarkdown(makeReport());
    expect(out.startsWith('<blast_radius>')).toBe(true);
    expect(out.endsWith('</blast_radius>')).toBe(true);
  });

  it('shows level uppercased in the summary line', () => {
    const out = renderBlastRadiusMarkdown(
      makeReport({ globalRisk: { level: 'high', reasoning: ['25 callers', '5 untested'] } }),
    );
    expect(out).toContain('Global risk: HIGH');
    expect(out).toContain('25 callers');
    expect(out).toContain('5 untested');
  });

  it('renders tested/untested markers correctly', () => {
    const out = renderBlastRadiusMarkdown(
      makeReport({
        entries: [
          makeEntry({
            dependents: [
              {
                filepath: 'src/a.ts',
                symbolName: 'a',
                hops: 1,
                callSiteLine: 3,
                complexity: 5,
                hasTestCoverage: true,
              },
              {
                filepath: 'src/b.ts',
                symbolName: 'b',
                hops: 1,
                callSiteLine: 7,
                complexity: 12,
                hasTestCoverage: false,
              },
            ],
          }),
        ],
      }),
    );
    expect(out).toContain('| ✓ |');
    expect(out).toContain('| ✗ |');
  });

  it('shows complexity as em-dash when absent', () => {
    const out = renderBlastRadiusMarkdown(
      makeReport({
        entries: [
          makeEntry({
            dependents: [
              {
                filepath: 'src/a.ts',
                symbolName: 'a',
                hops: 1,
                callSiteLine: 3,
                hasTestCoverage: true,
              },
            ],
          }),
        ],
      }),
    );
    expect(out).toMatch(/\|\s*—\s*\|/);
  });

  it('sorts dependents within an entry by hops then filepath', () => {
    const out = renderBlastRadiusMarkdown(
      makeReport({
        entries: [
          makeEntry({
            dependents: [
              {
                filepath: 'src/z.ts',
                symbolName: 'z',
                hops: 2,
                callSiteLine: 1,
                hasTestCoverage: true,
              },
              {
                filepath: 'src/a.ts',
                symbolName: 'a',
                hops: 1,
                callSiteLine: 1,
                hasTestCoverage: true,
              },
              {
                filepath: 'src/b.ts',
                symbolName: 'b',
                hops: 1,
                callSiteLine: 1,
                hasTestCoverage: true,
              },
            ],
          }),
        ],
      }),
    );
    const aIdx = out.indexOf('src/a.ts:a');
    const bIdx = out.indexOf('src/b.ts:b');
    const zIdx = out.indexOf('src/z.ts:z');
    expect(aIdx).toBeGreaterThan(-1);
    expect(aIdx).toBeLessThan(bIdx); // alpha within same hop
    expect(bIdx).toBeLessThan(zIdx); // hop-1 before hop-2
  });

  it('appends a truncation footer when the report is truncated', () => {
    const out = renderBlastRadiusMarkdown(makeReport({ truncated: true }));
    expect(out).toContain('[truncated');
    expect(out).toContain('more exist');
  });

  it('omits the truncation footer when not truncated', () => {
    const out = renderBlastRadiusMarkdown(makeReport());
    expect(out.includes('[truncated')).toBe(false);
  });
});
