import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  resolveWorkspacePackageEntries,
  clearWorkspacePackageCache,
} from './workspace-packages.js';

describe('resolveWorkspacePackageEntries', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-workspace-packages-'));
  });

  afterEach(async () => {
    clearWorkspacePackageCache();
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  async function writeJson(relPath: string, data: unknown): Promise<void> {
    const abs = path.join(testDir, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, JSON.stringify(data, null, 2));
  }

  async function writeFile(relPath: string, content = ''): Promise<void> {
    const abs = path.join(testDir, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }

  it('returns an empty map for a non-workspace repo (no workspaces field)', async () => {
    await writeJson('package.json', { name: 'solo-app' });
    await writeFile('src/index.ts', 'export const x = 1;');

    const map = resolveWorkspacePackageEntries(testDir);

    expect(map.size).toBe(0);
  });

  it('returns an empty map when there is no root package.json at all', () => {
    const map = resolveWorkspacePackageEntries(testDir);
    expect(map.size).toBe(0);
  });

  it('resolves a simple npm workspaces glob to each member source entry', async () => {
    await writeJson('package.json', { name: 'root', workspaces: ['packages/*'] });
    await writeJson('packages/parser/package.json', {
      name: '@liendev/parser',
      main: './dist/index.js',
    });
    await writeFile('packages/parser/src/index.ts', 'export const parser = true;');
    await writeJson('packages/core/package.json', {
      name: '@liendev/core',
      main: './dist/index.js',
    });
    await writeFile('packages/core/src/index.ts', 'export const core = true;');

    const map = resolveWorkspacePackageEntries(testDir);

    expect(map.get('@liendev/parser')).toBe('packages/parser/src/index.ts');
    expect(map.get('@liendev/core')).toBe('packages/core/src/index.ts');
    expect(map.size).toBe(2);
  });

  it('resolves nested workspace globs', async () => {
    await writeJson('package.json', {
      name: 'root',
      workspaces: ['packages/*', 'tools/*/plugins/*'],
    });
    await writeJson('packages/core/package.json', { name: '@scope/core' });
    await writeFile('packages/core/src/index.ts', 'export const core = true;');
    await writeJson('tools/build/plugins/logger/package.json', { name: '@scope/logger-plugin' });
    await writeFile('tools/build/plugins/logger/src/index.ts', 'export const logger = true;');

    const map = resolveWorkspacePackageEntries(testDir);

    expect(map.get('@scope/core')).toBe('packages/core/src/index.ts');
    expect(map.get('@scope/logger-plugin')).toBe('tools/build/plugins/logger/src/index.ts');
  });

  it('supports the { workspaces: { packages: [...] } } object form', async () => {
    await writeJson('package.json', { name: 'root', workspaces: { packages: ['packages/*'] } });
    await writeJson('packages/widget/package.json', { name: '@scope/widget' });
    await writeFile('packages/widget/src/index.ts', 'export const widget = true;');

    const map = resolveWorkspacePackageEntries(testDir);

    expect(map.get('@scope/widget')).toBe('packages/widget/src/index.ts');
  });

  it('honors negated exclude globs', async () => {
    await writeJson('package.json', {
      name: 'root',
      workspaces: ['packages/*', '!packages/excluded'],
    });
    await writeJson('packages/included/package.json', { name: '@scope/included' });
    await writeFile('packages/included/src/index.ts', 'export const included = true;');
    await writeJson('packages/excluded/package.json', { name: '@scope/excluded' });
    await writeFile('packages/excluded/src/index.ts', 'export const excluded = true;');

    const map = resolveWorkspacePackageEntries(testDir);

    expect(map.has('@scope/included')).toBe(true);
    expect(map.has('@scope/excluded')).toBe(false);
  });

  it('falls back to the src/index.<ext> convention when main is absent', async () => {
    await writeJson('package.json', { name: 'root', workspaces: ['packages/*'] });
    await writeJson('packages/noentry/package.json', { name: '@scope/noentry' });
    await writeFile('packages/noentry/src/index.tsx', 'export const noentry = true;');

    const map = resolveWorkspacePackageEntries(testDir);

    expect(map.get('@scope/noentry')).toBe('packages/noentry/src/index.tsx');
  });

  it('derives the source entry from a dist-style main field', async () => {
    await writeJson('package.json', { name: 'root', workspaces: ['packages/*'] });
    await writeJson('packages/action/package.json', {
      name: '@scope/action',
      main: './dist/cli.js',
    });
    await writeFile('packages/action/src/cli.ts', 'export const cli = true;');

    const map = resolveWorkspacePackageEntries(testDir);

    expect(map.get('@scope/action')).toBe('packages/action/src/cli.ts');
  });

  it('skips a matched directory that has no package.json', async () => {
    await writeJson('package.json', { name: 'root', workspaces: ['packages/*'] });
    await fs.mkdir(path.join(testDir, 'packages/not-a-package'), { recursive: true });
    await writeJson('packages/real/package.json', { name: '@scope/real' });
    await writeFile('packages/real/src/index.ts', 'export const real = true;');

    const map = resolveWorkspacePackageEntries(testDir);

    expect(map.size).toBe(1);
    expect(map.get('@scope/real')).toBe('packages/real/src/index.ts');
  });

  it('skips a matched package whose entry file cannot be resolved on disk', async () => {
    await writeJson('package.json', { name: 'root', workspaces: ['packages/*'] });
    // Package exists, declares a main, but neither that file nor the
    // src/index.* convention exists on disk.
    await writeJson('packages/ghost/package.json', {
      name: '@scope/ghost',
      main: './dist/index.js',
    });

    const map = resolveWorkspacePackageEntries(testDir);

    expect(map.has('@scope/ghost')).toBe(false);
  });

  it('caches the resolved map per workspace root', async () => {
    await writeJson('package.json', { name: 'root', workspaces: ['packages/*'] });
    await writeJson('packages/a/package.json', { name: '@scope/a' });
    await writeFile('packages/a/src/index.ts', 'export const a = true;');

    const first = resolveWorkspacePackageEntries(testDir);

    // Add a second package after the first resolution — the cached map
    // should be returned unchanged until the cache is explicitly cleared.
    await writeJson('packages/b/package.json', { name: '@scope/b' });
    await writeFile('packages/b/src/index.ts', 'export const b = true;');

    const second = resolveWorkspacePackageEntries(testDir);
    expect(second).toBe(first);
    expect(second.has('@scope/b')).toBe(false);

    clearWorkspacePackageCache();

    const third = resolveWorkspacePackageEntries(testDir);
    expect(third.has('@scope/b')).toBe(true);
  });
});
