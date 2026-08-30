import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { getIndexDir } from '@liendev/core';
import { VERSION_FILE } from '@liendev/core';
import { resolveRepoRoot, resolveProjectRoot } from './project-root.js';

describe('resolveProjectRoot', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-root-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('walks upward to find a .git directory', async () => {
    const root = await fs.realpath(tmp);
    await fs.mkdir(path.join(root, '.git'));
    const deep = path.join(root, 'a', 'b', 'c');
    await fs.mkdir(deep, { recursive: true });
    expect(resolveProjectRoot(deep)).toBe(root);
  });

  it('recognizes .git as a file (git worktrees)', async () => {
    const root = await fs.realpath(tmp);
    await fs.writeFile(path.join(root, '.git'), 'gitdir: /elsewhere\n');
    const deep = path.join(root, 'sub');
    await fs.mkdir(deep);
    expect(resolveProjectRoot(deep)).toBe(root);
  });

  it('falls back to the start path when no marker exists', async () => {
    const root = await fs.realpath(tmp);
    expect(resolveProjectRoot(root)).toBe(root);
  });

  it('returns the start path itself when it contains the marker', async () => {
    const root = await fs.realpath(tmp);
    await fs.mkdir(path.join(root, '.git'));
    expect(resolveProjectRoot(root)).toBe(root);
  });

  // #894: git-repo-nested-in-git-tree / monorepo-subdirectory-without-its-
  // own-.git. `lien index` was run against a subdirectory that has no `.git`
  // of its own but sits inside an unrelated outer `.git` checkout. A read-side
  // command (annotate, gc, path, ...) invoked from inside that subdirectory
  // must resolve back to it — not walk straight past it to the outer `.git`,
  // which was never indexed.
  describe('#894: nested-git-repo-in-git-tree / repo-less indexed subdirectory', () => {
    let originalLienHome: string | undefined;
    let lienHome: string;

    beforeEach(async () => {
      originalLienHome = process.env.LIEN_HOME;
      lienHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-home-'));
      process.env.LIEN_HOME = lienHome;
    });

    afterEach(async () => {
      if (originalLienHome === undefined) delete process.env.LIEN_HOME;
      else process.env.LIEN_HOME = originalLienHome;
      await fs.rm(lienHome, { recursive: true, force: true });
    });

    /** Stand in for a completed `lien index`/overlay build against `projectRoot`. */
    async function markIndexed(projectRoot: string): Promise<void> {
      const indexDir = getIndexDir(projectRoot);
      await fs.mkdir(indexDir, { recursive: true });
      await fs.writeFile(path.join(indexDir, VERSION_FILE), String(Date.now()));
    }

    it('prefers a completed index on a repo-less subdirectory over an outer .git', async () => {
      const outerRoot = await fs.realpath(tmp);
      await fs.mkdir(path.join(outerRoot, '.git'));
      const innerProject = path.join(outerRoot, 'vendor', 'assertj-core');
      await fs.mkdir(innerProject, { recursive: true });
      await markIndexed(innerProject);

      // Invoked from a subdirectory of the indexed (but git-less) project —
      // the exact #894 repro shape.
      const cwd = path.join(innerProject, 'src', 'main');
      await fs.mkdir(cwd, { recursive: true });

      expect(resolveProjectRoot(cwd)).toBe(innerProject);
    });

    it('still finds the completed index when invoked from the project root itself', async () => {
      const outerRoot = await fs.realpath(tmp);
      await fs.mkdir(path.join(outerRoot, '.git'));
      const innerProject = path.join(outerRoot, 'vendor', 'assertj-core');
      await fs.mkdir(innerProject, { recursive: true });
      await markIndexed(innerProject);

      expect(resolveProjectRoot(innerProject)).toBe(innerProject);
    });

    it('falls back to the outer .git when nothing has been indexed yet (ambiguous case, unchanged from before)', async () => {
      const outerRoot = await fs.realpath(tmp);
      await fs.mkdir(path.join(outerRoot, '.git'));
      const innerProject = path.join(outerRoot, 'vendor', 'assertj-core');
      await fs.mkdir(innerProject, { recursive: true });
      // No markIndexed() call — nothing indexed anywhere yet.

      expect(resolveProjectRoot(innerProject)).toBe(outerRoot);
    });

    // Dogfooding this very fix surfaced this exact shape: this repo carries a
    // checked-in, vestigial packages/cli/.lien.config.json (pre-monorepo
    // history) that isn't an active project root. An earlier version of this
    // fix used ".lien.config.json presence" as the "initialized project"
    // signal and that file hijacked resolution away from the real repo root.
    // A config file alone — with no completed index behind it — must NOT win;
    // only a real, completed index does.
    it('does not let a bare .lien.config.json (no completed index) hijack resolution', async () => {
      const outerRoot = await fs.realpath(tmp);
      await fs.mkdir(path.join(outerRoot, '.git'));
      const staleConfigDir = path.join(outerRoot, 'packages', 'cli');
      await fs.mkdir(staleConfigDir, { recursive: true });
      await fs.writeFile(path.join(staleConfigDir, '.lien.config.json'), '{}');

      const cwd = path.join(staleConfigDir, 'src');
      await fs.mkdir(cwd, { recursive: true });

      expect(resolveProjectRoot(cwd)).toBe(outerRoot);
    });

    // Linked-worktree shape (docs/architecture/worktree-aware-indexing.md):
    // a Claude Code agent worktree lives on disk *inside* the main checkout
    // (e.g. `<main>/.claude/worktrees/<name>`), so the main repo's `.git`
    // directory is a filesystem ancestor of the worktree root — the same
    // "outer .git" topology #894 is about. A worktree root has its own `.git`
    // *file* (not dir) and, once its overlay has been built at least once,
    // its own completed index (`OverlayBackend` keys `dbPath`/`VERSION_FILE`
    // off the worktree's own path exactly like a standalone `SqliteBackend`
    // — see the module doc comment). Resolution must stop at the worktree
    // root, never walk past it to the main checkout.
    it('resolves to a linked worktree root, not the outer main-checkout .git it sits inside', async () => {
      const mainCheckout = await fs.realpath(tmp);
      await fs.mkdir(path.join(mainCheckout, '.git'));
      const worktreeRoot = path.join(mainCheckout, '.claude', 'worktrees', 'agent-123');
      await fs.mkdir(worktreeRoot, { recursive: true });
      await fs.writeFile(
        path.join(worktreeRoot, '.git'),
        `gitdir: ${path.join(mainCheckout, '.git', 'worktrees', 'agent-123')}\n`,
      );
      await markIndexed(worktreeRoot); // simulates a completed overlay build

      const cwd = path.join(worktreeRoot, 'packages', 'cli', 'src');
      await fs.mkdir(cwd, { recursive: true });

      expect(resolveProjectRoot(cwd)).toBe(worktreeRoot);
    });

    // #1050: the shape above ("resolves to a linked worktree root...") only
    // covered a worktree that had ALREADY completed its own overlay build
    // (`markIndexed(worktreeRoot)`). The actual bug is the FRESH worktree —
    // no local overlay build yet, so `hasCompletedIndex(worktreeRoot)` is
    // false — sitting inside a main checkout that DOES have a completed
    // index. The old two-separate-passes implementation ran the completed-
    // index walk fully unbounded, so it walked straight past the worktree's
    // own `.git` file to the main checkout's completed index, silently
    // resolving every annotate/gc/path/etc. call to the WRONG repository.
    it('#1050: resolves to the fresh worktree root, not the main checkout, even though only the main checkout has a completed index', async () => {
      const mainCheckout = await fs.realpath(tmp);
      await fs.mkdir(path.join(mainCheckout, '.git'));
      await markIndexed(mainCheckout); // the main checkout HAS a completed index...

      const worktreeRoot = path.join(mainCheckout, '.claude', 'worktrees', 'agent-fresh');
      await fs.mkdir(worktreeRoot, { recursive: true });
      await fs.writeFile(
        path.join(worktreeRoot, '.git'),
        `gitdir: ${path.join(mainCheckout, '.git', 'worktrees', 'agent-fresh')}\n`,
      );
      // ...but the worktree itself does NOT — no markIndexed(worktreeRoot)
      // call. This is the "fresh, not-yet-locally-indexed" state #1050 is
      // about.

      const cwd = path.join(worktreeRoot, 'packages', 'cli', 'src');
      await fs.mkdir(cwd, { recursive: true });

      expect(resolveProjectRoot(cwd)).toBe(worktreeRoot);
    });
  });
});

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

  it('returns the directory itself when it is the root', async () => {
    await fs.mkdir(path.join(dir, '.git'), { recursive: true });
    expect(resolveRepoRoot(dir)).toBe(dir);
  });

  it('falls back to the start directory when there is no marker anywhere', async () => {
    // Non-repo directories must keep working rather than walking to /.
    expect(resolveRepoRoot(dir)).toBe(dir);
  });

  it('ignores a completed index, unlike resolveProjectRoot', async () => {
    // The whole point: commands that parse the working tree must not consult
    // the store to decide where to look. A `.git` further up wins over an
    // indexed subdirectory.
    await fs.mkdir(path.join(dir, '.git'), { recursive: true });
    const nested = path.join(dir, 'sub');
    await fs.mkdir(nested, { recursive: true });

    expect(resolveRepoRoot(nested)).toBe(dir);
  });
});
