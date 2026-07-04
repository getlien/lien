import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { detectLinkedWorktree } from './worktree.js';
import { createTestDir, cleanupTestDir } from '../test/helpers/test-db.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

describe('detectLinkedWorktree', () => {
  let mainRoot: string;
  let worktreeRoot: string;

  beforeEach(async () => {
    mainRoot = await createTestDir();
    await git(mainRoot, 'init', '-q', '-b', 'main');
    await git(mainRoot, 'config', 'user.email', 'test@lien.dev');
    await git(mainRoot, 'config', 'user.name', 'Lien Test');
    await git(mainRoot, 'config', 'commit.gpgsign', 'false');
    await fs.writeFile(path.join(mainRoot, 'a.txt'), 'hello\n');
    await git(mainRoot, 'add', '.');
    await git(mainRoot, 'commit', '-q', '-m', 'init');

    worktreeRoot = path.join(mainRoot, '..', `wt-${Date.now()}`);
    await git(mainRoot, 'worktree', 'add', '-q', worktreeRoot, '-b', 'feature');
  });

  afterEach(async () => {
    await cleanupTestDir(mainRoot);
    await cleanupTestDir(worktreeRoot);
  });

  it('flags a linked worktree and resolves the main checkout', async () => {
    const info = await detectLinkedWorktree(worktreeRoot);
    expect(info.isLinkedWorktree).toBe(true);
    // git may canonicalize (e.g. /var -> /private/var); compare by realpath.
    const resolvedMain = await fs.realpath(info.mainRoot!);
    expect(resolvedMain).toBe(await fs.realpath(mainRoot));
  });

  it('does NOT flag the main checkout as a linked worktree', async () => {
    const info = await detectLinkedWorktree(mainRoot);
    expect(info.isLinkedWorktree).toBe(false);
    expect(info.mainRoot).toBeNull();
  });

  it('returns standalone for a non-git directory', async () => {
    const plain = await createTestDir();
    try {
      const info = await detectLinkedWorktree(plain);
      expect(info.isLinkedWorktree).toBe(false);
      expect(info.mainRoot).toBeNull();
    } finally {
      await cleanupTestDir(plain);
    }
  });
});
