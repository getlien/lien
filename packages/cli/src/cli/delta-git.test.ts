import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getRepoRoot, collectFileChanges, collectFileChange, readWorktree } from './delta-git.js';
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

  describe('collectFileChanges — --base <ref>', () => {
    async function revParse(ref: string): Promise<string> {
      const { stdout } = await execFileAsync('git', ['rev-parse', ref], { cwd: dir });
      return stdout.trim();
    }

    it('baseRef === HEAD produces the same result as the default (no --base)', async () => {
      await initRepo();
      await write('a.ts', SIMPLE);
      await commitAll('init');
      await write('a.ts', COMPLEX);

      const head = await revParse('HEAD');
      const withoutBase = await collectFileChanges(dir);
      const withBase = await collectFileChanges(dir, head);
      expect(withBase).toEqual(withoutBase);
      const c = byPath(withBase, 'a.ts')!;
      expect(c.before).toBe(SIMPLE);
      expect(c.after).toBe(COMPLEX);
    });

    it('sees a change committed after the base ref, not just working-tree edits', async () => {
      // The CI-relevant case: a crossing introduced in an earlier commit of the
      // PR (already sitting in the working tree at HEAD, no uncommitted diff)
      // must still show up when compared against origin/main.
      await initRepo();
      await write('a.ts', SIMPLE);
      await commitAll('init');
      const base = await revParse('HEAD');

      await write('a.ts', COMPLEX);
      await commitAll('introduce complexity'); // committed, HEAD now == working tree

      // Against HEAD there is no diff at all (working tree matches HEAD).
      expect(await collectFileChanges(dir)).toEqual([]);

      // Against the earlier base, the committed change is visible.
      const c = byPath(await collectFileChanges(dir, base), 'a.ts')!;
      expect(c.before).toBe(SIMPLE);
      expect(c.after).toBe(COMPLEX);
    });

    it('layers uncommitted working-tree edits on top of the committed base diff', async () => {
      await initRepo();
      await write('a.ts', SIMPLE);
      await commitAll('init');
      const base = await revParse('HEAD');

      await write('a.ts', COMPLEX);
      await commitAll('commit 2');
      await write('a.ts', COMPLEX + '// further uncommitted edit\n');

      const c = byPath(await collectFileChanges(dir, base), 'a.ts')!;
      expect(c.before).toBe(SIMPLE);
      expect(c.after).toContain('further uncommitted edit');
    });

    it('still reports untracked new files as added, regardless of base', async () => {
      await initRepo();
      await write('a.ts', SIMPLE);
      await commitAll('init');
      const base = await revParse('HEAD');
      await write('b.ts', COMPLEX); // untracked

      const c = byPath(await collectFileChanges(dir, base), 'b.ts')!;
      expect(c.before).toBeNull();
      expect(c.after).toBe(COMPLEX);
    });

    it('throws a clear error when the base ref does not resolve to a commit', async () => {
      await initRepo();
      await write('a.ts', SIMPLE);
      await commitAll('init');

      await expect(collectFileChanges(dir, 'does-not-exist-ref')).rejects.toThrow(
        /base ref "does-not-exist-ref" not found/,
      );
    });
  });

  describe('collectFileChange — single-file fast path (edit hook)', () => {
    it('builds before/after for a modified file (relative path)', async () => {
      await initRepo();
      await write('a.ts', SIMPLE);
      await commitAll('init');
      await write('a.ts', COMPLEX);

      const c = await collectFileChange(dir, 'a.ts');
      expect(c).not.toBeNull();
      expect(c!.filepath).toBe('a.ts');
      expect(c!.before).toBe(SIMPLE);
      expect(c!.after).toBe(COMPLEX);
    });

    it('accepts an absolute path (the shape Claude Code sends) and maps it repo-relative', async () => {
      await initRepo();
      await write('src/a.ts', SIMPLE);
      await commitAll('init');
      await write('src/a.ts', COMPLEX);

      const c = await collectFileChange(dir, path.join(dir, 'src/a.ts'));
      expect(c).not.toBeNull();
      expect(c!.filepath).toBe('src/a.ts');
      expect(c!.after).toBe(COMPLEX);
    });

    it('treats an untracked new file as added (before = null)', async () => {
      await initRepo();
      await write('a.ts', SIMPLE);
      await commitAll('init');
      await write('b.ts', COMPLEX);

      const c = await collectFileChange(dir, 'b.ts');
      expect(c!.before).toBeNull();
      expect(c!.after).toBe(COMPLEX);
    });

    it('handles a deleted file (after = null, before = HEAD)', async () => {
      await initRepo();
      await write('a.ts', COMPLEX);
      await commitAll('init');
      await fs.rm(path.join(dir, 'a.ts'));

      const c = await collectFileChange(dir, 'a.ts');
      expect(c!.before).toBe(COMPLEX);
      expect(c!.after).toBeNull();
    });

    it('returns null for an unsupported extension (non-code file → hook silent)', async () => {
      await initRepo();
      await write('notes.txt', 'hello');
      expect(await collectFileChange(dir, 'notes.txt')).toBeNull();
    });

    it('returns null for a path outside the repo', async () => {
      await initRepo();
      expect(await collectFileChange(dir, '/etc/hosts')).toBeNull();
    });

    it('returns null when the file exists on neither side', async () => {
      await initRepo();
      await write('a.ts', SIMPLE);
      await commitAll('init');
      expect(await collectFileChange(dir, 'ghost.ts')).toBeNull();
    });

    it('accepts the repo root through a symlinked ancestor, even for a deleted file in a deleted dir', async () => {
      // Regression (Phase-2 review finding #1): with a symlinked ANCESTOR of
      // the repo root, a target whose file AND parent dir no longer exist hits
      // canonicalize()'s identity fallback. Resolving against the raw rootDir
      // then left the symlinked prefix in place, and the lexical
      // path.relative(canonRoot, …) falsely escaped the repo → null.
      await initRepo();
      await write('sub/dir/a.ts', COMPLEX);
      await commitAll('init');
      await fs.rm(path.join(dir, 'sub'), { recursive: true }); // file AND parent dir gone

      // Symlink an ancestor: linkParent/repo → dir. dir is already realpath'd,
      // so every path through linkParent has a symlinked ancestor.
      const linkParent = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-delta-link-'));
      const linkedRoot = path.join(linkParent, 'repo');
      await fs.symlink(dir, linkedRoot);
      try {
        const c = await collectFileChange(linkedRoot, 'sub/dir/a.ts');
        expect(c).not.toBeNull();
        expect(c!.filepath).toBe('sub/dir/a.ts');
        expect(c!.before).toBe(COMPLEX);
        expect(c!.after).toBeNull(); // deleted
      } finally {
        await fs.rm(linkParent, { recursive: true, force: true });
      }
    });

    it('accepts a relative path when the repo root itself is reached via a symlink (file present)', async () => {
      await initRepo();
      await write('a.ts', SIMPLE);
      await commitAll('init');
      await write('a.ts', COMPLEX);

      const linkParent = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-delta-link-'));
      const linkedRoot = path.join(linkParent, 'repo');
      await fs.symlink(dir, linkedRoot);
      try {
        const c = await collectFileChange(linkedRoot, 'a.ts');
        expect(c).not.toBeNull();
        expect(c!.before).toBe(SIMPLE);
        expect(c!.after).toBe(COMPLEX);
      } finally {
        await fs.rm(linkParent, { recursive: true, force: true });
      }
    });

    describe('with baseRef', () => {
      async function revParse(ref: string): Promise<string> {
        const { stdout } = await execFileAsync('git', ['rev-parse', ref], { cwd: dir });
        return stdout.trim();
      }

      it('baseRef === HEAD matches the default (no baseRef)', async () => {
        await initRepo();
        await write('a.ts', SIMPLE);
        await commitAll('init');
        await write('a.ts', COMPLEX);

        const head = await revParse('HEAD');
        expect(await collectFileChange(dir, 'a.ts', head)).toEqual(
          await collectFileChange(dir, 'a.ts'),
        );
      });

      it('reads "before" from an earlier ref, seeing a since-committed change', async () => {
        await initRepo();
        await write('a.ts', SIMPLE);
        await commitAll('init');
        const base = await revParse('HEAD');
        await write('a.ts', COMPLEX);
        await commitAll('commit 2');

        const c = await collectFileChange(dir, 'a.ts', base);
        expect(c!.before).toBe(SIMPLE);
        expect(c!.after).toBe(COMPLEX);
      });

      it('throws a clear error when baseRef does not resolve to a commit', async () => {
        await initRepo();
        await write('a.ts', SIMPLE);
        await commitAll('init');

        await expect(collectFileChange(dir, 'a.ts', 'nope-not-a-ref')).rejects.toThrow(
          /base ref "nope-not-a-ref" not found/,
        );
      });
    });
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
