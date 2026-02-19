import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { computeContentHash, isHashAlgorithmCompatible } from './content-hash.js';

async function createTestDir(): Promise<string> {
  const tmpBase = path.join(os.tmpdir(), 'lien-test');
  await fs.mkdir(tmpBase, { recursive: true });
  const testDir = path.join(
    tmpBase,
    `test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
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

describe('computeContentHash', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it('should return deterministic hash for same content', async () => {
    const filepath = path.join(testDir, 'file.ts');
    await fs.writeFile(filepath, 'const x = 1;');

    const hash1 = await computeContentHash(filepath);
    const hash2 = await computeContentHash(filepath);

    expect(hash1).toBe(hash2);
  });

  it('should return different hashes for different content', async () => {
    const file1 = path.join(testDir, 'file1.ts');
    const file2 = path.join(testDir, 'file2.ts');
    await fs.writeFile(file1, 'const x = 1;');
    await fs.writeFile(file2, 'const x = 2;');

    const hash1 = await computeContentHash(file1);
    const hash2 = await computeContentHash(file2);

    expect(hash1).not.toBe(hash2);
  });

  it('should handle empty files', async () => {
    const filepath = path.join(testDir, 'empty.ts');
    await fs.writeFile(filepath, '');

    const hash = await computeContentHash(filepath);

    expect(hash).toBeTruthy();
    expect(hash).toHaveLength(16);
  });

  it('should return 16-character hex string', async () => {
    const filepath = path.join(testDir, 'file.ts');
    await fs.writeFile(filepath, 'export function hello() {}');

    const hash = await computeContentHash(filepath);

    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should return L-prefixed hash for large files (>1MB)', async () => {
    const filepath = path.join(testDir, 'large.bin');
    // Create a file larger than 1MB (1MB + 1 byte)
    const size = 1024 * 1024 + 1;
    const buffer = Buffer.alloc(size, 'A');
    await fs.writeFile(filepath, buffer);

    const hash = await computeContentHash(filepath);

    expect(hash).toHaveLength(16);
    expect(hash[0]).toBe('L');
    expect(hash).toMatch(/^L[0-9a-f]{15}$/);
  });

  it('should return empty string for non-existent file', async () => {
    const filepath = path.join(testDir, 'does-not-exist.ts');

    const hash = await computeContentHash(filepath);

    expect(hash).toBe('');
  });
});

describe('isHashAlgorithmCompatible', () => {
  it('should return true for undefined (legacy format)', () => {
    expect(isHashAlgorithmCompatible(undefined)).toBe(true);
  });

  it('should return true for sha256-16', () => {
    expect(isHashAlgorithmCompatible('sha256-16')).toBe(true);
  });

  it('should return true for sha256-16-large', () => {
    expect(isHashAlgorithmCompatible('sha256-16-large')).toBe(true);
  });

  it('should return false for md5', () => {
    expect(isHashAlgorithmCompatible('md5')).toBe(false);
  });

  it('should return false for sha512', () => {
    expect(isHashAlgorithmCompatible('sha512')).toBe(false);
  });

  it('should return true for empty string (falsy, treated as legacy)', () => {
    expect(isHashAlgorithmCompatible('')).toBe(true);
  });

  it('should return false for arbitrary string', () => {
    expect(isHashAlgorithmCompatible('some-unknown-algo')).toBe(false);
  });
});
