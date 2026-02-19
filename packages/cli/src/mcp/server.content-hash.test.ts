import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ManifestManager } from '@liendev/core';
import { computeContentHash } from '@liendev/parser';

describe('Stage 4: Content-Hash Based Change Detection', () => {
  let testDir: string;
  let manifestPath: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), 'lien-test-hash-' + Date.now());
    await fs.mkdir(testDir, { recursive: true });
    manifestPath = path.join(testDir, 'manifest.json');
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('computeContentHash', () => {
    it('should compute hash for file content', async () => {
      const testFile = path.join(testDir, 'test.ts');
      await fs.writeFile(testFile, 'export const TEST = "value";');

      const hash = await computeContentHash(testFile);

      expect(hash).toBeTruthy();
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should return same hash for identical content', async () => {
      const testFile = path.join(testDir, 'test.ts');
      const content = 'export const TEST = "value";';

      await fs.writeFile(testFile, content);
      const hash1 = await computeContentHash(testFile);

      // Touch file (change mtime)
      await new Promise(resolve => setTimeout(resolve, 10));
      await fs.utimes(testFile, new Date(), new Date());

      const hash2 = await computeContentHash(testFile);

      expect(hash1).toBe(hash2);
    });

    it('should return different hash for different content', async () => {
      const testFile = path.join(testDir, 'test.ts');

      await fs.writeFile(testFile, 'export const TEST = "value1";');
      const hash1 = await computeContentHash(testFile);

      await fs.writeFile(testFile, 'export const TEST = "value2";');
      const hash2 = await computeContentHash(testFile);

      expect(hash1).not.toBe(hash2);
    });

    it('should return empty string for non-existent file', async () => {
      const testFile = path.join(testDir, 'nonexistent.ts');
      const hash = await computeContentHash(testFile);

      expect(hash).toBe('');
    });

    it('should handle large files with fingerprint', async () => {
      const testFile = path.join(testDir, 'large.ts');
      // Create 2MB file
      const largeContent = 'x'.repeat(2 * 1024 * 1024);
      await fs.writeFile(testFile, largeContent);

      const hash = await computeContentHash(testFile);

      expect(hash).toBeTruthy();
      // Large file hashes have 'L' prefix
      expect(hash[0]).toBe('L');
    });

    it('should NOT detect changes to middle of large files (known limitation)', async () => {
      const testFile = path.join(testDir, 'large-middle.ts');

      // Create 2MB file with distinct head, middle, and tail
      const head = 'HEAD'.repeat(2048); // First 8KB
      const middle = 'MIDDLE'.repeat(300000); // ~1.8MB middle
      const tail = 'TAIL'.repeat(2048); // Last 8KB
      await fs.writeFile(testFile, head + middle + tail);

      const hash1 = await computeContentHash(testFile);

      // Modify ONLY the middle section (head and tail unchanged, same length)
      const modifiedMiddle = 'CHANGE'.repeat(300000); // Same length as 'MIDDLE'
      await fs.writeFile(testFile, head + modifiedMiddle + tail);

      const hash2 = await computeContentHash(testFile);

      // Known limitation: hashes are identical because only head + tail + size are sampled
      expect(hash1).toBe(hash2);

      // Sanity check: modifying head or tail DOES change the hash
      await fs.writeFile(testFile, 'MODIFIED' + head + middle + tail);
      const hash3 = await computeContentHash(testFile);
      expect(hash3).not.toBe(hash1);
    });
  });

  describe('ManifestManager with contentHash', () => {
    it('should store contentHash in manifest', async () => {
      const manifest = new ManifestManager(manifestPath);
      const testFile = 'test.ts';
      const contentHash = 'abc123';

      await manifest.updateFile(testFile, {
        filepath: testFile,
        lastModified: Date.now(),
        chunkCount: 5,
        contentHash,
      });

      const loaded = await manifest.load();
      expect(loaded?.files[testFile]?.contentHash).toBe(contentHash);
    });

    it('should handle manifest without contentHash (backwards compat)', async () => {
      const manifest = new ManifestManager(manifestPath);
      const testFile = 'test.ts';

      // Save without contentHash
      await manifest.updateFile(testFile, {
        filepath: testFile,
        lastModified: Date.now(),
        chunkCount: 5,
      });

      const loaded = await manifest.load();
      expect(loaded?.files[testFile]).toBeDefined();
      expect(loaded?.files[testFile]?.contentHash).toBeUndefined();
    });

    it('should include hashAlgorithm in manifest', async () => {
      const manifest = new ManifestManager(manifestPath);
      await manifest.updateFile('test.ts', {
        filepath: 'test.ts',
        lastModified: Date.now(),
        chunkCount: 1,
        contentHash: 'abc',
      });

      const loaded = await manifest.load();
      expect(loaded?.hashAlgorithm).toBe('sha256-16-large');
    });
  });

  describe('Content-hash skip logic (integration)', () => {
    it('should skip reindex when content hash matches', async () => {
      // This is a conceptual test - in real implementation,
      // the handler would check hash before calling indexSingleFile
      const testFile = path.join(testDir, 'test.ts');
      const content = 'export const TEST = "value";';

      await fs.writeFile(testFile, content);
      const hash1 = await computeContentHash(testFile);

      // Simulate manifest entry with hash
      const manifestEntry = {
        filepath: 'test.ts',
        lastModified: (await fs.stat(testFile)).mtimeMs,
        chunkCount: 1,
        contentHash: hash1,
      };

      // Touch file (mtime changes)
      await new Promise(resolve => setTimeout(resolve, 10));
      await fs.utimes(testFile, new Date(), new Date());
      const newStats = await fs.stat(testFile);

      // mtime changed
      expect(newStats.mtimeMs).not.toBe(manifestEntry.lastModified);

      // But hash should match
      const hash2 = await computeContentHash(testFile);
      expect(hash2).toBe(manifestEntry.contentHash);

      // This means: skip reindex!
    });

    it('should reindex when content actually changes', async () => {
      const testFile = path.join(testDir, 'test.ts');

      await fs.writeFile(testFile, 'original content');
      const hash1 = await computeContentHash(testFile);

      const manifestEntry = {
        filepath: 'test.ts',
        lastModified: (await fs.stat(testFile)).mtimeMs,
        chunkCount: 1,
        contentHash: hash1,
      };

      // Actually change content
      await fs.writeFile(testFile, 'modified content');
      const hash2 = await computeContentHash(testFile);

      // Hash should differ
      expect(hash2).not.toBe(manifestEntry.contentHash);

      // This means: DO reindex!
    });
  });
});
