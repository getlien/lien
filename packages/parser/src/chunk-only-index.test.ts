import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { performChunkOnlyIndex } from './chunk-only-index.js';

async function createTestDir(): Promise<string> {
  const tmpBase = path.join(os.tmpdir(), 'lien-test');
  await fs.mkdir(tmpBase, { recursive: true });
  const testDir = path.join(
    tmpBase,
    `parse-concurrency-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  );
  await fs.mkdir(testDir, { recursive: true });
  return testDir;
}

async function cleanupTestDir(testDir: string): Promise<void> {
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Instruments fs.readFile (called once per file, immediately before the
 * synchronous chunkFile call in chunkFileForCollection) to track how many
 * files are simultaneously "in flight" through the parse stage — i.e. how
 * many source buffers are alive awaiting their chunkFile call at once. This
 * is the quantity ADR-013's memory-budget risk is about: how wide the
 * parse/chunk stage runs, independent of whatever concurrency was requested.
 */
function instrumentReadFileConcurrency(delayMs: number): {
  getPeak: () => number;
  restore: () => void;
} {
  let active = 0;
  let peak = 0;
  const original = fs.readFile.bind(fs);

  const spy = vi.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, delayMs));
    try {
      return await (original as any)(...args);
    } finally {
      active--;
    }
  });

  return {
    getPeak: () => peak,
    restore: () => spy.mockRestore(),
  };
}

async function writeTestFiles(testDir: string, count: number): Promise<string[]> {
  const files: string[] = [];
  for (let i = 0; i < count; i++) {
    const file = path.join(testDir, `file${i}.ts`);
    await fs.writeFile(file, `export function fn${i}() { return ${i}; }`);
    files.push(file);
  }
  return files;
}

describe('performChunkOnlyIndex parse-stage concurrency cap', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it('caps concurrent in-flight parses at 4 even when concurrency=16 is requested', async () => {
    const files = await writeTestFiles(testDir, 12);
    const instrumentation = instrumentReadFileConcurrency(15);

    try {
      const result = await performChunkOnlyIndex(testDir, {
        filesToIndex: files,
        concurrency: 16,
      });

      expect(result.success).toBe(true);
      expect(result.filesIndexed).toBe(files.length);
      // Sanity: concurrency is actually happening, not accidentally serialized.
      expect(instrumentation.getPeak()).toBeGreaterThan(1);
      // The cap: never more than PARSE_STAGE_MAX_CONCURRENCY (4) in flight,
      // regardless of the requested 16.
      expect(instrumentation.getPeak()).toBeLessThanOrEqual(4);
    } finally {
      instrumentation.restore();
    }
  });

  it('stays at a configured concurrency of 2 (the cap never raises concurrency)', async () => {
    const files = await writeTestFiles(testDir, 8);
    const instrumentation = instrumentReadFileConcurrency(15);

    try {
      const result = await performChunkOnlyIndex(testDir, {
        filesToIndex: files,
        concurrency: 2,
      });

      expect(result.success).toBe(true);
      expect(result.filesIndexed).toBe(files.length);
      expect(instrumentation.getPeak()).toBeGreaterThan(1);
      expect(instrumentation.getPeak()).toBeLessThanOrEqual(2);
    } finally {
      instrumentation.restore();
    }
  });
});

describe('performChunkOnlyIndex per-file error handling', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it('skips an unreadable file (ENOENT) without failing the whole run', async () => {
    // Only a native-binding LOAD failure is fatal (see
    // chunk-only-index-native-load.test.ts). An ordinary per-file error --
    // here a missing file whose read throws ENOENT -- is swallowed per-file
    // so one bad file never aborts the index.
    const [validFile] = await writeTestFiles(testDir, 1);
    const missingFile = path.join(testDir, 'does-not-exist.ts');

    const result = await performChunkOnlyIndex(testDir, {
      filesToIndex: [validFile, missingFile],
    });

    expect(result.success).toBe(true);
    // Both files were attempted; the missing one contributed no chunks but
    // did not abort the run.
    expect(result.filesIndexed).toBe(2);
    expect(result.chunksCreated).toBeGreaterThan(0);
  });
});
describe('performChunkOnlyIndex — deterministic chunk order', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it('returns chunks in filesToIndex order, not I/O-completion order', async () => {
    // Files are chunked concurrently. Accumulating into one shared array made
    // chunk order depend on which read finished first, which is not stable
    // run-to-run — and `lien complexity --format json` is documented as a
    // diffable baseline. Varying the sizes makes completion order differ from
    // request order in practice.
    const files: string[] = [];
    for (let i = 0; i < 8; i++) {
      const file = path.join(testDir, `f${i}.ts`);
      const padding = '// pad\n'.repeat((8 - i) * 400);
      await fs.writeFile(file, `${padding}export function fn${i}(a) { return a; }\n`);
      files.push(file);
    }

    const orderOf = (r: Awaited<ReturnType<typeof performChunkOnlyIndex>>) =>
      r.chunks.map(c => c.metadata.file);

    const first = orderOf(await performChunkOnlyIndex(testDir, { filesToIndex: files }));
    const second = orderOf(await performChunkOnlyIndex(testDir, { filesToIndex: files }));
    const third = orderOf(await performChunkOnlyIndex(testDir, { filesToIndex: files }));

    expect(second).toEqual(first);
    expect(third).toEqual(first);

    // And the order is the REQUESTED order, not merely stable: first
    // appearance of each file must follow filesToIndex.
    const firstAppearance = [...new Set(first)];
    expect(firstAppearance).toEqual(files.map(f => path.relative(testDir, f)));
  });
});

describe('performChunkOnlyIndex — oversized file cap', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it('skips a file over the size cap instead of parsing it', async () => {
    // `lien index` has always skipped these (#1025). Without the same cap on
    // the chunk-only path, an 8 MB file costs ~1 GB of RSS, then exceeds the
    // native parser's napi string limit, falls back to line-based chunking,
    // and lands in the report carrying meaningless complexity metrics.
    const small = path.join(testDir, 'small.ts');
    const huge = path.join(testDir, 'huge.ts');
    await fs.writeFile(small, 'export function small(a) { return a; }\n');
    await fs.writeFile(huge, `// ${'x'.repeat(6 * 1024 * 1024)}\nexport function huge() {}\n`);

    const result = await performChunkOnlyIndex(testDir, {
      filesToIndex: [small, huge],
    });

    expect(result.success).toBe(true);
    const chunkedFiles = new Set(result.chunks.map(c => c.metadata.file));
    expect(chunkedFiles.has('small.ts')).toBe(true);
    expect(chunkedFiles.has('huge.ts')).toBe(false);
  });

  it('keeps a file just under the cap', async () => {
    const ok = path.join(testDir, 'ok.ts');
    await fs.writeFile(ok, `// ${'x'.repeat(1024 * 1024)}\nexport function ok(a) { return a; }\n`);

    const result = await performChunkOnlyIndex(testDir, { filesToIndex: [ok] });

    expect(result.chunks.some(c => c.metadata.file === 'ok.ts')).toBe(true);
  });
});
