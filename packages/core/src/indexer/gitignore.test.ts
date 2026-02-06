import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createGitignoreFilter } from './gitignore.js';

describe('createGitignoreFilter', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), 'lien-test-gitignore-' + Date.now());
    await fs.mkdir(testDir, { recursive: true });
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

  it('should return false for everything when no .gitignore exists', async () => {
    const isIgnored = await createGitignoreFilter(testDir);

    expect(isIgnored('.wip/report.md')).toBe(false);
    expect(isIgnored('dist/index.js')).toBe(false);
    expect(isIgnored('src/index.ts')).toBe(false);
  });

  it('should handle comments and blank lines in .gitignore', async () => {
    await fs.writeFile(path.join(testDir, '.gitignore'), '# Build output\ndist/\n\n# Temp files\n*.tmp\n');

    const isIgnored = await createGitignoreFilter(testDir);

    expect(isIgnored('dist/bundle.js')).toBe(true);
    expect(isIgnored('cache.tmp')).toBe(true);
    expect(isIgnored('src/index.ts')).toBe(false);
  });

  it('should handle negation patterns', async () => {
    await fs.writeFile(path.join(testDir, '.gitignore'), '*.log\n!important.log\n');

    const isIgnored = await createGitignoreFilter(testDir);

    expect(isIgnored('debug.log')).toBe(true);
    expect(isIgnored('important.log')).toBe(false);
  });
});
