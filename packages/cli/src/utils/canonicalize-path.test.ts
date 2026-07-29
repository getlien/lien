import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { canonicalizePath } from './canonicalize-path.js';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-canonicalize-path-test-'));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('canonicalizePath', () => {
  it('resolves an existing path to its realpath (a no-op when there is no symlink)', async () => {
    const filePath = path.join(tmpRoot, 'foo.ts');
    await fs.writeFile(filePath, '', 'utf-8');
    expect(canonicalizePath(filePath)).toBe(await fs.realpath(filePath));
  });

  it('resolves a path through a symlinked ancestor to the real (symlink-free) path', async () => {
    const realDir = path.join(tmpRoot, 'real');
    await fs.mkdir(realDir, { recursive: true });
    const filePath = path.join(realDir, 'foo.ts');
    await fs.writeFile(filePath, '', 'utf-8');

    const linkDir = path.join(tmpRoot, 'link');
    try {
      await fs.symlink(realDir, linkDir, 'dir');
    } catch {
      return; // platform can't create symlinks (e.g. unprivileged Windows) — skip cleanly
    }

    const viaLink = path.join(linkDir, 'foo.ts');
    expect(canonicalizePath(viaLink)).toBe(await fs.realpath(filePath));
    // And it must actually have resolved something — the symlinked route and
    // the real route were different strings to begin with.
    expect(viaLink).not.toBe(canonicalizePath(viaLink));
  });

  it('falls back to realpath-ing the parent directory when the leaf does not exist', async () => {
    const missing = path.join(tmpRoot, 'deleted.ts');
    expect(canonicalizePath(missing)).toBe(path.join(await fs.realpath(tmpRoot), 'deleted.ts'));
  });

  it('falls back to the input unchanged when neither the path nor its parent exists (never throws)', () => {
    const deeplyMissing = path.join(tmpRoot, 'gone', 'also-gone', 'foo.ts');
    expect(() => canonicalizePath(deeplyMissing)).not.toThrow();
    expect(canonicalizePath(deeplyMissing)).toBe(deeplyMissing);
  });
});
