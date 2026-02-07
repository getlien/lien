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
    await fs.writeFile(path.join(testDir, '.gitignore'), '# Build output\ndist/\n\n# Temp files\n*.tmp\n');

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
    await fs.writeFile(path.join(testDir, '.gitignore'), '!node_modules/\n!.lien/\n!vendor/\n!.git/\n');

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
});
