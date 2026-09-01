import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { rebaseToRoot, resolveRepoRoot } from './project-root.js';

describe('resolveRepoRoot', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lien-reporoot-')));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('walks up to the .git marker from a subdirectory', async () => {
    await fs.mkdir(path.join(dir, '.git'), { recursive: true });
    const nested = path.join(dir, 'packages', 'cli', 'src');
    await fs.mkdir(nested, { recursive: true });

    expect(resolveRepoRoot(nested)).toBe(dir);
  });

  // A linked git worktree's root has a `.git` FILE, not a directory. This was
  // covered only by the deleted resolveProjectRoot suite; resolveRepoRoot is
  // now the sole resolver, so the coverage moves here rather than disappearing.
  it('recognizes .git as a file (linked git worktrees)', async () => {
    await fs.writeFile(path.join(dir, '.git'), 'gitdir: /elsewhere\n');
    const nested = path.join(dir, 'sub');
    await fs.mkdir(nested);

    expect(resolveRepoRoot(nested)).toBe(dir);
  });

  it('returns the directory itself when it is the root', async () => {
    await fs.mkdir(path.join(dir, '.git'), { recursive: true });
    expect(resolveRepoRoot(dir)).toBe(dir);
  });

  it('falls back to the start directory when there is no marker anywhere', async () => {
    // Non-repo directories must keep working rather than walking to /.
    expect(resolveRepoRoot(dir)).toBe(dir);
  });
});

describe('rebaseToRoot', () => {
  it('re-bases a path typed in a subdirectory onto the analysis root', () => {
    // `lien complexity --files src/thing.ts` run from `<root>/packages/cli`
    // must resolve to `packages/cli/src/thing.ts`, not `src/thing.ts`.
    expect(rebaseToRoot('src/thing.ts', '/repo/packages/cli', '/repo')).toBe(
      'packages/cli/src/thing.ts',
    );
  });

  it('is a no-op when the invocation directory IS the root', () => {
    expect(rebaseToRoot('src/thing.ts', '/repo', '/repo')).toBe('src/thing.ts');
  });

  it('accepts an absolute path', () => {
    expect(rebaseToRoot('/repo/packages/cli/a.ts', '/repo/packages/cli', '/repo')).toBe(
      'packages/cli/a.ts',
    );
  });

  it('handles a path that walks upward out of the invocation directory', () => {
    expect(rebaseToRoot('../parser/a.ts', '/repo/packages/cli', '/repo')).toBe(
      'packages/parser/a.ts',
    );
  });
});
