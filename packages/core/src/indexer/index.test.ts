import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { indexCodebase } from './index.js';
import { VectorDB } from '../vectordb/lancedb.js';
import { WorkerEmbeddings } from '../embeddings/worker-embeddings.js';
import { MockEmbeddings } from '../test/helpers/mock-embeddings.js';
import { createTestDir, cleanupTestDir, createTestFile } from '../test/helpers/test-db.js';
import { defaultConfig } from '../config/schema.js';
import type { LienConfig } from '../config/schema.js';

const MATH_TS = `export function add(a: number, b: number): number {
  return a + b;
}
`;

const MAIN_TS = `import { add } from './math.js';

export function sumAll(values: number[]): number {
  return values.reduce((total, v) => add(total, v), 0);
}
`;

describe('indexCodebase - embeddings enabled/disabled', () => {
  let testDir: string;
  let workerInitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    testDir = await createTestDir();
    await createTestFile(testDir, 'src/math.ts', MATH_TS);
    await createTestFile(testDir, 'src/main.ts', MAIN_TS);

    // Proves the real embedding worker (model download + worker thread) is
    // never touched in structural-only mode.
    workerInitSpy = vi.spyOn(WorkerEmbeddings.prototype, 'initialize');
  });

  afterEach(async () => {
    workerInitSpy.mockRestore();
    await cleanupTestDir(testDir);
  });

  describe('embeddings disabled via skipEmbeddings option', () => {
    it('indexes successfully without constructing/initializing a real embedding worker', async () => {
      const result = await indexCodebase({ rootDir: testDir, skipEmbeddings: true, force: true });

      expect(result.success).toBe(true);
      expect(result.chunksCreated).toBeGreaterThan(0);
      expect(workerInitSpy).not.toHaveBeenCalled();
    });

    it('persists chunks with real structural metadata (imports/exports/symbolName)', async () => {
      const result = await indexCodebase({ rootDir: testDir, skipEmbeddings: true, force: true });
      expect(result.success).toBe(true);

      const db = new VectorDB(testDir);
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
  });

  describe('embeddings disabled via project config (.lien.config.json)', () => {
    it('skips the embedding worker purely from embeddings.enabled: false, with no explicit flag', async () => {
      const config: LienConfig = { ...defaultConfig, embeddings: { enabled: false } };
      await fs.writeFile(path.join(testDir, '.lien.config.json'), JSON.stringify(config, null, 2));

      const result = await indexCodebase({ rootDir: testDir, force: true });

      expect(result.success).toBe(true);
      expect(result.chunksCreated).toBeGreaterThan(0);
      expect(workerInitSpy).not.toHaveBeenCalled();
    });

    it('does not block indexing on a malformed project config (falls back to enabled)', async () => {
      await fs.writeFile(path.join(testDir, '.lien.config.json'), '{ not valid json');

      const mockEmbeddings = new MockEmbeddings();
      await mockEmbeddings.initialize();
      const result = await indexCodebase({
        rootDir: testDir,
        force: true,
        embeddings: mockEmbeddings,
      });

      expect(result.success).toBe(true);
      expect(result.chunksCreated).toBeGreaterThan(0);
    });
  });

  describe('embeddings enabled (default, existing behavior)', () => {
    it('uses the provided embedding service as-is — no NullEmbeddings substitution', async () => {
      const mockEmbeddings = new MockEmbeddings();
      await mockEmbeddings.initialize();
      const embedBatchSpy = vi.spyOn(mockEmbeddings, 'embedBatch');

      const result = await indexCodebase({
        rootDir: testDir,
        force: true,
        embeddings: mockEmbeddings,
      });

      expect(result.success).toBe(true);
      expect(embedBatchSpy).toHaveBeenCalled();

      const db = new VectorDB(testDir);
      await db.initialize();
      const rows = await db.scanAll();
      expect(rows.length).toBeGreaterThan(0);
    });

    it('an explicit skipEmbeddings: true still honors a caller-provided embeddings instance', async () => {
      // If the caller went to the trouble of pre-initializing a warm
      // embeddings service and *also* passed skipEmbeddings, their explicit
      // instance wins over the NullEmbeddings substitution.
      const mockEmbeddings = new MockEmbeddings();
      await mockEmbeddings.initialize();
      const embedBatchSpy = vi.spyOn(mockEmbeddings, 'embedBatch');

      const result = await indexCodebase({
        rootDir: testDir,
        force: true,
        skipEmbeddings: true,
        embeddings: mockEmbeddings,
      });

      expect(result.success).toBe(true);
      expect(embedBatchSpy).toHaveBeenCalled();
    });
  });

  it('reports failure without throwing when the directory has no indexable files', async () => {
    const emptyDir = await createTestDir();
    try {
      const result = await indexCodebase({ rootDir: emptyDir, skipEmbeddings: true, force: true });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    } finally {
      await cleanupTestDir(emptyDir);
    }
  });
});
