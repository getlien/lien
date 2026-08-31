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
    expect(filterAnalyzableFiles(['Makefile', 'LICENSE', 'bin/lien', ''])).toEqual([]);
  });

  it('excludes a dotfile with no second dot', () => {
    expect(filterAnalyzableFiles(['.gitignore', '.env'])).toEqual([]);
  });

  it('preserves input order and duplicates rather than deduping', () => {
    const files = ['b.ts', 'a.ts', 'b.ts'];
    expect(filterAnalyzableFiles(files)).toEqual(['b.ts', 'a.ts', 'b.ts']);
  });
});

/**
 * Two KNOWN DEFECTS, pinned rather than fixed.
 *
 * Both predate the move into this package and behave identically to the
 * implementation this replaced, so neither is a regression — but both silently
 * drop real authored source, which is worse than the extensionless case above,
 * and a signal that never sees a file reports nothing rather than reporting it
 * as skipped.
 *
 * They are pinned here, not fixed, because changing what this gate admits
 * changes what every signal module sees, and the change that moved this
 * function claims byte-identical behavior. Fixing them is a behavior change and
 * belongs in its own commit; these assertions are what will fail, deliberately,
 * when someone makes it.
 */
describe('filterAnalyzableFiles — known defects (pinned, not endorsed)', () => {
  // The exclude patterns are unanchored substring matches, not path segments,
  // so any directory whose name merely CONTAINS one is excluded too.
  // Fix would be `/(^|\/)dist\//` etc.
  it('wrongly excludes real source under a directory whose name contains an excluded one', () => {
    expect(
      filterAnalyzableFiles([
        'src/prebuild/x.ts',
        'src/rebuild/x.ts',
        'src/mydist/app.ts',
        'packages/myvendor/x.php',
      ]),
    ).toEqual([]);

    // Not followed by a slash, so these survive — showing the rule really is
    // "contains the pattern including its trailing slash", not "is that dir".
    expect(filterAnalyzableFiles(['src/distributed/x.ts', 'src/redistribute/x.ts'])).toEqual([
      'src/distributed/x.ts',
      'src/redistribute/x.ts',
    ]);
  });

  // Extension matching is case-sensitive against a lowercase set, so
  // uppercase extensions — real on case-insensitive filesystems and in older
  // Java/PHP trees — are dropped. Fix would lowercase before the lookup.
  it('wrongly excludes an uppercase extension', () => {
    expect(filterAnalyzableFiles(['src/App.TS', 'src/Main.PY', 'legacy/Foo.PHP'])).toEqual([]);
  });
});
