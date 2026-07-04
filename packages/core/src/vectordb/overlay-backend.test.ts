import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { getIndexDir } from '@liendev/parser';
import { createTestDir, cleanupTestDir } from '../test/helpers/test-db.js';
import { indexCodebase } from '../indexer/index.js';
import { buildOverlay } from '../indexer/overlay-index.js';
import { indexMultipleFiles } from '../indexer/incremental.js';
import { OverlayBackend } from './overlay-backend.js';

const BASE_FILES: Record<string, string> = {
  'keep.ts': 'export function keepUnchangedSymbol() {\n  return 1;\n}\n',
  'change.ts': 'export function changedSymbol() {\n  return 2;\n}\n',
  'gone.ts': 'export function goneSymbol() {\n  return 3;\n}\n',
};

async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }
}

async function symbolNames(overlay: OverlayBackend): Promise<Set<string>> {
  const results = await overlay.querySymbols({ limit: 100 });
  return new Set(results.map(r => r.metadata.symbolName).filter((s): s is string => !!s));
}

describe('OverlayBackend read union', () => {
  let baseDir: string;
  let worktreeDir: string;
  let overlay: OverlayBackend;

  beforeEach(async () => {
    baseDir = await createTestDir();
    worktreeDir = await createTestDir();
    await writeFiles(baseDir, BASE_FILES);
    const result = await indexCodebase({ rootDir: baseDir });
    expect(result.success).toBe(true);

    // Worktree: keep.ts unchanged, change.ts modified (new symbol), gone.ts
    // deleted, fresh.ts added.
    await writeFiles(worktreeDir, BASE_FILES);
    await fs.writeFile(
      path.join(worktreeDir, 'change.ts'),
      'export function changedSymbolV2() {\n  return 222;\n}\n',
    );
    await fs.rm(path.join(worktreeDir, 'gone.ts'));
    await fs.writeFile(
      path.join(worktreeDir, 'fresh.ts'),
      'export function freshSymbol() {\n  return 4;\n}\n',
    );

    overlay = new OverlayBackend(worktreeDir, getIndexDir(baseDir));
    await overlay.initialize();
    await buildOverlay(overlay);
  });

  afterEach(async () => {
    overlay.close();
    await cleanupTestDir(baseDir);
    await cleanupTestDir(worktreeDir);
  });

  it('querySymbols merges base + overlay and honors the mask', async () => {
    const names = await symbolNames(overlay);
    expect(names.has('keepUnchangedSymbol')).toBe(true); // unchanged -> base
    expect(names.has('changedSymbolV2')).toBe(true); // modified -> overlay
    expect(names.has('freshSymbol')).toBe(true); // added -> overlay
    expect(names.has('goneSymbol')).toBe(false); // deleted -> masked
    expect(names.has('changedSymbol')).toBe(false); // superseded base row masked
  });

  it('FTS search returns base hits (unchanged) through the union', async () => {
    const hits = await overlay.search('keepUnchangedSymbol', 10);
    expect(hits.some(h => h.metadata.file === 'keep.ts')).toBe(true);
  });

  it('FTS search returns overlay hits (added)', async () => {
    const hits = await overlay.search('freshSymbol', 10);
    expect(hits.some(h => h.metadata.file === 'fresh.ts')).toBe(true);
  });

  it('FTS search suppresses masked base hits (deleted file)', async () => {
    const hits = await overlay.search('goneSymbol', 10);
    expect(hits.some(h => h.metadata.file === 'gone.ts')).toBe(false);
  });

  it('scanPaginated yields the full union (no masked/deleted paths)', async () => {
    const seen = new Set<string>();
    for await (const page of overlay.scanPaginated({ pageSize: 1 })) {
      for (const r of page) seen.add(r.metadata.file);
    }
    expect(seen).toEqual(new Set(['keep.ts', 'change.ts', 'fresh.ts']));
  });

  it('reconciles an incremental edit of a base file: masks base, serves overlay', async () => {
    // Edit a previously-unchanged base file in the worktree, then run the
    // incremental write path (deleteByFile + insertBatch).
    await fs.writeFile(
      path.join(worktreeDir, 'keep.ts'),
      'export function keepUnchangedSymbol() {\n  return 99999;\n}\n',
    );
    await indexMultipleFiles([path.join(worktreeDir, 'keep.ts')], overlay, {
      rootDir: worktreeDir,
    });

    const results = await overlay.scanWithFilter({ file: 'keep.ts' });
    const joined = results.map(r => r.content).join('\n');
    expect(joined).toContain('99999'); // overlay content
    expect(joined).not.toContain('return 1;'); // base row suppressed
  });

  it('reconciles an incremental delete of a base file: nothing served', async () => {
    await overlay.deleteByFile('keep.ts');
    const results = await overlay.scanWithFilter({ file: 'keep.ts' });
    expect(results).toEqual([]);
  });
});

describe('OverlayBackend.clear() reclaims disk space', () => {
  let baseDir: string;
  let worktreeDir: string;
  let overlay: OverlayBackend;

  beforeEach(async () => {
    baseDir = await createTestDir();
    worktreeDir = await createTestDir();
    await writeFiles(baseDir, BASE_FILES);
    const result = await indexCodebase({ rootDir: baseDir });
    expect(result.success).toBe(true);

    overlay = new OverlayBackend(worktreeDir, getIndexDir(baseDir));
    await overlay.initialize();
  });

  afterEach(async () => {
    overlay.close();
    await cleanupTestDir(baseDir);
    await cleanupTestDir(worktreeDir);
  });

  it('shrinks the overlay db file after clearing a large number of rows', async () => {
    // A prior standalone index, or a since-shrunk overlay, can leave the
    // overlay holding many more rows than it currently needs. `clear()` must
    // physically reclaim that space, not just mark it free in SQLite's
    // freelist (which leaves the file at its high-water-mark size forever —
    // exactly the bloat this feature exists to avoid).
    const bigContent = 'x'.repeat(2000);
    const metadatas = Array.from({ length: 500 }, (_, i) => ({
      file: `synthetic-${i}.ts`,
      startLine: 1,
      endLine: 1,
      type: 'block' as const,
      language: 'typescript',
    }));
    const contents = metadatas.map(() => bigContent);
    await overlay.insertBatch(metadatas, contents);

    // WAL mode: writes may sit in the `-wal` sidecar rather than the main
    // file until a checkpoint, so measure the pair together.
    const dbFilePath = path.join(getIndexDir(worktreeDir), 'structural.db');
    const totalSize = async () => {
      const sizes = await Promise.all(
        [dbFilePath, `${dbFilePath}-wal`].map(async f => {
          try {
            return (await fs.stat(f)).size;
          } catch {
            return 0;
          }
        }),
      );
      return sizes.reduce((a, b) => a + b, 0);
    };

    const sizeBeforeClear = await totalSize();
    expect(sizeBeforeClear).toBeGreaterThan(100_000); // sanity: rows actually landed on disk

    await overlay.clear();

    const sizeAfterClear = await totalSize();
    expect(sizeAfterClear).toBeLessThan(sizeBeforeClear / 4);
    // clear() resets the overlay only — base rows (keep.ts, change.ts, gone.ts
    // were indexed into baseDir in beforeEach) are untouched and still union in.
    const files = new Set((await overlay.scanAll()).map(r => r.metadata.file));
    expect([...files].some(f => f.startsWith('synthetic-'))).toBe(false);
  });
});

describe('OverlayBackend degrades gracefully when the base is unavailable', () => {
  let bogusBaseDir: string;
  let worktreeDir: string;
  let overlay: OverlayBackend;

  beforeEach(async () => {
    bogusBaseDir = await createTestDir(); // exists but has no structural.db / manifest
    worktreeDir = await createTestDir();
    await writeFiles(worktreeDir, {
      'only.ts': 'export function onlySymbol() {\n  return 1;\n}\n',
    });
    overlay = new OverlayBackend(worktreeDir, getIndexDir(bogusBaseDir));
    await overlay.initialize();
  });

  afterEach(async () => {
    overlay.close();
    await cleanupTestDir(bogusBaseDir);
    await cleanupTestDir(worktreeDir);
  });

  it('initializes and serves overlay-only reads without throwing', async () => {
    const res = await buildOverlay(overlay);
    // No base manifest => every worktree file is "added".
    expect(res.added).toBe(1);
    const files = new Set((await overlay.scanAll()).map(r => r.metadata.file));
    expect(files).toEqual(new Set(['only.ts']));
    // FTS still works against the overlay alone.
    const hits = await overlay.search('onlySymbol', 10);
    expect(hits.some(h => h.metadata.file === 'only.ts')).toBe(true);
  });
});
