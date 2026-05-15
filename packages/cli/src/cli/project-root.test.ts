import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { resolveProjectRoot } from './project-root.js';

describe('resolveProjectRoot', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-root-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('walks upward to find a .git directory', async () => {
    const root = await fs.realpath(tmp);
    await fs.mkdir(path.join(root, '.git'));
    const deep = path.join(root, 'a', 'b', 'c');
    await fs.mkdir(deep, { recursive: true });
    expect(resolveProjectRoot(deep)).toBe(root);
  });

  it('recognizes .git as a file (git worktrees)', async () => {
    const root = await fs.realpath(tmp);
    await fs.writeFile(path.join(root, '.git'), 'gitdir: /elsewhere\n');
    const deep = path.join(root, 'sub');
    await fs.mkdir(deep);
    expect(resolveProjectRoot(deep)).toBe(root);
  });

  it('falls back to the start path when no marker exists', async () => {
    const root = await fs.realpath(tmp);
    expect(resolveProjectRoot(root)).toBe(root);
  });

  it('returns the start path itself when it contains the marker', async () => {
    const root = await fs.realpath(tmp);
    await fs.mkdir(path.join(root, '.git'));
    expect(resolveProjectRoot(root)).toBe(root);
  });
});
