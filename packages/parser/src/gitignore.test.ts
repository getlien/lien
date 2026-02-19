import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createGitignoreFilter } from './gitignore.js';

describe('createGitignoreFilter', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-gitignore-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should filter paths matching .gitignore patterns', async () => {
    await fs.writeFile(path.join(testDir, '.gitignore'), '.wip/\ndist/\n');

    const isIgnored = await createGitignoreFilter(testDir);

    expect(isIgnored('.wip/report.md')).toBe(true);
    expect(isIgnored('.wip/notes.txt')).toBe(true);
    expect(isIgnored('dist/index.js')).toBe(true);
    expect(isIgnored('src/index.ts')).toBe(false);
    expect(isIgnored('README.md')).toBe(false);
  });

  it('should handle glob patterns in .gitignore', async () => {
    await fs.writeFile(path.join(testDir, '.gitignore'), '*.log\nbuild/**\n');

    const isIgnored = await createGitignoreFilter(testDir);

    expect(isIgnored('error.log')).toBe(true);
    expect(isIgnored('logs/debug.log')).toBe(true);
    expect(isIgnored('build/output.js')).toBe(true);
    expect(isIgnored('src/app.ts')).toBe(false);
  });

  it('should only apply built-in patterns when no .gitignore exists', async () => {
    const isIgnored = await createGitignoreFilter(testDir);

    // User-defined patterns are not applied
    expect(isIgnored('.wip/report.md')).toBe(false);
    expect(isIgnored('src/index.ts')).toBe(false);

    // Built-in patterns still apply
    expect(isIgnored('node_modules/foo/index.js')).toBe(true);
    expect(isIgnored('.lien/indices/abc')).toBe(true);
    expect(isIgnored('dist/index.js')).toBe(true);
    expect(isIgnored('build/main.js')).toBe(true);
  });

  it('should handle comments and blank lines in .gitignore', async () => {
    await fs.writeFile(
      path.join(testDir, '.gitignore'),
      '# Build output\ndist/\n\n# Temp files\n*.tmp\n',
    );

    const isIgnored = await createGitignoreFilter(testDir);

    expect(isIgnored('dist/bundle.js')).toBe(true);
    expect(isIgnored('cache.tmp')).toBe(true);
    expect(isIgnored('src/index.ts')).toBe(false);
  });

  it('should always ignore node_modules, vendor, .git, .lien, dist, build, and minified assets', async () => {
    const isIgnored = await createGitignoreFilter(testDir);

    expect(isIgnored('node_modules/express/index.js')).toBe(true);
    expect(isIgnored('src/node_modules/lib/foo.js')).toBe(true);
    expect(isIgnored('vendor/autoload.php')).toBe(true);
    expect(isIgnored('.git/HEAD')).toBe(true);
    expect(isIgnored('.lien/indices/abc123')).toBe(true);
    expect(isIgnored('dist/bundle.js')).toBe(true);
    expect(isIgnored('build/output.js')).toBe(true);
    expect(isIgnored('lib/app.min.js')).toBe(true);
    expect(isIgnored('styles/main.min.css')).toBe(true);
  });

  it('should not allow .gitignore negations to override built-in patterns', async () => {
    await fs.writeFile(
      path.join(testDir, '.gitignore'),
      '!node_modules/\n!.lien/\n!vendor/\n!.git/\n',
    );

    const isIgnored = await createGitignoreFilter(testDir);

    expect(isIgnored('node_modules/express/index.js')).toBe(true);
    expect(isIgnored('.lien/indices/abc123')).toBe(true);
    expect(isIgnored('vendor/autoload.php')).toBe(true);
    expect(isIgnored('.git/HEAD')).toBe(true);
  });

  it('should handle negation patterns', async () => {
    await fs.writeFile(path.join(testDir, '.gitignore'), '*.log\n!important.log\n');

    const isIgnored = await createGitignoreFilter(testDir);

    expect(isIgnored('debug.log')).toBe(true);
    expect(isIgnored('important.log')).toBe(false);
  });

  describe('nested .gitignore support', () => {
    it('should apply nested .gitignore patterns scoped to their directory', async () => {
      // Root has no .gitignore, nested package does
      await fs.mkdir(path.join(testDir, 'packages/app'), { recursive: true });
      await fs.writeFile(path.join(testDir, 'packages/app/.gitignore'), 'generated/\n');

      const isIgnored = await createGitignoreFilter(testDir);

      // Nested pattern applies within packages/app/
      expect(isIgnored('packages/app/generated/types.ts')).toBe(true);
      // Same pattern does NOT apply at root level
      expect(isIgnored('generated/types.ts')).toBe(false);
      // Nor in a different package
      expect(isIgnored('packages/other/generated/types.ts')).toBe(false);
    });

    it('should combine root and nested .gitignore patterns', async () => {
      await fs.writeFile(path.join(testDir, '.gitignore'), '*.log\n');
      await fs.mkdir(path.join(testDir, 'packages/app'), { recursive: true });
      await fs.writeFile(path.join(testDir, 'packages/app/.gitignore'), 'generated/\n');

      const isIgnored = await createGitignoreFilter(testDir);

      // Root pattern applies everywhere
      expect(isIgnored('debug.log')).toBe(true);
      expect(isIgnored('packages/app/error.log')).toBe(true);
      // Nested pattern applies within its scope
      expect(isIgnored('packages/app/generated/foo.ts')).toBe(true);
      // Regular files are not ignored
      expect(isIgnored('packages/app/src/index.ts')).toBe(false);
    });

    it('should handle multiple levels of nesting', async () => {
      await fs.writeFile(path.join(testDir, '.gitignore'), '*.log\n');
      await fs.mkdir(path.join(testDir, 'packages/app/src'), { recursive: true });
      await fs.writeFile(path.join(testDir, 'packages/.gitignore'), 'tmp/\n');
      await fs.writeFile(path.join(testDir, 'packages/app/.gitignore'), 'generated/\n');

      const isIgnored = await createGitignoreFilter(testDir);

      // Root: *.log
      expect(isIgnored('error.log')).toBe(true);
      // packages/: tmp/ (matches tmp/ at any depth within packages/ scope, per git semantics)
      expect(isIgnored('packages/tmp/cache.txt')).toBe(true);
      expect(isIgnored('packages/app/tmp/cache.txt')).toBe(true);
      // But tmp/ does NOT apply outside packages/ scope
      expect(isIgnored('tmp/cache.txt')).toBe(false);
      // packages/app/: generated/
      expect(isIgnored('packages/app/generated/types.ts')).toBe(true);
      // Unaffected paths
      expect(isIgnored('packages/app/src/index.ts')).toBe(false);
    });

    it('should not scan inside ALWAYS_IGNORE directories during discovery', async () => {
      // Even if node_modules has a .gitignore, it should not be discovered
      await fs.mkdir(path.join(testDir, 'node_modules/pkg'), { recursive: true });
      await fs.writeFile(path.join(testDir, 'node_modules/.gitignore'), '!*\n');
      await fs.mkdir(path.join(testDir, 'src'), { recursive: true });

      const isIgnored = await createGitignoreFilter(testDir);

      // node_modules is still ignored (ALWAYS_IGNORE takes precedence)
      expect(isIgnored('node_modules/pkg/index.js')).toBe(true);
      // src files are not ignored
      expect(isIgnored('src/index.ts')).toBe(false);
    });

    it('should work with no .gitignore files at all (backwards compat)', async () => {
      await fs.mkdir(path.join(testDir, 'src'), { recursive: true });

      const isIgnored = await createGitignoreFilter(testDir);

      // Built-in patterns still apply
      expect(isIgnored('node_modules/foo/index.js')).toBe(true);
      expect(isIgnored('.git/HEAD')).toBe(true);
      // Regular files are not ignored
      expect(isIgnored('src/index.ts')).toBe(false);
    });

    it('should work with only root .gitignore (backwards compat)', async () => {
      await fs.writeFile(path.join(testDir, '.gitignore'), '.wip/\n*.tmp\n');
      await fs.mkdir(path.join(testDir, 'src'), { recursive: true });

      const isIgnored = await createGitignoreFilter(testDir);

      expect(isIgnored('.wip/report.md')).toBe(true);
      expect(isIgnored('cache.tmp')).toBe(true);
      expect(isIgnored('src/index.ts')).toBe(false);
    });
  });
});
