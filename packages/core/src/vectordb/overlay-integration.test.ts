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

  it('reports hasDependentCounts()=true on a FRESH worktree whose base has counts, and serves them (#1085)', async () => {
    // The defect, exactly as dogfooded: a linked worktree that has never
    // completed its own `lien index` has an empty overlay and no composed flag,
    // so keying the honesty answer on the overlay alone reported "the counts
    // were never computed here" — while `composedDependentCounts` handed the
    // base's counts straight to the ranking in the same call. The note and the
    // ordering cannot both be right.
    //
    // No `indexCodebase({ rootDir: worktreeRoot })` here on purpose: the whole
    // point is the state BEFORE the worktree's first local index.
    const wtDb = await createVectorDB(worktreeRoot);
    await wtDb.initialize();
    expect(wtDb.isOverlay).toBe(true);

    // Preconditions: the overlay genuinely has no composed counts...
    const overlayProbe = new Database(
      path.join(getIndexDir(worktreeRoot), STRUCTURAL_DB_FILENAME),
      { readonly: true },
    );
    expect(
      (overlayProbe.prepare('SELECT count(*) c FROM dependent_counts').get() as { c: number }).c,
    ).toBe(0);
    expect(
      overlayProbe
        .prepare('SELECT v FROM overlay_meta WHERE k = ?')
        .get(OVERLAY_META.DEPENDENT_COUNTS_COMPOSED),
    ).toBeUndefined();
    overlayProbe.close();
    // ...and the base genuinely does.
    expect(await wtDb.hasDependentCounts()).toBe(true);

    // And the numbers it is honest about are really there: `shared.ts` carries
    // the base's real count, not an omission.
    const hits = await wtDb.search('sharedFn', 10);
    expect(hits.find(h => h.metadata.file === 'shared.ts')?.metadata.dependentCount).toBe(1);
    close(wtDb);
  });

  it('reports hasDependentCounts()=false when NEITHER the overlay nor the base ever computed them (#1085 negative control)', async () => {
    // The row whose absence let #1085 ship. Over-correcting into silence would
    // be the other failure: #1072's note exists for a genuinely never-computed
    // store, and it must still fire for one. Both stores are rewound here, so
    // there is no composition anywhere that could answer.
    await indexCodebase({ rootDir: worktreeRoot });

    const overlayDb = new Database(path.join(getIndexDir(worktreeRoot), STRUCTURAL_DB_FILENAME));
    overlayDb.exec('DELETE FROM dependent_counts');
    overlayDb
      .prepare('DELETE FROM overlay_meta WHERE k = ?')
      .run(OVERLAY_META.DEPENDENT_COUNTS_COMPOSED);
    overlayDb.close();

    // A base written before either table existed — `openBase()` opens it
    // `{ readonly: true }`, so nothing recreates them behind our back.
    const baseDb = new Database(path.join(getIndexDir(mainRoot), STRUCTURAL_DB_FILENAME));
    baseDb.exec('DROP TABLE IF EXISTS dependent_counts');
    baseDb.exec('DROP TABLE IF EXISTS store_meta');
    baseDb.close();

    const wtDb = await createVectorDB(worktreeRoot);
    await wtDb.initialize();
    expect(await wtDb.hasDependentCounts()).toBe(false);
    close(wtDb);
  });

  it('reports hasDependentCounts()=true from a base that has ROWS but no flag — a 0.75.4 base (#1085)', async () => {
    // 0.75.4 shipped `dependent_counts` (#1071); 0.75.5 added `store_meta`
    // (#1072). A base written by 0.75.4 therefore has real rows and no
    // `store_meta` TABLE AT ALL, and the base connection is read-only so nothing
    // creates it. Both clauses of `hasComputedDependentCounts` must degrade
    // independently: a missing flag table cannot be allowed to hide the rows
    // that prove a computation ran.
    const baseDb = new Database(path.join(getIndexDir(mainRoot), STRUCTURAL_DB_FILENAME));
    baseDb.exec('DROP TABLE IF EXISTS store_meta');
    const baseRows = baseDb.prepare('SELECT count(*) c FROM dependent_counts').get() as {
      c: number;
    };
    baseDb.close();
    expect(baseRows.c).toBeGreaterThan(0);

    const wtDb = await createVectorDB(worktreeRoot);
    await wtDb.initialize();
    expect(await wtDb.hasDependentCounts()).toBe(true);
    close(wtDb);
  });

  it('a stale base count the worktree masked is served as stale, not suppressed as "never computed" (#1085)', async () => {
    // The hazard review raised on #1078, with the disposition #1085 corrects.
    //
    // A zero is stored as the ABSENCE of a row, so merging the base map under an
    // un-composed overlay cannot express "this dropped to 0 here": the base's
    // stale 1 survives. That is real, and it is why `composedDependentCounts`
    // stops merging the moment the overlay has its own composed map.
    //
    // What it is NOT is grounds for the never-computed note. Reporting `false`
    // did not stop the stale number reaching the ranking — `search()` had
    // already applied it — it only added a false claim about the store and threw
    // away every OTHER count in the response. A count that lags the worktree is
    // #1072's case 4: documented on the field, deliberately uncaveated, cleared
    // by the worktree's own `lien index`.
    //
    // Fixture: base has `edited.ts` importing `shared.ts` (count 1); the
    // worktree rewrites `edited.ts` to import nothing and deletes `added.ts`, so
    // `shared.ts`'s true composed count is 0.
    await fs.writeFile(
      path.join(worktreeRoot, 'edited.ts'),
      'export function editedFnV2() {\n  return 999;\n}\n',
    );
    await fs.rm(path.join(worktreeRoot, 'added.ts'));
    await indexCodebase({ rootDir: worktreeRoot });

    const overlayDb = new Database(path.join(getIndexDir(worktreeRoot), STRUCTURAL_DB_FILENAME));
    overlayDb.exec('DELETE FROM dependent_counts');
    overlayDb
      .prepare('DELETE FROM overlay_meta WHERE k = ?')
      .run(OVERLAY_META.DEPENDENT_COUNTS_COMPOSED);
    overlayDb.close();

    const baseDb = new Database(path.join(getIndexDir(mainRoot), STRUCTURAL_DB_FILENAME));
    const baseCount = baseDb
      .prepare('SELECT count FROM dependent_counts WHERE file = ?')
      .get('shared.ts') as { count: number } | undefined;
    baseDb.close();
    expect(baseCount?.count).toBe(1);

    const wtDb = await createVectorDB(worktreeRoot);
    await wtDb.initialize();
    // Honest about having counts...
    expect(await wtDb.hasDependentCounts()).toBe(true);
    // ...and the resurrected 1 is exactly what the read path was serving all
    // along, with or without this method's answer.
    const hits = await wtDb.search('sharedFn', 10);
    expect(hits.find(h => h.metadata.file === 'shared.ts')?.metadata.dependentCount).toBe(1);
    close(wtDb);

    // And one `lien index` in the worktree replaces it with the true 0 — the
    // staleness has a remedy, which is what makes leaving it uncaveated honest.
    await indexCodebase({ rootDir: worktreeRoot });
    const refreshed = await createVectorDB(worktreeRoot);
    await refreshed.initialize();
    const after = await refreshed.search('sharedFn', 10);
    expect(after.find(h => h.metadata.file === 'shared.ts')?.metadata.dependentCount ?? 0).toBe(0);
    close(refreshed);
  });

  it('completes the dependent-count migration on a plain `lien index` with no content changes (#1084)', async () => {
    // The upgrade path that produced #1072's note is the one where nothing
    // changed: `lien index` reported "Index is up to date" and returned, so the
    // note's own instruction did nothing and only `--force` worked. The counts
    // are now a migration the next `lien index` completes regardless.
    await indexCodebase({ rootDir: worktreeRoot });

    const overlayPath = path.join(getIndexDir(worktreeRoot), STRUCTURAL_DB_FILENAME);
    const rewound = new Database(overlayPath);
    rewound.exec('DELETE FROM dependent_counts');
    rewound
      .prepare('DELETE FROM overlay_meta WHERE k = ?')
      .run(OVERLAY_META.DEPENDENT_COUNTS_COMPOSED);
    rewound.close();

    // Byte-identical corpus — the swap reports `changed: false`, which is exactly
    // why `changed` alone was not a sufficient trigger for the refresh.
    const again = await indexCodebase({ rootDir: worktreeRoot });
    expect(again.success).toBe(true);

    const wtDb = await createVectorDB(worktreeRoot);
    await wtDb.initialize();
    expect(await wtDb.hasDependentCounts()).toBe(true);
    const hits = await wtDb.search('sharedFn', 10);
    expect(hits.find(h => h.metadata.file === 'shared.ts')?.metadata.dependentCount).toBe(2);
    close(wtDb);
  });

  it('honors the LIEN_WORKTREE_STANDALONE escape hatch through the factory', async () => {
    process.env.LIEN_WORKTREE_STANDALONE = '1';
    const wtDb = await createVectorDB(worktreeRoot);
    expect(wtDb.isOverlay).toBe(false);
    close(wtDb);
  });
});
