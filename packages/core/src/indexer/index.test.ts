import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { indexCodebase } from './index.js';
import { createVectorDB } from '../vectordb/factory.js';
import { ManifestManager } from './manifest.js';
import { createTestDir, cleanupTestDir, createTestFile } from '../test/helpers/test-db.js';
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
