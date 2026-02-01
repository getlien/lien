import { describe, it, expect } from 'vitest';
import { filterAnalyzableFiles } from '@liendev/review';

describe('filterAnalyzableFiles', () => {
  it('should include TypeScript files', () => {
    const files = ['src/index.ts', 'src/utils.tsx'];
    const result = filterAnalyzableFiles(files);

    expect(result).toEqual(['src/index.ts', 'src/utils.tsx']);
  });

  it('should include JavaScript files', () => {
    const files = ['src/index.js', 'src/utils.jsx'];
    const result = filterAnalyzableFiles(files);

    expect(result).toEqual(['src/index.js', 'src/utils.jsx']);
  });

  it('should include Python files', () => {
    const files = ['src/main.py', 'tests/test_main.py'];
    const result = filterAnalyzableFiles(files);

    expect(result).toEqual(['src/main.py', 'tests/test_main.py']);
  });

  it('should include PHP files', () => {
    const files = ['app/Http/Controller.php'];
    const result = filterAnalyzableFiles(files);

    expect(result).toEqual(['app/Http/Controller.php']);
  });

  it('should exclude non-code files', () => {
    const files = [
      'README.md',
      'package.json',
      'tsconfig.json',
      '.gitignore',
      'styles.css',
      'image.png',
    ];
    const result = filterAnalyzableFiles(files);

    expect(result).toEqual([]);
  });

  it('should exclude node_modules', () => {
    const files = [
      'node_modules/lodash/index.js',
      'node_modules/@types/node/index.d.ts',
    ];
    const result = filterAnalyzableFiles(files);

    expect(result).toEqual([]);
  });

  it('should exclude vendor directory', () => {
    const files = ['vendor/autoload.php', 'vendor/composer/ClassLoader.php'];
    const result = filterAnalyzableFiles(files);

    expect(result).toEqual([]);
  });

  it('should exclude dist/build directories', () => {
    const files = ['dist/index.js', 'build/output.js'];
    const result = filterAnalyzableFiles(files);

    expect(result).toEqual([]);
  });

  it('should exclude minified files', () => {
    const files = ['app.min.js', 'vendor.bundle.js', 'types.generated.ts'];
    const result = filterAnalyzableFiles(files);

    expect(result).toEqual([]);
  });

  it('should exclude lock files', () => {
    const files = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];
    const result = filterAnalyzableFiles(files);

    expect(result).toEqual([]);
  });

  it('should handle mixed files correctly', () => {
    const files = [
      'src/index.ts',
      'node_modules/lib/index.js',
      'README.md',
      'src/utils.py',
      'dist/bundle.js',
      'app/Controller.php',
    ];
    const result = filterAnalyzableFiles(files);

    expect(result).toEqual(['src/index.ts', 'src/utils.py', 'app/Controller.php']);
  });

  it('should return empty array for empty input', () => {
    const result = filterAnalyzableFiles([]);

    expect(result).toEqual([]);
  });
});
