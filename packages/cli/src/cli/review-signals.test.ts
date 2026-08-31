import { describe, it, expect } from 'vitest';
import type { ComplexityReport, SignalContext } from '@liendev/parser';

import { runSignals, withheldSignalIds, DEFAULT_SIGNAL_IDS } from './review-signals.js';

/**
 * A context whose complexity report has an ENTRY per changed file with an EMPTY
 * `testAssociations` — the exact shape that made the test-coverage signal report
 * every changed file as untested. That signal treats an empty array on a file
 * that has an entry as a real gap, which is correct when the data was gathered
 * and catastrophic when it wasn't.
 */
function contextWithUnfedAssociations(files: string[]): SignalContext {
  const report: ComplexityReport = {
    summary: {
      filesAnalyzed: files.length,
      totalViolations: 0,
      avgComplexity: 0,
      maxComplexity: 0,
      violationsByType: {},
      violationsBySeverity: {},
    },
    files: Object.fromEntries(
      files.map(f => [
        f,
        { violations: [], dependents: [], testAssociations: [], riskLevel: 'low' },
      ]),
    ),
  } as unknown as ComplexityReport;

  return {
    chunks: [],
    changedFiles: files,
    allChangedFiles: files,
    complexityReport: report,
    pr: { patches: new Map(), diffLines: new Map() },
  };
}

const find = (reports: ReturnType<typeof runSignals>, id: string) => {
  const r = reports.find(x => x.id === id);
  if (r === undefined) throw new Error(`no signal '${id}'`);
  return r;
};

describe('runSignals', () => {
  it('returns every signal, including ones with nothing to report', () => {
    const reports = runSignals(contextWithUnfedAssociations([]), [], {
      repoScanned: true,
      hasNonTsJs: false,
      allSignals: true,
    });

    expect(reports.length).toBeGreaterThanOrEqual(14);
    expect(new Set(reports.map(r => r.id)).size).toBe(reports.length);
  });

  it('returns signals in a stable order, so two runs on one diff are comparable', () => {
    const ctx = contextWithUnfedAssociations([]);
    const opts = { repoScanned: true, hasNonTsJs: false, allSignals: true };

    expect(runSignals(ctx, [], opts).map(r => r.id)).toEqual(
      runSignals(ctx, [], opts).map(r => r.id),
    );
  });

  it('gives every signal a question a reader can judge relevance from', () => {
    const reports = runSignals(contextWithUnfedAssociations([]), [], {
      repoScanned: true,
      hasNonTsJs: false,
      allSignals: true,
    });

    for (const r of reports) {
      expect(r.question, `${r.id} has no question`).toMatch(/\?$/);
      expect(r.title.length).toBeGreaterThan(0);
    }
  });

  // The regression that mattered: unfed, this signal reported 160 of 160
  // changed files as untested on a real diff of this repo.
  it('suppresses test-coverage entirely when the repo was not scanned', () => {
    const files = ['src/a.ts', 'src/b.ts', 'src/c.ts'];

    const unscanned = find(
      runSignals(contextWithUnfedAssociations(files), files, {
        repoScanned: false,
        hasNonTsJs: false,
        allSignals: true,
      }),
      'test-coverage',
    );

    expect(unscanned.candidates).toEqual([]);
    expect(unscanned.limitation).toBeDefined();
  });

  it('runs test-coverage when the repo WAS scanned, so the suppression is not permanent', () => {
    const files = ['src/a.ts', 'src/b.ts'];

    const scanned = find(
      runSignals(contextWithUnfedAssociations(files), files, {
        repoScanned: true,
        hasNonTsJs: false,
        allSignals: true,
      }),
      'test-coverage',
    );

    // With associations genuinely empty AND a scan having happened, these are
    // real gaps — the point is that it ran at all.
    expect(scanned.candidates).toHaveLength(2);
    expect(scanned.candidates[0].detail).toContain('no test file');
  });

  it('marks the TS/JS-gated signals when the diff has another language', () => {
    const reports = runSignals(contextWithUnfedAssociations([]), [], {
      repoScanned: true,
      hasNonTsJs: true,
      allSignals: true,
    });

    for (const id of ['variant-sweep', 'unread-field', 'catch-discrimination']) {
      expect(find(reports, id).limitation, `${id} unmarked`).toContain(
        'TypeScript/JavaScript only',
      );
    }
  });

  it('leaves the TS/JS gate unmarked on an all-TypeScript diff', () => {
    const reports = runSignals(contextWithUnfedAssociations([]), [], {
      repoScanned: true,
      hasNonTsJs: false,
      allSignals: true,
    });

    expect(find(reports, 'variant-sweep').limitation).toBeUndefined();
  });

  it('marks the cross-file signals when the repo scan was skipped', () => {
    const reports = runSignals(contextWithUnfedAssociations([]), [], {
      repoScanned: false,
      hasNonTsJs: false,
      allSignals: true,
    });

    for (const id of ['stale-literal', 'sibling-surface', 'rename-sweep', 'docs-drift']) {
      expect(find(reports, id).limitation, `${id} unmarked`).toContain('repo-wide scan');
    }
  });

  it('does not mark the diff-only signals as needing the repo scan', () => {
    const reports = runSignals(contextWithUnfedAssociations([]), [], {
      repoScanned: false,
      hasNonTsJs: false,
      allSignals: true,
    });

    expect(find(reports, 'untrusted-input').limitation).toBeUndefined();
    expect(find(reports, 'comparison-change').limitation).toBeUndefined();
  });

  // The default set exists because adversarial review judged 106 candidates
  // across four real diffs of this repo and rated none actionable. These signals
  // were built as inputs an LLM adjudicated; a high false-positive rate is the
  // right trade there and the wrong one for a person reading a terminal.
  it('runs only the measured default set unless --all-signals', () => {
    const reports = runSignals(contextWithUnfedAssociations([]), [], {
      repoScanned: true,
      hasNonTsJs: false,
      allSignals: false,
    });

    expect(reports.map(r => r.id)).toEqual([...DEFAULT_SIGNAL_IDS]);
  });

  it('runs everything under --all-signals', () => {
    const reports = runSignals(contextWithUnfedAssociations([]), [], {
      repoScanned: true,
      hasNonTsJs: false,
      allSignals: true,
    });

    expect(reports.length).toBeGreaterThanOrEqual(14);
  });

  it('withholds every non-default signal, and names them all', () => {
    const withheld = withheldSignalIds();
    const all = runSignals(contextWithUnfedAssociations([]), [], {
      repoScanned: true,
      hasNonTsJs: false,
      allSignals: true,
    });

    expect(withheld.length).toBe(all.length - DEFAULT_SIGNAL_IDS.size);
    for (const id of withheld) expect(DEFAULT_SIGNAL_IDS.has(id)).toBe(false);
  });

  it('keeps comparison-change in the default set — the one with measured true positives', () => {
    expect(DEFAULT_SIGNAL_IDS.has('comparison-change')).toBe(true);
  });

  it('tolerates a context with no diff at all', () => {
    const reports = runSignals({ ...contextWithUnfedAssociations([]), pr: undefined }, [], {
      repoScanned: true,
      hasNonTsJs: false,
      allSignals: true,
    });

    for (const r of reports) expect(r.candidates).toEqual([]);
  });
});
