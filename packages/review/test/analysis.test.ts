import { describe, it, expect } from 'vitest';
import { runComplexityAnalysis } from '../src/analysis.js';
import { silentLogger } from '../src/test-helpers.js';

// `filterAnalyzableFiles` moved to `@liendev/parser` alongside the signal
// modules that gate on it; its tests moved with it, to
// `packages/parser/src/signals/analyzable-files.test.ts`.

// ---------------------------------------------------------------------------
// runComplexityAnalysis
// ---------------------------------------------------------------------------

describe('runComplexityAnalysis', () => {
  it('returns null for empty file list', async () => {
    const result = await runComplexityAnalysis([], '15', '/tmp', silentLogger);
    expect(result).toBeNull();
  });

  it('returns report and chunks for valid files', async () => {
    // Use a path relative to review package root (vitest cwd)
    const result = await runComplexityAnalysis(
      ['src/analysis.ts'],
      '15',
      process.cwd(),
      silentLogger,
    );

    expect(result).not.toBeNull();
    expect(result!.report).toBeDefined();
    expect(result!.report.summary).toBeDefined();
    expect(result!.chunks).toBeDefined();
    expect(result!.chunks.length).toBeGreaterThan(0);
  });

  it('handles non-numeric threshold gracefully', async () => {
    const result = await runComplexityAnalysis(
      ['src/analysis.ts'],
      'invalid',
      process.cwd(),
      silentLogger,
    );

    // Should still succeed — falls back to default thresholds
    expect(result).not.toBeNull();
    expect(result!.report).toBeDefined();
  });

  it('skips files absent from the checkout (baseline pass of a PR that adds files)', async () => {
    const result = await runComplexityAnalysis(
      ['src/analysis.ts', 'src/added-by-the-pr-does-not-exist.ts'],
      '15',
      process.cwd(),
      silentLogger,
    );

    // The existing file is analyzed; the absent one is skipped without a
    // per-file parser error and without appearing in the report.
    expect(result).not.toBeNull();
    expect(result!.chunks.length).toBeGreaterThan(0);
    expect(result!.report.files['src/added-by-the-pr-does-not-exist.ts']).toBeUndefined();
  });

  it('returns null when no listed file exists in the checkout', async () => {
    const result = await runComplexityAnalysis(
      ['src/nope-1.ts', 'src/nope-2.ts'],
      '15',
      process.cwd(),
      silentLogger,
    );

    expect(result).toBeNull();
  });
});
