import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeVersionFile, readVersionFile } from './version.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('version file utilities', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a temporary test directory
    testDir = path.join(os.tmpdir(), `lien-version-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('writeVersionFile', () => {
    it('should create version file with timestamp', async () => {
      const before = Date.now();
      await writeVersionFile(testDir);
      const after = Date.now();

      const versionPath = path.join(testDir, '.lien-index-version');
      const exists = await fs.access(versionPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      const content = await fs.readFile(versionPath, 'utf-8');
      const timestamp = parseInt(content.trim(), 10);

      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });

    it('should overwrite existing version file', async () => {
      // Write first version
      await writeVersionFile(testDir);
      const firstContent = await fs.readFile(
        path.join(testDir, '.lien-index-version'),
        'utf-8'
      );

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10));

      // Write second version
      await writeVersionFile(testDir);
      const secondContent = await fs.readFile(
        path.join(testDir, '.lien-index-version'),
        'utf-8'
      );

      expect(parseInt(secondContent, 10)).toBeGreaterThan(parseInt(firstContent, 10));
    });
  });

  describe('readVersionFile', () => {
    it('should read timestamp from version file', async () => {
      const expectedTimestamp = Date.now();
      const versionPath = path.join(testDir, '.lien-index-version');
      await fs.writeFile(versionPath, expectedTimestamp.toString(), 'utf-8');

      const timestamp = await readVersionFile(testDir);

      expect(timestamp).toBe(expectedTimestamp);
    });

    it('should return 0 when version file does not exist', async () => {
      const timestamp = await readVersionFile(testDir);

      expect(timestamp).toBe(0);
    });

    it('should return 0 when version file is empty', async () => {
      const versionPath = path.join(testDir, '.lien-index-version');
      await fs.writeFile(versionPath, '', 'utf-8');

      const timestamp = await readVersionFile(testDir);

      expect(timestamp).toBe(0);
    });

    it('should return 0 when version file contains invalid data', async () => {
      const versionPath = path.join(testDir, '.lien-index-version');
      await fs.writeFile(versionPath, 'not a number', 'utf-8');

      const timestamp = await readVersionFile(testDir);

      expect(timestamp).toBe(0);
    });
  });

  describe('integration', () => {
    it('should write and read version correctly', async () => {
      // Write version
      await writeVersionFile(testDir);

      // Read version
      const timestamp = await readVersionFile(testDir);

      expect(timestamp).toBeGreaterThan(0);
      expect(timestamp).toBeLessThanOrEqual(Date.now());
    });
  });
});

