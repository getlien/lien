import { describe, it, expect } from 'vitest';

import { filterAnalyzableFiles } from './analyzable-files.js';

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

  // The extension is read as `file.slice(file.lastIndexOf('.'))`. With no dot,
  // `lastIndexOf` returns -1 and `slice(-1)` yields the LAST CHARACTER, not ''
  // — so an extensionless file is judged on a one-character "extension". It is
  // correctly excluded either way (no supported extension is one character,
  // dot included), but the reason is incidental, so pin the behaviour.
  it('excludes a file with no extension at all', () => {
    expect(filterAnalyzableFiles(['Makefile', 'LICENSE', 'bin/lien'])).toEqual([]);
  });

  it('excludes a dotfile with no second dot', () => {
    expect(filterAnalyzableFiles(['.gitignore', '.env'])).toEqual([]);
  });

  it('preserves input order and duplicates rather than deduping', () => {
    const files = ['b.ts', 'a.ts', 'b.ts'];
    expect(filterAnalyzableFiles(files)).toEqual(['b.ts', 'a.ts', 'b.ts']);
  });
});
