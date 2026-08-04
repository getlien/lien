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
import Database from 'better-sqlite3';
import { getIndexDir } from '../utils/index-dir.js';
import { STRUCTURAL_DB_FILENAME } from './sqlite/schema.js';
import { OVERLAY_META } from './sqlite/overlay-schema.js';

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
    // `edited.ts` imports `shared.ts`, so the corpus has an import edge that
    // crosses the base/overlay boundary once the worktree diverges — the
    // discriminating fixture for dependent-count composition (#1071).
    await fs.writeFile(
      path.join(mainRoot, 'edited.ts'),
      "import { sharedFn } from './shared';\nexport function editedFn() {\n  return sharedFn() + 2;\n}\n",
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
      "import { sharedFn } from './shared';\nexport function editedFnV2() {\n  return sharedFn() + 999;\n}\n",
    );
    await fs.writeFile(
      path.join(worktreeRoot, 'added.ts'),
      "import { sharedFn } from './shared';\nexport function addedFn() {\n  return sharedFn() + 3;\n}\n",
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

  it('composes dependentCount over base ∪ overlay, not the overlay alone (#1071)', async () => {
    const result = await indexCodebase({ rootDir: worktreeRoot });
    expect(result.success).toBe(true);

    const wtDb = await createVectorDB(worktreeRoot);
    await wtDb.initialize();

    // `shared.ts` lives ONLY in the base. Both worktree files import it, so the
    // composed corpus gives it 2 dependents. The two ways to get this wrong are
    // exactly the #1050/#1051 shape:
    //   - counting the overlay alone: `shared.ts` has no overlay chunks at all,
    //     so it would be absent entirely (a bare 0 for the worktree's most
    //     depended-on file);
    //   - reading only the base's own stored counts: 1, from the pre-divergence
    //     `edited.ts`, missing `added.ts` which exists only in the worktree.
    // Only a pass over `(base − masked) ∪ overlay` yields 2.
    const hits = await wtDb.search('sharedFn', 10);
    const shared = hits.find(h => h.metadata.file === 'shared.ts');
    expect(shared).toBeDefined();
    expect(shared!.metadata.dependentCount).toBe(2);

    // And a base-served file's count is visible on the BASE connection's hits
    // too — the composed map is passed to both keywordSearch calls, so this
    // can't regress into "overlay rows get counts, base rows get 0".
    const added = hits.find(h => h.metadata.file === 'added.ts');
    expect(added?.metadata.dependentCount ?? 0).toBe(0); // nothing imports it
    close(wtDb);
  });

  it('survives a pre-#1071 base index that has no dependent_counts table at all', async () => {
    // Regression for a review finding on #1073: `openBase()` opens the shared
    // base store `{ readonly: true }`, so `openDatabase`'s
    // `CREATE TABLE IF NOT EXISTS` never runs against it. A base index written
    // by a version that predates the table therefore genuinely does not have
    // it, and an unguarded read throws `SQLITE_ERROR: no such table`, crashing
    // every overlay search rather than degrading to "no base counts".
    await indexCodebase({ rootDir: worktreeRoot });

    // Simulate the pre-#1071 base by dropping the table from the base store.
    const baseIndexDir = getIndexDir(mainRoot);
    const baseDb = new Database(path.join(baseIndexDir, STRUCTURAL_DB_FILENAME));
    baseDb.exec('DROP TABLE IF EXISTS dependent_counts');
    baseDb.close();

    const wtDb = await createVectorDB(worktreeRoot);
    await wtDb.initialize();
    const hits = await wtDb.search('sharedFn', 10);
    expect(hits.length).toBeGreaterThan(0);
    // The overlay's own composed table still has the answer, so this is not a
    // degradation in practice — the point is that it does not throw.
    expect(hits.find(h => h.metadata.file === 'shared.ts')?.metadata.dependentCount).toBe(2);
    close(wtDb);
  });

  it('does not resurrect a stale base count when the worktree masks the last importer', async () => {
    // Review finding on #1073. A zero is stored as the ABSENCE of a row, so
    // merging the base map under the overlay map cannot express "this dropped to
    // 0 here": the base's stale positive value survives the merge. Repro: the
    // base has `edited.ts` importing `shared.ts` (count 1); the worktree rewrites
    // `edited.ts` to import nothing and deletes `added.ts`, so nothing imports
    // `shared.ts` any more and its composed count is 0 — with no overlay row to
    // override the base's 1 with.
    await fs.writeFile(
      path.join(worktreeRoot, 'edited.ts'),
      'export function editedFnV2() {\n  return 999;\n}\n',
    );
    await fs.rm(path.join(worktreeRoot, 'added.ts'));

    const result = await indexCodebase({ rootDir: worktreeRoot });
    expect(result.success).toBe(true);

    const wtDb = await createVectorDB(worktreeRoot);
    await wtDb.initialize();
    const hits = await wtDb.search('sharedFn', 10);
    const shared = hits.find(h => h.metadata.file === 'shared.ts');
    expect(shared).toBeDefined();
    expect(shared!.metadata.dependentCount ?? 0).toBe(0);
    close(wtDb);
  });

  it('reports hasDependentCounts()=true once the overlay has composed counts (#1072)', async () => {
    await indexCodebase({ rootDir: worktreeRoot });

    const wtDb = await createVectorDB(worktreeRoot);
    await wtDb.initialize();
    expect(await wtDb.hasDependentCounts()).toBe(true);
    close(wtDb);
  });

  it('reports hasDependentCounts()=false for an overlay with neither composed counts nor a base to fall back on (#1072)', async () => {
    // The state search_code must be able to name: nothing computed anywhere, so
    // every dependentCount would read 0 for a reason that has nothing to do
    // with the code. Reproduced by clearing the overlay's composed flag AND
    // both stores' count tables — i.e. an index written before the table
    // existed at all.
    await indexCodebase({ rootDir: worktreeRoot });

    const overlayDb = new Database(path.join(getIndexDir(worktreeRoot), STRUCTURAL_DB_FILENAME));
    overlayDb.exec('DELETE FROM dependent_counts');
    // `overlay_meta` exists only on the overlay store, never on a standalone one.
    overlayDb.exec(
      `DELETE FROM overlay_meta WHERE k = '${OVERLAY_META.DEPENDENT_COUNTS_COMPOSED}'`,
    );
    overlayDb.close();

    const baseDb = new Database(path.join(getIndexDir(mainRoot), STRUCTURAL_DB_FILENAME));
    baseDb.exec('DELETE FROM dependent_counts');
    baseDb.close();

    const wtDb = await createVectorDB(worktreeRoot);
    await wtDb.initialize();
    expect(await wtDb.hasDependentCounts()).toBe(false);
    close(wtDb);
  });

  it('honors the LIEN_WORKTREE_STANDALONE escape hatch through the factory', async () => {
    process.env.LIEN_WORKTREE_STANDALONE = '1';
    const wtDb = await createVectorDB(worktreeRoot);
    expect(wtDb.isOverlay).toBe(false);
    close(wtDb);
  });
});
