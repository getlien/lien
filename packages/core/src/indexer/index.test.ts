import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import Database from 'better-sqlite3';
import { indexCodebase } from './index.js';
import { createVectorDB } from '../vectordb/factory.js';
import { ManifestManager } from './manifest.js';
import { getIndexDir } from '../utils/index-dir.js';
import { STRUCTURAL_DB_FILENAME } from '../vectordb/sqlite/schema.js';
import {
  createTestDir,
  cleanupTestDir,
  createTestFile,
  simulatePreCountTrackingIndex,
} from '../test/helpers/test-db.js';
import { MAX_INDEXABLE_FILE_SIZE_BYTES } from '../constants.js';

const MATH_TS = `export function add(a: number, b: number): number {
  return a + b;
}
`;

const MAIN_TS = `import { add } from './math.js';

export function sumAll(values: number[]): number {
  return values.reduce((total, v) => add(total, v), 0);
}
`;

describe('indexCodebase (lexical FTS5 structural index)', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
    await createTestFile(testDir, 'src/math.ts', MATH_TS);
    await createTestFile(testDir, 'src/main.ts', MAIN_TS);
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it('indexes successfully and creates chunks', async () => {
    const result = await indexCodebase({ rootDir: testDir, force: true });

    expect(result.success).toBe(true);
    expect(result.chunksCreated).toBeGreaterThan(0);
  });

  it('records the source root in the manifest (GC provenance)', async () => {
    await indexCodebase({ rootDir: testDir, force: true });

    const db = await createVectorDB(testDir);
    const manifestPath = path.join(db.dbPath, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));

    expect(manifest.sourceRoot).toBe(path.resolve(testDir));
  });

  it('persists chunks with real structural metadata (imports/exports/symbolName)', async () => {
    const result = await indexCodebase({ rootDir: testDir, force: true });
    expect(result.success).toBe(true);

    // Read back through the configured backend (sqlite by default).
    const db = await createVectorDB(testDir);
    await db.initialize();
    const rows = await db.scanAll();

    // A file produces multiple chunks (e.g. an import-header chunk plus
    // one per function) — find the one carrying the function's symbol.
    const mainChunk = rows.find(
      r => r.metadata.file.endsWith('main.ts') && r.metadata.symbolName === 'sumAll',
    );
    expect(mainChunk).toBeDefined();
    expect(mainChunk!.metadata.imports).toContain('src/math.js');
    expect(mainChunk!.metadata.exports).toContain('sumAll');

    const mathChunk = rows.find(
      r => r.metadata.file.endsWith('math.ts') && r.metadata.symbolName === 'add',
    );
    expect(mathChunk).toBeDefined();
    expect(mathChunk!.metadata.exports).toContain('add');
  });

  it('does not block indexing on a malformed project config', async () => {
    await fs.writeFile(path.join(testDir, '.lien.config.json'), '{ not valid json');

    const result = await indexCodebase({ rootDir: testDir, force: true });

    expect(result.success).toBe(true);
    expect(result.chunksCreated).toBeGreaterThan(0);
  });

  describe('dependent-count migration backfill (#1084)', () => {
    const closeDb = (db: unknown) => (db as { close?: () => void }).close?.();

    /** Rewind to a store whose counts were never computed, as ≤ 0.75.2 wrote it. */
    async function rewindToPreCountTracking(): Promise<void> {
      simulatePreCountTrackingIndex(getIndexDir(testDir));
      const db = await createVectorDB(testDir);
      await db.initialize();
      expect(await db.hasDependentCounts()).toBe(false);
      closeDb(db);
    }

    async function countsState(): Promise<{ computed: boolean; mathCount: number | undefined }> {
      const db = await createVectorDB(testDir);
      await db.initialize();
      const computed = await db.hasDependentCounts();
      const hits = await db.search('add', 10);
      const mathCount = hits.find(h => h.metadata.file.endsWith('math.ts'))?.metadata
        .dependentCount;
      closeDb(db);
      return { computed, mathCount };
    }

    function deleteDependentCountRow(file: string): void {
      const raw = new Database(path.join(getIndexDir(testDir), STRUCTURAL_DB_FILENAME));
      raw.prepare('DELETE FROM dependent_counts WHERE file = ?').run(file);
      raw.close();
    }

    it('a plain `lien index` with NO changes completes it — the exact path that was stuck', async () => {
      // #1084 verbatim: index with a version predating `dependent_counts`,
      // upgrade, then run the command #1072's note prints. Before this fix the
      // "Index is up to date - no changes detected" fast path returned without
      // writing either the counts or the flag, so the note kept firing forever
      // and only `--force` cleared it. A caveat whose prescribed remedy does
      // nothing spends the reader's trust on a failed instruction.
      await indexCodebase({ rootDir: testDir, force: true });
      await rewindToPreCountTracking();

      const again = await indexCodebase({ rootDir: testDir });
      expect(again.success).toBe(true);
      expect(again.filesIndexed).toBe(0); // nothing changed — the stuck path

      const after = await countsState();
      expect(after.computed).toBe(true);
      // `main.ts` imports `math.ts`, so a real computation is the only way here.
      expect(after.mathCount).toBe(1);
    });

    it('runs at most once — a second no-op index does not recompute', async () => {
      // It is a migration, not an indexing step. #1071's freshness contract
      // (counts lag by at most one full index run, because recomputing
      // whole-corpus counts on every incremental save would be absurd for a soft
      // ranking tie-breaker) has to survive this fix, so the gate is the stored
      // flag and the second run must be a single meta lookup.
      await indexCodebase({ rootDir: testDir, force: true });
      await rewindToPreCountTracking();
      await indexCodebase({ rootDir: testDir });

      // Delete a row WITHOUT clearing the flag: if the backfill re-ran on state
      // it should not consult, the row would come back.
      deleteDependentCountRow('src/math.ts');

      await indexCodebase({ rootDir: testDir });

      const after = await countsState();
      expect(after.computed).toBe(true);
      expect(after.mathCount ?? 0).toBe(0); // still deleted — no recompute
    });
  });

  it('reports failure without throwing when the directory has no indexable files', async () => {
    const emptyDir = await createTestDir();
    try {
      const result = await indexCodebase({ rootDir: emptyDir, force: true });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    } finally {
      await cleanupTestDir(emptyDir);
    }
  });

  it('skips an oversized file instead of chunking it, but still indexes the rest (#1025)', async () => {
    const hugePath = await createTestFile(
      testDir,
      'src/huge.ts',
      'x'.repeat(MAX_INDEXABLE_FILE_SIZE_BYTES + 1),
    );

    // Proves the size check runs before any content read on the full-index
    // path too -- not just that the result ends up empty.
    const readFileSpy = vi.spyOn(fs, 'readFile');
    const result = await indexCodebase({ rootDir: testDir, force: true });
    expect(readFileSpy.mock.calls.some(call => call[0] === hugePath)).toBe(false);
    readFileSpy.mockRestore();

    expect(result.success).toBe(true);
    expect(result.chunksCreated).toBeGreaterThan(0);

    const db = await createVectorDB(testDir);
    await db.initialize();
    const rows = await db.scanAll();

    expect(rows.some(r => r.metadata.file.endsWith('main.ts'))).toBe(true);
    expect(rows.some(r => r.metadata.file.endsWith('huge.ts'))).toBe(false);

    // Recorded in the manifest with chunkCount: 0 -- not silently absent --
    // so the very next incremental run doesn't see it as "new" and retry it.
    const manifest = await new ManifestManager(db.dbPath).load();
    expect(manifest?.files['src/huge.ts']?.chunkCount).toBe(0);
  });
});
