import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { computeDirSize, formatBytes } from './dir-size.js';

describe('formatBytes', () => {
  it('formats across units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
  });
});

describe('computeDirSize', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-dirsize-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('sums file sizes recursively', async () => {
    await fs.writeFile(path.join(dir, 'a.txt'), 'x'.repeat(100));
    await fs.mkdir(path.join(dir, 'sub'));
    await fs.writeFile(path.join(dir, 'sub', 'b.txt'), 'y'.repeat(50));

    expect(await computeDirSize(dir)).toBe(150);
  });

  it('returns 0 for a missing directory', async () => {
    expect(await computeDirSize(path.join(dir, 'nope'))).toBe(0);
  });
});
