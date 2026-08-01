import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  findUnindexedPaths,
  formatUnindexedPathsNote,
  formatNoIndexNote,
} from './unindexed-paths.js';
import { createVectorDB, indexCodebase, type VectorDBInterface } from '@liendev/core';

/**
 * Single-backend-agnostic fake: `findUnindexedPaths` only ever calls
 * `getIndexedFiles()` on the backend it's handed, so these unit tests drive
 * that directly instead of mocking `ManifestManager` — the bug this file
 * guards against (#1014) was specifically that the OLD implementation read a
 * manifest keyed off `dbPath` that, for `OverlayBackend`, is only the
 * overlay's own (partial) manifest. The real base+overlay union behavior is
 * covered by the OverlayBackend-backed tests below and in
 * overlay-integration.test.ts.
 */
function makeVectorDB(getIndexedFiles: () => Promise<string[]>): VectorDBInterface {
  return { getIndexedFiles } as unknown as VectorDBInterface;
}

describe('findUnindexedPaths', () => {
  it('returns nothing when every requested path is in the manifest', async () => {
    const db = makeVectorDB(async () => ['Command/Command.php', 'Application.php']);
    const result = await findUnindexedPaths(db, ['Command/Command.php'], '/workspace');
    expect(result).toEqual([]);
  });

  it('reports a filepath with no manifest entry at all', async () => {
    const db = makeVectorDB(async () => ['Command/Command.php']);
    const result = await findUnindexedPaths(db, ['src/Command/Command.php'], '/workspace');
    expect(result).toEqual(['src/Command/Command.php']);
  });

  it('in a mixed batch, reports only the unindexed entries — a good path never masks a bad one', async () => {
    const db = makeVectorDB(async () => ['Command/Command.php']);
    const result = await findUnindexedPaths(
      db,
      ['Command/Command.php', 'does/not/exist.php'],
      '/workspace',
    );
    expect(result).toEqual(['does/not/exist.php']);
  });

  it('canonicalizes against the workspace root before comparing', async () => {
    const db = makeVectorDB(async () => ['Command/Command.php']);
    const result = await findUnindexedPaths(db, ['/workspace/Command/Command.php'], '/workspace');
    expect(result).toEqual([]);
  });

  it('fails open (reports nothing unindexed) when the backend read throws', async () => {
    const db = makeVectorDB(async () => {
      throw new Error('disk on fire');
    });
    const result = await findUnindexedPaths(db, ['Command/Command.php'], '/workspace');
    expect(result).toEqual([]);
  });

  it('fails open when getIndexedFiles is missing entirely (a stub that never set one)', async () => {
    const db = { dbPath: '/fake' } as unknown as VectorDBInterface;
    const result = await findUnindexedPaths(db, ['Command/Command.php'], '/workspace');
    expect(result).toEqual([]);
  });
});

const execFileAsync = promisify(execFile);
const git = (cwd: string, ...args: string[]) => execFileAsync('git', args, { cwd });

async function makeTmpDir(prefix: string): Promise<string> {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
}

async function rmDir(dir: string | undefined): Promise<void> {
  if (!dir) return;
  await fs.rm(dir, { recursive: true, force: true });
}

/**
 * #1014 regression: `findUnindexedPaths` run against a REAL `OverlayBackend`
 * (base + overlay, built through the public `createVectorDB`/`indexCodebase`
 * entry points — the same path a linked-worktree `lien serve` takes), not a
 * mock of `findUnindexedPaths` itself or of `ManifestManager`. The existing
 * handler tests (get-dependents.test.ts etc.) all mock `findUnindexedPaths`
 * wholesale, which is exactly why this class of bug shipped unnoticed: they
 * can't see what the function itself does with an overlay-backed store.
 */
describe('findUnindexedPaths against a real OverlayBackend (#1014)', () => {
  let mainRoot: string | undefined;
  let worktreeRoot: string | undefined;

  beforeEach(async () => {
    delete process.env.LIEN_WORKTREE_STANDALONE;

    mainRoot = await makeTmpDir('lien-1014-main-');
    await git(mainRoot, 'init', '-q', '-b', 'main');
    await git(mainRoot, 'config', 'user.email', 't@lien.dev');
    await git(mainRoot, 'config', 'user.name', 'Lien Test');
    await git(mainRoot, 'config', 'commit.gpgsign', 'false');
    await fs.writeFile(
      path.join(mainRoot, 'base-only.ts'),
      'export function baseOnlyFn() {\n  return 1;\n}\n',
    );
    await fs.writeFile(
      path.join(mainRoot, 'to-modify.ts'),
      'export function toModifyFn() {\n  return 2;\n}\n',
    );
    await fs.writeFile(
      path.join(mainRoot, 'to-delete.ts'),
      'export function toDeleteFn() {\n  return 3;\n}\n',
    );
    await git(mainRoot, 'add', '.');
    await git(mainRoot, 'commit', '-q', '-m', 'init');

    const mainIndexResult = await indexCodebase({ rootDir: mainRoot });
    expect(mainIndexResult.success).toBe(true);

    // git worktree add expects a path that does not exist yet.
    const wtPath = path.join(
      os.tmpdir(),
      `lien-1014-wt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    await git(mainRoot, 'worktree', 'add', '-q', wtPath, '-b', 'feature-1014');
    worktreeRoot = await fs.realpath(wtPath);

    // added.ts: only ever exists in the worktree/overlay.
    await fs.writeFile(
      path.join(worktreeRoot, 'added.ts'),
      'export function addedFn() {\n  return 4;\n}\n',
    );
    // to-modify.ts: diverges from base -> masked in base, chunked into overlay.
    await fs.writeFile(
      path.join(worktreeRoot, 'to-modify.ts'),
      'export function toModifyFnV2() {\n  return 999;\n}\n',
    );
    // to-delete.ts: removed from the worktree entirely -> masked, no overlay row.
    // Stage the removal (git add -A) so `git ls-files` (which the scanner's
    // tracked-file rescue reads) reflects the deletion too — otherwise the
    // rescue re-adds the still-tracked-but-now-missing path to the scan,
    // and diffing it against the base (unreadable content -> treated as
    // "diverged") crashes the chunk-read step with ENOENT.
    await fs.rm(path.join(worktreeRoot, 'to-delete.ts'));
    await git(worktreeRoot, 'add', '-A');

    const wtIndexResult = await indexCodebase({ rootDir: worktreeRoot });
    expect(wtIndexResult.success).toBe(true);
  });

  afterEach(async () => {
    delete process.env.LIEN_WORKTREE_STANDALONE;
    if (worktreeRoot)
      await git(mainRoot!, 'worktree', 'remove', '--force', worktreeRoot).catch(() => undefined);
    await rmDir(mainRoot);
    await rmDir(worktreeRoot);
  });

  it('confirms the worktree is actually backed by an overlay (sanity check on the test setup)', async () => {
    const wtDb = await createVectorDB(worktreeRoot!);
    expect(wtDb.isOverlay).toBe(true);
    (wtDb as unknown as { close?: () => void }).close?.();
  });

  it('does NOT report a base-only file as unindexed — this is the #1014 bug', async () => {
    const wtDb = await createVectorDB(worktreeRoot!);
    await wtDb.initialize();
    const result = await findUnindexedPaths(wtDb, ['base-only.ts'], worktreeRoot!);
    expect(result).toEqual([]);
    (wtDb as unknown as { close?: () => void }).close?.();
  });

  it('does not report an overlay-only (newly added) file as unindexed', async () => {
    const wtDb = await createVectorDB(worktreeRoot!);
    await wtDb.initialize();
    const result = await findUnindexedPaths(wtDb, ['added.ts'], worktreeRoot!);
    expect(result).toEqual([]);
    (wtDb as unknown as { close?: () => void }).close?.();
  });

  it('does not report a modified (masked-in-base, present-in-overlay) file as unindexed', async () => {
    const wtDb = await createVectorDB(worktreeRoot!);
    await wtDb.initialize();
    const result = await findUnindexedPaths(wtDb, ['to-modify.ts'], worktreeRoot!);
    expect(result).toEqual([]);
    (wtDb as unknown as { close?: () => void }).close?.();
  });

  it('reports a file deleted in this worktree (masked, no overlay replacement) as unindexed — it no longer exists here', async () => {
    const wtDb = await createVectorDB(worktreeRoot!);
    await wtDb.initialize();
    const result = await findUnindexedPaths(wtDb, ['to-delete.ts'], worktreeRoot!);
    expect(result).toEqual(['to-delete.ts']);
    (wtDb as unknown as { close?: () => void }).close?.();
  });

  it('still reports a genuinely nonexistent path as unindexed (does not lose the real #927/#951 signal)', async () => {
    const wtDb = await createVectorDB(worktreeRoot!);
    await wtDb.initialize();
    const result = await findUnindexedPaths(wtDb, ['NOPE-does-not-exist.ts'], worktreeRoot!);
    expect(result).toEqual(['NOPE-does-not-exist.ts']);
    (wtDb as unknown as { close?: () => void }).close?.();
  });

  it('in one mixed batch, reports only the deleted + nonexistent paths', async () => {
    const wtDb = await createVectorDB(worktreeRoot!);
    await wtDb.initialize();
    const result = await findUnindexedPaths(
      wtDb,
      ['base-only.ts', 'added.ts', 'to-modify.ts', 'to-delete.ts', 'NOPE-does-not-exist.ts'],
      worktreeRoot!,
    );
    expect(new Set(result)).toEqual(new Set(['to-delete.ts', 'NOPE-does-not-exist.ts']));
    (wtDb as unknown as { close?: () => void }).close?.();
  });
});

describe('formatUnindexedPathsNote', () => {
  it('returns undefined when nothing is unindexed', () => {
    expect(formatUnindexedPathsNote([])).toBeUndefined();
  });

  it('names every unindexed path and is unmissable (⚠ Lien: prefix)', () => {
    const note = formatUnindexedPathsNote(['src/Command/Command.php', 'does/not/exist.php']);
    expect(note).toContain('⚠ Lien:');
    expect(note).toContain('"src/Command/Command.php"');
    expect(note).toContain('"does/not/exist.php"');
  });
});

describe('formatNoIndexNote', () => {
  it('is unmissable (⚠ Lien: prefix) and states "no data" as an established fact, not a guess', () => {
    const note = formatNoIndexNote();
    expect(note).toContain('⚠ Lien:');
    expect(note).toContain('no data');
  });

  it('frames "lien index" as a correctness prerequisite, not a speed optimization', () => {
    const note = formatNoIndexNote();
    expect(note).toContain('lien index');
    expect(note).toContain('correctness prerequisite');
    expect(note).not.toContain('faster');
  });

  it('does not assert the symbol/pattern is absent from the code', () => {
    const note = formatNoIndexNote();
    expect(note).toMatch(/do not conclude/i);
  });
});
