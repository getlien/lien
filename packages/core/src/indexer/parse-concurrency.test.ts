import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { getIndexDir } from '@liendev/parser';
import { createTestDir, cleanupTestDir, createTestFile } from '../test/helpers/test-db.js';
import { indexCodebase } from './index.js';
import { indexMultipleFiles } from './incremental.js';
import { buildOverlay } from './overlay-index.js';
import { OverlayBackend } from '../vectordb/overlay-backend.js';
import { SqliteBackend } from '../vectordb/sqlite/sqlite-backend.js';

/**
 * Every real caller of DEFAULT_CONCURRENCY in this codebase happens to also
 * be hardcoded to it today (indexing.concurrency/core.concurrency aren't
 * currently threaded through to these call sites) — so these tests mock the
 * constant itself to exercise the "configured 16" scenario ADR-013 measured,
 * proving the parse-stage cap holds regardless of where that number
 * ultimately comes from.
 */
vi.mock('../constants.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../constants.js')>();
  return {
    ...actual,
    DEFAULT_CONCURRENCY: 16,
  };
});

/**
 * Distinguishes the parse-stage's own `fs.readFile(path, 'utf-8')` call
 * (made once per file, immediately before the synchronous `chunkFile` call)
 * from unrelated reads elsewhere in the same pipeline — notably
 * `computeContentHash`'s internal `fs.readFile(path)` (no encoding arg),
 * which runs as part of an unrelated, uncapped I/O-bound step and would
 * otherwise pollute the concurrency count. Only calls carrying the 'utf-8'
 * encoding argument are instrumented; everything else passes through
 * immediately, undelayed and uncounted.
 */
function instrumentParseStageReads(delayMs: number): {
  getPeak: () => number;
  restore: () => void;
} {
  let active = 0;
  let peak = 0;
  const original = fs.readFile.bind(fs);

  const spy = vi.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
    const isParseStageRead = args[1] === 'utf-8';
    if (!isParseStageRead) {
      return original(...(args as any));
    }

    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, delayMs));
    try {
      return await original(...(args as any));
    } finally {
      active--;
    }
  });

  return {
    getPeak: () => peak,
    restore: () => spy.mockRestore(),
  };
}

describe('parse-stage concurrency cap (DEFAULT_CONCURRENCY mocked to 16)', () => {
  describe('indexCodebase full index (batchProcessFiles in index.ts)', () => {
    let testDir: string;

    beforeEach(async () => {
      testDir = await createTestDir();
      for (let i = 0; i < 12; i++) {
        await createTestFile(
          testDir,
          `src/file${i}.ts`,
          `export function fn${i}() { return ${i}; }`,
        );
      }
    });

    afterEach(async () => {
      await cleanupTestDir(testDir);
    });

    it('caps concurrent in-flight parses at 4 even though DEFAULT_CONCURRENCY is 16', async () => {
      const instrumentation = instrumentParseStageReads(15);

      try {
        const result = await indexCodebase({ rootDir: testDir, force: true });

        expect(result.success).toBe(true);
        expect(instrumentation.getPeak()).toBeGreaterThan(1);
        expect(instrumentation.getPeak()).toBeLessThanOrEqual(4);
      } finally {
        instrumentation.restore();
      }
    });
  });

  describe('indexMultipleFiles (incremental.ts)', () => {
    let testDir: string;
    let vectorDB: SqliteBackend;

    beforeEach(async () => {
      testDir = await createTestDir();
      vectorDB = new SqliteBackend(path.join(testDir, '.lien'));
      await vectorDB.initialize();
    });

    afterEach(async () => {
      vectorDB.close();
      await cleanupTestDir(testDir);
    });

    it('caps concurrent in-flight parses at 4 even though DEFAULT_CONCURRENCY is 16', async () => {
      const files: string[] = [];
      for (let i = 0; i < 12; i++) {
        files.push(
          await createTestFile(testDir, `file${i}.ts`, `export function fn${i}() { return ${i}; }`),
        );
      }

      const instrumentation = instrumentParseStageReads(15);

      try {
        const count = await indexMultipleFiles(files, vectorDB, { rootDir: testDir });

        expect(count).toBe(files.length);
        expect(instrumentation.getPeak()).toBeGreaterThan(1);
        expect(instrumentation.getPeak()).toBeLessThanOrEqual(4);
      } finally {
        instrumentation.restore();
      }
    });
  });

  describe('buildOverlay parse phase (overlay-index.ts)', () => {
    let baseDir: string;
    let worktreeDir: string;
    let overlay: OverlayBackend;

    beforeEach(async () => {
      baseDir = await createTestDir();
      worktreeDir = await createTestDir();

      // A minimal base index (empty is fine — every worktree file below is "added").
      const result = await indexCodebase({ rootDir: baseDir });
      // No indexable files in an empty dir — that's fine, buildOverlay only
      // needs a valid base index directory to diff against.
      void result;

      for (let i = 0; i < 12; i++) {
        await createTestFile(
          worktreeDir,
          `file${i}.ts`,
          `export function fn${i}() { return ${i}; }`,
        );
      }

      overlay = new OverlayBackend(worktreeDir, getIndexDir(baseDir));
      await overlay.initialize();
    });

    afterEach(async () => {
      overlay.close();
      await cleanupTestDir(baseDir);
      await cleanupTestDir(worktreeDir);
    });

    it('caps concurrent in-flight parses at 4 even though DEFAULT_CONCURRENCY is 16', async () => {
      const instrumentation = instrumentParseStageReads(15);

      try {
        const res = await buildOverlay(overlay);

        expect(res.added).toBe(12);
        expect(instrumentation.getPeak()).toBeGreaterThan(1);
        expect(instrumentation.getPeak()).toBeLessThanOrEqual(4);
      } finally {
        instrumentation.restore();
      }
    });
  });
});
