import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getIndexDir } from '@liendev/parser';
import { INDEX_FORMAT_VERSION } from '../constants.js';
import { STRUCTURAL_DB_FILENAME } from './sqlite/schema.js';
import { resolveIndexStrategy, _resetWarnMemo } from './overlay-resolution.js';
import { createTestDir, cleanupTestDir } from '../test/helpers/test-db.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

/** Seed a base index dir (existence-only content) for the given main root. */
async function seedBaseIndex(mainRoot: string, formatVersion: number): Promise<string> {
  const baseIndexDir = getIndexDir(mainRoot);
  await fs.mkdir(baseIndexDir, { recursive: true });
  await fs.writeFile(path.join(baseIndexDir, STRUCTURAL_DB_FILENAME), '');
  await fs.writeFile(
    path.join(baseIndexDir, 'manifest.json'),
    JSON.stringify({ formatVersion, files: {} }),
  );
  return baseIndexDir;
}

describe('resolveIndexStrategy', () => {
  let mainRoot: string;
  let worktreeRoot: string;

  beforeEach(async () => {
    _resetWarnMemo();
    delete process.env.LIEN_WORKTREE_STANDALONE;

    mainRoot = await createTestDir();
    await git(mainRoot, 'init', '-q', '-b', 'main');
    await git(mainRoot, 'config', 'user.email', 'test@lien.dev');
    await git(mainRoot, 'config', 'user.name', 'Lien Test');
    await git(mainRoot, 'config', 'commit.gpgsign', 'false');
    await fs.writeFile(path.join(mainRoot, 'a.txt'), 'hello\n');
    await git(mainRoot, 'add', '.');
    await git(mainRoot, 'commit', '-q', '-m', 'init');

    worktreeRoot = path.join(
      mainRoot,
      '..',
      `wt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    await git(mainRoot, 'worktree', 'add', '-q', worktreeRoot, '-b', 'feature');

    // `git worktree list` reports canonical (realpath'd) paths, so align the
    // test's roots with what resolution derives — otherwise macOS's
    // /var -> /private/var symlink makes the seeded base index dir (keyed by
    // path hash) miss the one resolution computes.
    mainRoot = await fs.realpath(mainRoot);
    worktreeRoot = await fs.realpath(worktreeRoot);
  });

  afterEach(async () => {
    delete process.env.LIEN_WORKTREE_STANDALONE;
    await cleanupTestDir(mainRoot);
    await cleanupTestDir(worktreeRoot);
  });

  it('returns overlay when the worktree has a complete, compatible base index', async () => {
    const baseIndexDir = await seedBaseIndex(mainRoot, INDEX_FORMAT_VERSION);
    const strategy = await resolveIndexStrategy(worktreeRoot);
    expect(strategy.mode).toBe('overlay');
    if (strategy.mode !== 'overlay') throw new Error('unreachable');
    expect(strategy.baseIndexDir).toBe(baseIndexDir);
    expect(strategy.overlayIndexDir).toBe(getIndexDir(worktreeRoot));
    expect(await fs.realpath(strategy.mainRoot)).toBe(await fs.realpath(mainRoot));
  });

  it('falls back to standalone when the main checkout has no index (with a hint)', async () => {
    const warn = vi.fn();
    const strategy = await resolveIndexStrategy(worktreeRoot, { warn });
    expect(strategy.mode).toBe('standalone');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/no complete index/i);
  });

  it('falls back to standalone on base format mismatch (with a warning)', async () => {
    await seedBaseIndex(mainRoot, INDEX_FORMAT_VERSION - 1);
    const warn = vi.fn();
    const strategy = await resolveIndexStrategy(worktreeRoot, { warn });
    expect(strategy.mode).toBe('standalone');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/incompatible/i);
  });

  it('honors the LIEN_WORKTREE_STANDALONE escape hatch even with a valid base', async () => {
    await seedBaseIndex(mainRoot, INDEX_FORMAT_VERSION);
    process.env.LIEN_WORKTREE_STANDALONE = '1';
    const strategy = await resolveIndexStrategy(worktreeRoot);
    expect(strategy.mode).toBe('standalone');
  });

  it('returns standalone for the main checkout itself', async () => {
    await seedBaseIndex(mainRoot, INDEX_FORMAT_VERSION);
    const strategy = await resolveIndexStrategy(mainRoot);
    expect(strategy.mode).toBe('standalone');
  });

  it('warns only once per base index dir', async () => {
    const warn = vi.fn();
    await resolveIndexStrategy(worktreeRoot, { warn });
    await resolveIndexStrategy(worktreeRoot, { warn });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
