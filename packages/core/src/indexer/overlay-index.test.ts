import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { getIndexDir } from '@liendev/parser';
import { createTestDir, cleanupTestDir } from '../test/helpers/test-db.js';
import { indexCodebase } from './index.js';
import { buildOverlay } from './overlay-index.js';
import { OverlayBackend } from '../vectordb/overlay-backend.js';
import { writeVersionFile } from '../vectordb/version.js';

/** Files (relative path -> content) for the base checkout. */
const BASE_FILES: Record<string, string> = {
  'a.ts': 'export function alpha() {\n  return 1;\n}\n',
  'b.ts': 'export function bravo() {\n  return 2;\n}\n',
  'c.ts': 'export function charlie() {\n  return 3;\n}\n',
};

async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }
}

/** File set covered by scanAll (union of base + overlay, mask applied). */
async function filesInIndex(overlay: OverlayBackend): Promise<Set<string>> {
  const results = await overlay.scanAll();
  return new Set(results.map(r => r.metadata.file));
}

describe('buildOverlay', () => {
  let baseDir: string;
  let worktreeDir: string;
  let overlay: OverlayBackend;

  beforeEach(async () => {
    baseDir = await createTestDir();
    worktreeDir = await createTestDir();
    await writeFiles(baseDir, BASE_FILES);

    // Build a real, standalone base index (baseDir is not a worktree).
    const result = await indexCodebase({ rootDir: baseDir });
    expect(result.success).toBe(true);

    // Worktree starts as a copy of base, then diverges: modify b, delete c, add d.
    await writeFiles(worktreeDir, BASE_FILES);
    await fs.writeFile(
      path.join(worktreeDir, 'b.ts'),
      'export function bravo() {\n  return 22222;\n}\n',
    );
    await fs.rm(path.join(worktreeDir, 'c.ts'));
    await fs.writeFile(
      path.join(worktreeDir, 'd.ts'),
      'export function delta() {\n  return 4;\n}\n',
    );

    overlay = new OverlayBackend(worktreeDir, getIndexDir(baseDir));
    await overlay.initialize();
  });

  afterEach(async () => {
    overlay.close();
    await cleanupTestDir(baseDir);
    await cleanupTestDir(worktreeDir);
  });

  it('classifies added / modified / unchanged / deleted correctly', async () => {
    const res = await buildOverlay(overlay);
    expect(res).toEqual({ added: 1, modified: 1, deleted: 1, unchanged: 1 });
  });

  it('serves unchanged files from base, diverged from overlay, and drops deleted', async () => {
    await buildOverlay(overlay);
    const files = await filesInIndex(overlay);
    expect(files.has('a.ts')).toBe(true); // unchanged -> base
    expect(files.has('b.ts')).toBe(true); // modified -> overlay
    expect(files.has('d.ts')).toBe(true); // added -> overlay
    expect(files.has('c.ts')).toBe(false); // deleted -> masked
  });

  it('serves the worktree content for a modified file, not the base content', async () => {
    await buildOverlay(overlay);
    const results = await overlay.scanWithFilter({ file: 'b.ts' });
    const joined = results.map(r => r.content).join('\n');
    expect(joined).toContain('22222');
    expect(joined).not.toContain('return 2;');
  });

  it('records the base build stamp; needsRebuild flips when the base moves', async () => {
    await buildOverlay(overlay);
    expect(await overlay.needsRebuild()).toBe(false);

    // Simulate a base reindex bumping its version stamp.
    await new Promise(r => setTimeout(r, 5));
    await writeVersionFile(getIndexDir(baseDir));
    expect(await overlay.needsRebuild()).toBe(true);
  });

  it('needsRebuild is true before the first build', async () => {
    expect(await overlay.needsRebuild()).toBe(true);
  });

  it('is idempotent — a rebuild yields the same classification', async () => {
    await buildOverlay(overlay);
    const second = await buildOverlay(overlay);
    expect(second).toEqual({ added: 1, modified: 1, deleted: 1, unchanged: 1 });
    const files = await filesInIndex(overlay);
    expect(files).toEqual(new Set(['a.ts', 'b.ts', 'd.ts']));
  });
});
