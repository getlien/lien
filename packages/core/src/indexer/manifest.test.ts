import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { ManifestManager } from './manifest.js';
import { createTestDir, cleanupTestDir } from '../test/helpers/test-db.js';

describe('ManifestManager', () => {
  let testDir: string;
  let manifestManager: ManifestManager;

  beforeEach(async () => {
    testDir = await createTestDir();
    manifestManager = new ManifestManager(testDir);
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe('updateGitState', () => {
    it('should create manifest and save git state when manifest does not exist', async () => {
      // Regression test for bug where updateGitState would return early if manifest didn't exist
      const gitState = {
        branch: 'main',
        commit: 'abc123',
        timestamp: Date.now(),
      };

      // Update git state on non-existent manifest
      await manifestManager.updateGitState(gitState);

      // Verify manifest was created with git state
      const manifest = await manifestManager.load();
      expect(manifest).toBeTruthy();
      expect(manifest?.gitState).toEqual(gitState);
    });

    it('should update git state in existing manifest', async () => {
      // Create initial manifest with files
      await manifestManager.updateFiles([
        { filepath: 'test.ts', lastModified: Date.now(), chunkCount: 5 },
      ]);

      const gitState = {
        branch: 'feature',
        commit: 'def456',
        timestamp: Date.now(),
      };

      // Update git state
      await manifestManager.updateGitState(gitState);

      // Verify git state was added without losing files
      const manifest = await manifestManager.load();
      expect(manifest?.gitState).toEqual(gitState);
      expect(manifest?.files['test.ts']).toBeTruthy();
    });
  });

  describe('recordSourceRoot', () => {
    it('records the source root on a fresh manifest (GC provenance)', async () => {
      await manifestManager.recordSourceRoot('/abs/project/root');

      const manifest = await manifestManager.load();
      expect(manifest?.sourceRoot).toBe('/abs/project/root');
    });

    it('preserves the source root across later manifest writes', async () => {
      await manifestManager.recordSourceRoot('/abs/project/root');
      await manifestManager.updateFiles([
        { filepath: 'test.ts', lastModified: Date.now(), chunkCount: 3 },
      ]);

      const manifest = await manifestManager.load();
      expect(manifest?.sourceRoot).toBe('/abs/project/root');
      expect(manifest?.files['test.ts']).toBeTruthy();
    });

    it('no-ops on a format-version mismatch instead of wiping the files map', async () => {
      // Regression test: recordSourceRoot used to fall back to load() || createEmpty(),
      // and load() clears an incompatible-format manifest and returns null — so
      // recordSourceRoot would write back a fresh, empty files map on top of an
      // otherwise-valid legacy index.
      const manifestPath = path.join(testDir, 'manifest.json');
      const legacyManifest = {
        formatVersion: 1, // stale relative to current INDEX_FORMAT_VERSION
        lienVersion: 'old',
        lastIndexed: Date.now(),
        files: { 'kept.ts': { filepath: 'kept.ts', lastModified: Date.now(), chunkCount: 7 } },
      };
      await fs.writeFile(manifestPath, JSON.stringify(legacyManifest), 'utf-8');

      await manifestManager.recordSourceRoot('/abs/project/root');

      // No-op: the incompatible manifest is left exactly as-is on disk — not
      // cleared, not overwritten with an empty files map.
      const onDisk = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
      expect(onDisk.files['kept.ts']).toBeTruthy();
      expect(onDisk.sourceRoot).toBeUndefined();
    });
  });

  describe('updateFile', () => {
    it('should create manifest if it does not exist', async () => {
      const entry = {
        filepath: 'test.ts',
        lastModified: Date.now(),
        chunkCount: 3,
      };

      await manifestManager.updateFile('test.ts', entry);

      const manifest = await manifestManager.load();
      expect(manifest).toBeTruthy();
      expect(manifest?.files['test.ts']).toEqual(entry);
    });

    it('should update existing file entry', async () => {
      const entry1 = {
        filepath: 'test.ts',
        lastModified: 100,
        chunkCount: 3,
      };

      await manifestManager.updateFile('test.ts', entry1);

      const entry2 = {
        filepath: 'test.ts',
        lastModified: 200,
        chunkCount: 5,
      };

      await manifestManager.updateFile('test.ts', entry2);

      const manifest = await manifestManager.load();
      expect(manifest?.files['test.ts']).toEqual(entry2);
    });
  });

  describe('removeFile', () => {
    it('should not error when removing from non-existent manifest', async () => {
      // Should not throw
      await expect(manifestManager.removeFile('test.ts')).resolves.toBeUndefined();
    });

    it('should remove file from manifest', async () => {
      await manifestManager.updateFiles([
        { filepath: 'test1.ts', lastModified: Date.now(), chunkCount: 3 },
        { filepath: 'test2.ts', lastModified: Date.now(), chunkCount: 5 },
      ]);

      await manifestManager.removeFile('test1.ts');

      const manifest = await manifestManager.load();
      expect(manifest?.files['test1.ts']).toBeUndefined();
      expect(manifest?.files['test2.ts']).toBeTruthy();
    });
  });

  describe('removeFiles', () => {
    it('should not error when removing from non-existent manifest', async () => {
      // Should not throw
      await expect(manifestManager.removeFiles(['test.ts'])).resolves.toBeUndefined();
    });

    it('should remove all files and persist with a single save', async () => {
      await manifestManager.updateFiles([
        { filepath: 'test1.ts', lastModified: Date.now(), chunkCount: 3 },
        { filepath: 'test2.ts', lastModified: Date.now(), chunkCount: 5 },
        { filepath: 'test3.ts', lastModified: Date.now(), chunkCount: 7 },
      ]);

      const saveSpy = vi.spyOn(manifestManager, 'save');

      await manifestManager.removeFiles(['test1.ts', 'test2.ts']);

      expect(saveSpy).toHaveBeenCalledTimes(1);

      const manifest = await manifestManager.load();
      expect(manifest?.files['test1.ts']).toBeUndefined();
      expect(manifest?.files['test2.ts']).toBeUndefined();
      expect(manifest?.files['test3.ts']).toBeTruthy();
    });

    it('should be a no-op for an empty array', async () => {
      await manifestManager.updateFiles([
        { filepath: 'test.ts', lastModified: Date.now(), chunkCount: 5 },
      ]);

      const saveSpy = vi.spyOn(manifestManager, 'save');

      await manifestManager.removeFiles([]);

      expect(saveSpy).not.toHaveBeenCalled();

      const manifest = await manifestManager.load();
      expect(manifest?.files['test.ts']).toBeTruthy();
    });

    it('should tolerate paths that are not in the manifest', async () => {
      await manifestManager.updateFiles([
        { filepath: 'test1.ts', lastModified: Date.now(), chunkCount: 3 },
        { filepath: 'test2.ts', lastModified: Date.now(), chunkCount: 5 },
      ]);

      await manifestManager.removeFiles(['test1.ts', 'missing.ts']);

      const manifest = await manifestManager.load();
      expect(manifest?.files['test1.ts']).toBeUndefined();
      expect(manifest?.files['test2.ts']).toBeTruthy();
    });
  });

  describe('updateFiles', () => {
    it('should create manifest if it does not exist', async () => {
      const entries = [
        { filepath: 'test1.ts', lastModified: Date.now(), chunkCount: 3 },
        { filepath: 'test2.ts', lastModified: Date.now(), chunkCount: 5 },
      ];

      await manifestManager.updateFiles(entries);

      const manifest = await manifestManager.load();
      expect(manifest).toBeTruthy();
      expect(Object.keys(manifest?.files || {})).toHaveLength(2);
    });

    it('should batch update multiple files', async () => {
      const entries = [
        { filepath: 'test1.ts', lastModified: 100, chunkCount: 3 },
        { filepath: 'test2.ts', lastModified: 200, chunkCount: 5 },
        { filepath: 'test3.ts', lastModified: 300, chunkCount: 7 },
      ];

      await manifestManager.updateFiles(entries);

      const manifest = await manifestManager.load();
      expect(manifest?.files['test1.ts']?.chunkCount).toBe(3);
      expect(manifest?.files['test2.ts']?.chunkCount).toBe(5);
      expect(manifest?.files['test3.ts']?.chunkCount).toBe(7);
    });
  });

  describe('concurrency', () => {
    it('should handle concurrent updates without race conditions', async () => {
      // Start multiple concurrent operations
      const operations = [
        manifestManager.updateFile('file1.ts', {
          filepath: 'file1.ts',
          lastModified: 100,
          chunkCount: 1,
        }),
        manifestManager.updateFile('file2.ts', {
          filepath: 'file2.ts',
          lastModified: 200,
          chunkCount: 2,
        }),
        manifestManager.updateFile('file3.ts', {
          filepath: 'file3.ts',
          lastModified: 300,
          chunkCount: 3,
        }),
      ];

      await Promise.all(operations);

      const manifest = await manifestManager.load();
      expect(Object.keys(manifest?.files || {})).toHaveLength(3);
      expect(manifest?.files['file1.ts']?.chunkCount).toBe(1);
      expect(manifest?.files['file2.ts']?.chunkCount).toBe(2);
      expect(manifest?.files['file3.ts']?.chunkCount).toBe(3);
    });

    it('should serialize concurrent removeFiles and updateFiles without race conditions', async () => {
      await manifestManager.updateFiles([
        { filepath: 'file1.ts', lastModified: 100, chunkCount: 1 },
        { filepath: 'file2.ts', lastModified: 200, chunkCount: 2 },
        { filepath: 'file3.ts', lastModified: 300, chunkCount: 3 },
      ]);

      // Start mixed concurrent operations without awaiting in between
      const operations = [
        manifestManager.removeFiles(['file1.ts', 'file2.ts']),
        manifestManager.updateFiles([
          { filepath: 'file4.ts', lastModified: 400, chunkCount: 4 },
          { filepath: 'file5.ts', lastModified: 500, chunkCount: 5 },
        ]),
        manifestManager.removeFiles(['file4.ts']),
      ];

      await Promise.all(operations);

      const manifest = await manifestManager.load();
      expect(Object.keys(manifest?.files || {}).sort()).toEqual(['file3.ts', 'file5.ts']);
      expect(manifest?.files['file3.ts']?.chunkCount).toBe(3);
      expect(manifest?.files['file5.ts']?.chunkCount).toBe(5);
    });
  });

  describe('clear', () => {
    it('should remove manifest file', async () => {
      await manifestManager.updateFiles([
        { filepath: 'test.ts', lastModified: Date.now(), chunkCount: 5 },
      ]);

      let manifest = await manifestManager.load();
      expect(manifest).toBeTruthy();

      await manifestManager.clear();

      manifest = await manifestManager.load();
      expect(manifest).toBeNull();
    });
  });

  describe('getIndexedFiles', () => {
    it('should return empty array when no manifest exists', async () => {
      const files = await manifestManager.getIndexedFiles();
      expect(files).toEqual([]);
    });

    it('should return list of indexed files', async () => {
      await manifestManager.updateFiles([
        { filepath: 'test1.ts', lastModified: Date.now(), chunkCount: 3 },
        { filepath: 'test2.ts', lastModified: Date.now(), chunkCount: 5 },
      ]);

      const files = await manifestManager.getIndexedFiles();
      expect(files).toContain('test1.ts');
      expect(files).toContain('test2.ts');
      expect(files).toHaveLength(2);
    });
  });
});
