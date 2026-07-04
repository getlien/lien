import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getRepoRoot, collectFileChanges, readWorktree } from './delta-git.js';
import type { FileContentChange } from '@liendev/parser';

const execFileAsync = promisify(execFile);

const SIMPLE = 'export function target(x) {\n  return x + 1;\n}\n';
const COMPLEX =
  'export function target(x) {\n  if (x) { if (x > 1) { if (x > 2) { return 1; } } }\n  return 2;\n}\n';

function byPath(changes: FileContentChange[], filepath: string): FileContentChange | undefined {
  return changes.find(c => c.filepath === filepath);
}

describe('delta-git', () => {
  let dir: string;

  async function git(...args: string[]): Promise<void> {
    await execFileAsync('git', args, { cwd: dir });
  }

  async function write(rel: string, content: string): Promise<void> {
    const full = path.join(dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf-8');
  }

  async function initRepo(): Promise<void> {
    await git('init', '-q');
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('config', 'commit.gpgsign', 'false');
  }

  async function commitAll(msg: string): Promise<void> {
    await git('add', '-A');
    await git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', msg);
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-delta-git-'));
    // Resolve symlinked tmp dirs (macOS /var → /private/var) so paths compare cleanly.
    dir = await fs.realpath(dir);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('getRepoRoot returns null outside a repo and the toplevel inside one', async () => {
    expect(await getRepoRoot(dir)).toBeNull();
    await initRepo();
    expect(await getRepoRoot(dir)).toBe(dir);
  });

  it('detects a modified file (before = HEAD, after = working tree)', async () => {
    await initRepo();
    await write('a.ts', SIMPLE);
    await commitAll('init');
    await write('a.ts', COMPLEX);

    const changes = await collectFileChanges(dir);
    const c = byPath(changes, 'a.ts')!;
    expect(c.before).toBe(SIMPLE);
    expect(c.after).toBe(COMPLEX);
    expect(c.oldPath).toBeUndefined();
  });

  it('detects a staged modification the same as an unstaged one', async () => {
    await initRepo();
    await write('a.ts', SIMPLE);
    await commitAll('init');
    await write('a.ts', COMPLEX);
    await git('add', 'a.ts'); // stage it

    const c = byPath(await collectFileChanges(dir), 'a.ts')!;
    expect(c.before).toBe(SIMPLE);
    expect(c.after).toBe(COMPLEX);
  });

  it('reflects unstaged edits on top of a staged change in the after image', async () => {
    await initRepo();
    await write('a.ts', SIMPLE);
    await commitAll('init');
    await write('a.ts', COMPLEX);
    await git('add', 'a.ts');
    await write('a.ts', COMPLEX + '// trailing edit\n'); // further unstaged edit

    const c = byPath(await collectFileChanges(dir), 'a.ts')!;
    expect(c.after).toContain('trailing edit');
  });

  it('treats an untracked new file as added (before = null)', async () => {
    await initRepo();
    await write('a.ts', SIMPLE);
    await commitAll('init');
    await write('b.ts', COMPLEX); // untracked

    const c = byPath(await collectFileChanges(dir), 'b.ts')!;
    expect(c.before).toBeNull();
    expect(c.after).toBe(COMPLEX);
  });

  it('treats a deleted file as removed (after = null)', async () => {
    await initRepo();
    await write('a.ts', COMPLEX);
    await commitAll('init');
    await fs.rm(path.join(dir, 'a.ts'));

    const c = byPath(await collectFileChanges(dir), 'a.ts')!;
    expect(c.before).toBe(COMPLEX);
    expect(c.after).toBeNull();
  });

  it('detects a rename and records the old path', async () => {
    await initRepo();
    await write('a.ts', COMPLEX);
    await commitAll('init');
    await git('mv', 'a.ts', 'b.ts'); // staged rename

    const c = byPath(await collectFileChanges(dir), 'b.ts')!;
    expect(c.oldPath).toBe('a.ts');
    expect(c.before).toBe(COMPLEX);
    expect(c.after).toBe(COMPLEX);
  });

  it('handles an unborn HEAD (repo with no commits) — all files are added', async () => {
    await initRepo();
    await write('a.ts', COMPLEX);
    await git('add', 'a.ts'); // staged, never committed
    await write('b.ts', SIMPLE); // untracked

    const changes = await collectFileChanges(dir);
    const a = byPath(changes, 'a.ts')!;
    const b = byPath(changes, 'b.ts')!;
    expect(a.before).toBeNull();
    expect(a.after).toBe(COMPLEX);
    expect(b.before).toBeNull();
    expect(b.after).toBe(SIMPLE);
  });

  it('ignores files whose extension the parser does not support', async () => {
    await initRepo();
    await write('a.ts', SIMPLE);
    await commitAll('init');
    await write('notes.txt', 'hello');
    await write('data.lock', 'x');

    const changes = await collectFileChanges(dir);
    expect(byPath(changes, 'notes.txt')).toBeUndefined();
    expect(byPath(changes, 'data.lock')).toBeUndefined();
  });

  it('returns an empty array for a clean working tree', async () => {
    await initRepo();
    await write('a.ts', SIMPLE);
    await commitAll('init');
    expect(await collectFileChanges(dir)).toEqual([]);
  });

  describe('readWorktree — only ENOENT maps to null (Phase-1 finding #4)', () => {
    it('reads an existing file', async () => {
      await write('a.ts', SIMPLE);
      expect(await readWorktree(dir, 'a.ts')).toBe(SIMPLE);
    });

    it('returns null for a genuinely absent file (ENOENT)', async () => {
      expect(await readWorktree(dir, 'does-not-exist.ts')).toBeNull();
    });

    it('throws (does NOT return null) when the path is a directory (EISDIR)', async () => {
      // A directory where a file is expected must NOT masquerade as a deletion.
      await fs.mkdir(path.join(dir, 'a-dir'), { recursive: true });
      await expect(readWorktree(dir, 'a-dir')).rejects.toThrow();
    });
  });
});
