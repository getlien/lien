import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createTestDir, cleanupTestDir } from '../test/helpers/test-db.js';
import { indexCodebase } from '../indexer/index.js';
import { createVectorDB } from './factory.js';
import { _resetWarnMemo } from './overlay-resolution.js';
import type { VectorDBInterface } from './types.js';

const execFileAsync = promisify(execFile);
const git = (cwd: string, ...args: string[]) => execFileAsync('git', args, { cwd });

/** File set covered by scanAll on a freshly-opened backend. */
async function unionFiles(db: VectorDBInterface): Promise<Set<string>> {
  const results = await db.scanAll();
  return new Set(results.map(r => r.metadata.file));
}

function close(db: VectorDBInterface): void {
  (db as unknown as { close?: () => void }).close?.();
}

/**
 * Full-chain integration: a real `git worktree add`, driven through the public
 * factory + indexer (not by constructing OverlayBackend directly).
 */
describe('worktree-aware indexing (integration)', () => {
  let mainRoot: string;
  let worktreeRoot: string;

  beforeEach(async () => {
    _resetWarnMemo();
    delete process.env.LIEN_WORKTREE_STANDALONE;

    // realpath so git's canonical worktree path matches the path main is
    // indexed under (macOS /var -> /private/var).
    mainRoot = await fs.realpath(await createTestDir());
    await git(mainRoot, 'init', '-q', '-b', 'main');
    await git(mainRoot, 'config', 'user.email', 't@lien.dev');
    await git(mainRoot, 'config', 'user.name', 'Lien Test');
    await git(mainRoot, 'config', 'commit.gpgsign', 'false');
    await fs.writeFile(
      path.join(mainRoot, 'shared.ts'),
      'export function sharedFn() {\n  return 1;\n}\n',
    );
    await fs.writeFile(
      path.join(mainRoot, 'edited.ts'),
      'export function editedFn() {\n  return 2;\n}\n',
    );
    await git(mainRoot, 'add', '.');
    await git(mainRoot, 'commit', '-q', '-m', 'init');

    // Index the main checkout (standalone).
    const r = await indexCodebase({ rootDir: mainRoot });
    expect(r.success).toBe(true);

    // Linked worktree that diverges: edit edited.ts, delete nothing, add added.ts.
    worktreeRoot = await fs.realpath(
      await (async () => {
        const wt = path.join(
          mainRoot,
          '..',
          `wt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        );
        await git(mainRoot, 'worktree', 'add', '-q', wt, '-b', 'feature');
        return wt;
      })(),
    );
    await fs.writeFile(
      path.join(worktreeRoot, 'edited.ts'),
      'export function editedFnV2() {\n  return 999;\n}\n',
    );
    await fs.writeFile(
      path.join(worktreeRoot, 'added.ts'),
      'export function addedFn() {\n  return 3;\n}\n',
    );
  });

  afterEach(async () => {
    delete process.env.LIEN_WORKTREE_STANDALONE;
    await cleanupTestDir(mainRoot);
    await cleanupTestDir(worktreeRoot);
  });

  it('the factory backs the worktree with an overlay and the main checkout without one', async () => {
    const mainDb = await createVectorDB(mainRoot);
    const wtDb = await createVectorDB(worktreeRoot);
    expect(mainDb.isOverlay).toBe(false);
    expect(wtDb.isOverlay).toBe(true);
    close(mainDb);
    close(wtDb);
  });

  it('indexes only diverged files, then reads base ∪ overlay with divergence applied', async () => {
    const result = await indexCodebase({ rootDir: worktreeRoot });
    expect(result.success).toBe(true);
    // edited (modified) + added — shared.ts is served from the base.
    expect(result.filesIndexed).toBe(2);

    const wtDb = await createVectorDB(worktreeRoot);
    await wtDb.initialize();
    const files = await unionFiles(wtDb);
    expect(files).toEqual(new Set(['shared.ts', 'edited.ts', 'added.ts']));

    const edited = (await wtDb.scanWithFilter({ file: 'edited.ts' })).map(r => r.content).join('');
    expect(edited).toContain('999'); // worktree content
    expect(edited).not.toContain('return 2;'); // base row masked

    const shared = (await wtDb.scanWithFilter({ file: 'shared.ts' })).map(r => r.content).join('');
    expect(shared).toContain('sharedFn'); // served from the shared base
    close(wtDb);
  });

  it('honors the LIEN_WORKTREE_STANDALONE escape hatch through the factory', async () => {
    process.env.LIEN_WORKTREE_STANDALONE = '1';
    const wtDb = await createVectorDB(worktreeRoot);
    expect(wtDb.isOverlay).toBe(false);
    close(wtDb);
  });
});
