import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { getIndexDir } from '@liendev/parser';
import { createTestDir, cleanupTestDir } from '../test/helpers/test-db.js';
import { indexCodebase } from '../indexer/index.js';
import { buildOverlay } from '../indexer/overlay-index.js';
import { OverlayBackend } from './overlay-backend.js';
import { readVersionFile } from './version.js';

/**
 * Regression tests for the worktree-overlay rebuild concurrency bug
 * (see docs/architecture/worktree-aware-indexing.md, "Concurrency hardening").
 *
 * Two failure modes, reproduced here with two separate connections against one
 * overlay db — the shape of "multiple `lien serve` processes on one worktree":
 *
 *   1. Non-atomic rebuild window: a rebuild `clear()`ed the overlay then
 *      repopulated it over many async ticks, so a concurrent reader could
 *      observe a diverged file with neither overlay rows nor a base fallback —
 *      the file vanishing from `querySymbols` / `list_functions` entirely.
 *   2. Rebuild livelock: every rebuild bumped the version stamp even when the
 *      overlay was byte-identical, so each serve's version poll saw a bump and
 *      reconnected / re-triggered — churning forever with zero file edits.
 */

const BASE_FILES: Record<string, string> = {
  'target.ts': 'export function targetSymbol() {\n  return 1;\n}\n',
  'keep-a.ts': 'export function keepA() {\n  return 10;\n}\n',
  'keep-b.ts': 'export function keepB() {\n  return 20;\n}\n',
};

/** target.ts modified in the worktree: SAME symbol name, different body → it
 *  diverges from base (masked from base AND stored in the overlay). */
const WORKTREE_TARGET = 'export function targetSymbol() {\n  return 22222;\n}\n';
/** A worktree-only file (absent from base). During a non-atomic rebuild it has
 *  no overlay rows AND no base fallback for the entire scan/chunk phase — the
 *  deterministic, macro-task-spanning "disappears entirely" window. */
const WORKTREE_ADDED = 'export function addedSymbol() {\n  return 7;\n}\n';

async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }
}

const nextTick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

async function seenFiles(overlay: OverlayBackend): Promise<Set<string>> {
  const results = await overlay.querySymbols({ limit: 1000 });
  return new Set(results.map(r => r.metadata.file));
}

describe('OverlayBackend rebuild concurrency', () => {
  let baseDir: string;
  let worktreeDir: string;

  beforeEach(async () => {
    baseDir = await createTestDir();
    worktreeDir = await createTestDir();
    await writeFiles(baseDir, BASE_FILES);
    const result = await indexCodebase({ rootDir: baseDir });
    expect(result.success).toBe(true);

    // Worktree = base + a modified file (target.ts) + an added file (added.ts).
    await writeFiles(worktreeDir, BASE_FILES);
    await fs.writeFile(path.join(worktreeDir, 'target.ts'), WORKTREE_TARGET);
    await fs.writeFile(path.join(worktreeDir, 'added.ts'), WORKTREE_ADDED);
  });

  afterEach(async () => {
    await cleanupTestDir(baseDir);
    await cleanupTestDir(worktreeDir);
  });

  it('never exposes a masked-but-unreplaced window to a concurrent reader', async () => {
    const writer = new OverlayBackend(worktreeDir, getIndexDir(baseDir));
    const reader = new OverlayBackend(worktreeDir, getIndexDir(baseDir));
    await writer.initialize();
    await reader.initialize();

    try {
      // Prime the overlay so both diverged files are present before racing.
      await buildOverlay(writer);
      const primed = await seenFiles(reader);
      expect(primed.has('target.ts')).toBe(true); // modified → overlay
      expect(primed.has('added.ts')).toBe(true); // added → overlay

      const missing: string[] = [];
      let done = false;

      const writerLoop = (async () => {
        for (let i = 0; i < 50; i++) {
          await buildOverlay(writer);
        }
        done = true;
      })();

      const readerLoop = (async () => {
        while (!done) {
          const files = await seenFiles(reader);
          // Both diverged files exist in the worktree at every instant — a
          // concurrent rebuild must never make them momentarily invisible.
          if (!files.has('target.ts')) missing.push('target.ts');
          if (!files.has('added.ts')) missing.push('added.ts');
          await nextTick();
        }
      })();

      await Promise.all([writerLoop, readerLoop]);

      expect(missing, `reader observed missing files: ${missing.join(', ')}`).toEqual([]);
    } finally {
      writer.close();
      reader.close();
    }
  });

  it('serves a consistent snapshot across genuine rebuild swaps', async () => {
    const writer = new OverlayBackend(worktreeDir, getIndexDir(baseDir));
    const reader = new OverlayBackend(worktreeDir, getIndexDir(baseDir));
    await writer.initialize();
    await reader.initialize();

    try {
      await buildOverlay(writer);

      const missing: string[] = [];
      let done = false;

      // Toggle keep-a.ts between two divergent bodies BETWEEN builds (never
      // during a scan) so every rebuild is a real atomic swap, not a no-op.
      const variants = [
        'export function keepA() {\n  return 111;\n}\n',
        'export function keepA() {\n  return 222;\n}\n',
      ];

      const writerLoop = (async () => {
        for (let i = 0; i < 40; i++) {
          await fs.writeFile(path.join(worktreeDir, 'keep-a.ts'), variants[i % 2]);
          await buildOverlay(writer);
        }
        done = true;
      })();

      const readerLoop = (async () => {
        while (!done) {
          const files = await seenFiles(reader);
          // added.ts is stable across every swap; it must be visible always.
          if (!files.has('added.ts')) missing.push('added.ts');
          // keep-a.ts diverges in every variant, so it is always present too.
          if (!files.has('keep-a.ts')) missing.push('keep-a.ts');
          await nextTick();
        }
      })();

      await Promise.all([writerLoop, readerLoop]);

      expect(missing, `reader observed missing files: ${missing.join(', ')}`).toEqual([]);
    } finally {
      writer.close();
      reader.close();
    }
  });

  it('does not bump the version stamp when a rebuild produces an identical overlay', async () => {
    const overlay = new OverlayBackend(worktreeDir, getIndexDir(baseDir));
    await overlay.initialize();
    try {
      const first = await buildOverlay(overlay);
      expect(first.changed).toBe(true); // first build is a real change
      const v1 = await readVersionFile(getIndexDir(worktreeDir));
      expect(v1).toBeGreaterThan(0);

      // Any bump would be observable as a strictly greater timestamp.
      await new Promise(r => setTimeout(r, 5));

      const second = await buildOverlay(overlay);
      expect(second.changed).toBe(false); // identical overlay → no-op
      const v2 = await readVersionFile(getIndexDir(worktreeDir));
      expect(v2).toBe(v1); // version stamp unchanged
    } finally {
      overlay.close();
    }
  });

  it('two writers on one overlay do not re-trigger each other, but a real change still bumps', async () => {
    const w1 = new OverlayBackend(worktreeDir, getIndexDir(baseDir));
    const w2 = new OverlayBackend(worktreeDir, getIndexDir(baseDir));
    await w1.initialize();
    await w2.initialize();

    try {
      await buildOverlay(w1);
      const v1 = await readVersionFile(getIndexDir(worktreeDir));

      await new Promise(r => setTimeout(r, 5));

      // Second serve rebuilds the identical overlay → MUST NOT bump (no cascade).
      const w2res = await buildOverlay(w2);
      expect(w2res.changed).toBe(false);
      const v2 = await readVersionFile(getIndexDir(worktreeDir));
      expect(v2).toBe(v1);

      // But a genuine worktree change still bumps, so real edits propagate.
      await new Promise(r => setTimeout(r, 5));
      await fs.writeFile(
        path.join(worktreeDir, 'keep-b.ts'),
        'export function keepB() {\n  return 999999;\n}\n',
      );
      const w2res2 = await buildOverlay(w2);
      expect(w2res2.changed).toBe(true);
      const v3 = await readVersionFile(getIndexDir(worktreeDir));
      expect(v3).toBeGreaterThan(v1);
    } finally {
      w1.close();
      w2.close();
    }
  });
});
