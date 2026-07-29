import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { resolveJsDirectoryIndex, clearJsDirectoryIndexCache } from './js-directory-index.js';

describe('resolveJsDirectoryIndex', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-js-directory-index-'));
  });

  afterEach(async () => {
    clearJsDirectoryIndexCache();
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  async function writeFile(relPath: string, content: string): Promise<void> {
    const abs = path.join(testDir, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }

  it('is a no-op when workspaceRoot is undefined', () => {
    expect(resolveJsDirectoryIndex('src', undefined)).toBe('src');
  });

  it('is a no-op when the specifier is not a directory at all', async () => {
    await writeFile('src/utils/color.ts', 'export {};\n');
    expect(resolveJsDirectoryIndex('src/utils/color', testDir)).toBe('src/utils/color');
  });

  it('resolves a bare directory to its index.ts entry file', async () => {
    await writeFile('src/index.ts', 'export {};\n');
    expect(resolveJsDirectoryIndex('src', testDir)).toBe('src/index');
  });

  it('resolves a nested directory to its index.tsx entry file', async () => {
    await writeFile('src/utils/index.tsx', 'export {};\n');
    expect(resolveJsDirectoryIndex('src/utils', testDir)).toBe('src/utils/index');
  });

  it('tries index candidates in priority order (.ts before .js)', async () => {
    await writeFile('src/index.js', 'module.exports = {};\n');
    await writeFile('src/index.ts', 'export {};\n');
    expect(resolveJsDirectoryIndex('src', testDir)).toBe('src/index');
  });

  it('is a no-op when the directory exists but has no recognized index file', async () => {
    await writeFile('src/loose.ts', 'export {};\n');
    expect(resolveJsDirectoryIndex('src', testDir)).toBe('src');
  });

  it('caches the resolved entry file per directory', async () => {
    await writeFile('src/index.ts', 'export {};\n');
    const first = resolveJsDirectoryIndex('src', testDir);
    // Removing the entry file after the first call should not change the
    // cached result within the same process -- mirrors resolveGoModulePrefix's
    // caching contract.
    await fs.rm(path.join(testDir, 'src', 'index.ts'));
    const second = resolveJsDirectoryIndex('src', testDir);

    expect(second).toBe(first);
    expect(second).toBe('src/index');
  });
});
