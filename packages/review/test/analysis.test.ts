import { describe, it, expect, vi } from 'vitest';
import { filterAnalyzableFiles, runComplexityAnalysis } from '../src/analysis.js';
import { silentLogger } from '../src/test-helpers.js';

// ---------------------------------------------------------------------------
// filterAnalyzableFiles
// ---------------------------------------------------------------------------

describe('filterAnalyzableFiles', () => {
  it('keeps supported code extensions', () => {
    const files = ['src/app.ts', 'src/main.js', 'lib/utils.py'];
    const result = filterAnalyzableFiles(files);
    expect(result).toEqual(files);
  });

  it('excludes non-code files', () => {
    const result = filterAnalyzableFiles(['README.md', 'image.png', 'data.csv', 'config.yaml']);
    expect(result).toEqual([]);
  });

  it('excludes node_modules', () => {
    const result = filterAnalyzableFiles(['node_modules/lodash/index.js']);
    expect(result).toEqual([]);
  });

  it('excludes vendor directory', () => {
    const result = filterAnalyzableFiles(['vendor/autoload.php']);
    expect(result).toEqual([]);
  });

  it('excludes dist and build directories', () => {
    const result = filterAnalyzableFiles(['dist/bundle.js', 'build/index.js']);
    expect(result).toEqual([]);
  });

  it('excludes minified and bundled files', () => {
    const result = filterAnalyzableFiles(['app.min.js', 'vendor.bundle.js']);
    expect(result).toEqual([]);
  });

  it('excludes generated files', () => {
    const result = filterAnalyzableFiles(['schema.generated.ts']);
    expect(result).toEqual([]);
  });

  it('excludes lockfiles', () => {
    const result = filterAnalyzableFiles(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']);
    expect(result).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(filterAnalyzableFiles([])).toEqual([]);
  });

  it('filters mixed input correctly', () => {
    const files = [
      'src/app.ts',
      'README.md',
      'node_modules/pkg/index.js',
      'src/utils.js',
      'dist/bundle.js',
    ];
    const result = filterAnalyzableFiles(files);
    expect(result).toEqual(['src/app.ts', 'src/utils.js']);
  });
});

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
});
