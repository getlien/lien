import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { detectChanges } from './change-detector.js';
import { normalizeToRelativePath } from './incremental.js';
import { VectorDB } from '../vectordb/lancedb.js';
import { ManifestManager, IndexManifest } from './manifest.js';
import { createTestDir, cleanupTestDir } from '../test/helpers/test-db.js';
import { defaultConfig } from '../config/schema.js';
import { INDEX_FORMAT_VERSION } from '../constants.js';
import { getPackageVersion } from '../utils/version.js';

const execAsync = promisify(exec);

describe('Change Detector', () => {
  let testDir: string;
  let vectorDB: VectorDB;
  let manifest: ManifestManager;

  /**
   * Helper to convert absolute paths to relative (for test assertions)
   * detectChanges now returns relative paths, so we need to normalize test paths too
   */
  function toRelative(absolutePath: string): string {
    return normalizeToRelativePath(absolutePath, testDir);
  }

  /**
   * Helper to create an empty manifest
   */
  function createEmptyManifest(): IndexManifest {
    return {
      formatVersion: INDEX_FORMAT_VERSION,
      lienVersion: getPackageVersion(),
      lastIndexed: Date.now(),
      files: {},
    };
  }

  beforeEach(async () => {
    testDir = await createTestDir();
    
    vectorDB = new VectorDB(testDir);
    await vectorDB.initialize();
    
    // Use vectorDB.dbPath which is where detectChanges will look for the manifest
    manifest = new ManifestManager(vectorDB.dbPath);
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe('First-time indexing', () => {
    it('should detect all files as added when no manifest exists', async () => {
      // Create test files
      await fs.writeFile(path.join(testDir, 'file1.ts'), 'export const a = 1;');
      await fs.writeFile(path.join(testDir, 'file2.ts'), 'export const b = 2;');
      
      const result = await detectChanges(testDir, vectorDB, defaultConfig);
      
      expect(result.reason).toBe('full');
      expect(result.added.length).toBe(2);
      expect(result.modified.length).toBe(0);
      expect(result.deleted.length).toBe(0);
      expect(result.added).toContain(toRelative(path.join(testDir, 'file1.ts')));
      expect(result.added).toContain(toRelative(path.join(testDir, 'file2.ts')));
    });
  });

  describe('Mtime-based detection', () => {
    it('should detect newly added files', async () => {
      // Create initial manifest
      const savedManifest = createEmptyManifest();
      const file1 = path.join(testDir, 'file1.ts');
      await fs.writeFile(file1, 'export const a = 1;');
      const stats1 = await fs.stat(file1);
      
      savedManifest.files[file1] = {
        filepath: file1,
        lastModified: stats1.mtimeMs,
        chunkCount: 1,
      };
      await manifest.save(savedManifest);
      
      // Add new file
      const file2 = path.join(testDir, 'file2.ts');
      await fs.writeFile(file2, 'export const b = 2;');
      
      const result = await detectChanges(testDir, vectorDB, defaultConfig);
      
      expect(result.reason).toBe('mtime');
      expect(result.added).toContain(toRelative(file2));
      expect(result.modified.length).toBe(0);
      expect(result.deleted.length).toBe(0);
    });

    it('should detect modified files by mtime', async () => {
      // Create initial manifest with old timestamp
      const savedManifest = createEmptyManifest();
      const file1 = path.join(testDir, 'file1.ts');
      await fs.writeFile(file1, 'export const a = 1;');
      
      savedManifest.files[file1] = {
        filepath: file1,
        lastModified: Date.now() - 10000, // 10 seconds ago
        chunkCount: 1,
      };
      await manifest.save(savedManifest);
      
      // Wait and modify file
      await new Promise(resolve => setTimeout(resolve, 10));
      await fs.writeFile(file1, 'export const a = 2;'); // Modified
      
      const result = await detectChanges(testDir, vectorDB, defaultConfig);
      
      expect(result.reason).toBe('mtime');
      expect(result.modified).toContain(toRelative(file1));
      expect(result.added.length).toBe(0);
      expect(result.deleted.length).toBe(0);
    });

    it('should detect deleted files', async () => {
      // Create initial manifest
      const savedManifest = createEmptyManifest();
      const file1 = path.join(testDir, 'file1.ts');
      const file2 = path.join(testDir, 'file2.ts');
      
      await fs.writeFile(file1, 'export const a = 1;');
      await fs.writeFile(file2, 'export const b = 2;');
      
      const stats1 = await fs.stat(file1);
      const stats2 = await fs.stat(file2);
      
      savedManifest.files[file1] = {
        filepath: file1,
        lastModified: stats1.mtimeMs,
        chunkCount: 1,
      };
      savedManifest.files[file2] = {
        filepath: file2,
        lastModified: stats2.mtimeMs,
        chunkCount: 1,
      };
      await manifest.save(savedManifest);
      
      // Delete file2
      await fs.unlink(file2);
      
      const result = await detectChanges(testDir, vectorDB, defaultConfig);
      
      expect(result.reason).toBe('mtime');
      expect(result.deleted).toContain(toRelative(file2));
      expect(result.added.length).toBe(0);
      expect(result.modified.length).toBe(0);
    });

    it('should detect combination of added, modified, and deleted files', async () => {
      // Create initial manifest
      const savedManifest = createEmptyManifest();
      const file1 = path.join(testDir, 'file1.ts');
      const file2 = path.join(testDir, 'file2.ts');
      
      await fs.writeFile(file1, 'export const a = 1;');
      await fs.writeFile(file2, 'export const b = 2;');
      
      savedManifest.files[file1] = {
        filepath: file1,
        lastModified: Date.now() - 10000,
        chunkCount: 1,
      };
      savedManifest.files[file2] = {
        filepath: file2,
        lastModified: Date.now() - 10000,
        chunkCount: 1,
      };
      await manifest.save(savedManifest);
      
      // Modify file1, delete file2, add file3
      await new Promise(resolve => setTimeout(resolve, 10));
      await fs.writeFile(file1, 'export const a = 2;'); // Modified
      await fs.unlink(file2); // Deleted
      const file3 = path.join(testDir, 'file3.ts');
      await fs.writeFile(file3, 'export const c = 3;'); // Added
      
      const result = await detectChanges(testDir, vectorDB, defaultConfig);
      
      expect(result.reason).toBe('mtime');
      expect(result.modified).toContain(toRelative(file1));
      expect(result.deleted).toContain(toRelative(file2));
      expect(result.added).toContain(toRelative(file3));
    });
  });

  describe('Git-based detection', () => {
    beforeEach(async () => {
      // Initialize git repo
      await execAsync('git init', { cwd: testDir });
      await execAsync('git config user.email "test@example.com"', { cwd: testDir });
      await execAsync('git config user.name "Test User"', { cwd: testDir });
    });

    it('should use git diff for incremental detection on branch switch', async () => {
      // Create and commit initial files on main branch
      const file1 = path.join(testDir, 'file1.ts');
      const file2 = path.join(testDir, 'file2.ts');
      await fs.writeFile(file1, 'export const a = 1;');
      await fs.writeFile(file2, 'export const b = 2;');
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "Initial commit"', { cwd: testDir });
      
      // Get current commit
      const { stdout: commit1 } = await execAsync('git rev-parse HEAD', { cwd: testDir });
      const mainCommit = commit1.trim();
      
      // Create manifest with git state
      const savedManifest = createEmptyManifest();
      const stats1 = await fs.stat(file1);
      const stats2 = await fs.stat(file2);
      
      savedManifest.files[file1] = {
        filepath: file1,
        lastModified: stats1.mtimeMs,
        chunkCount: 1,
      };
      savedManifest.files[file2] = {
        filepath: file2,
        lastModified: stats2.mtimeMs,
        chunkCount: 1,
      };
      savedManifest.gitState = {
        branch: 'main',
        commit: mainCommit,
        timestamp: Date.now(),
      };
      await manifest.save(savedManifest);
      
      // Create feature branch, modify file1, add file3
      await execAsync('git checkout -b feature', { cwd: testDir });
      await fs.writeFile(file1, 'export const a = 2;'); // Modified
      const file3 = path.join(testDir, 'file3.ts');
      await fs.writeFile(file3, 'export const c = 3;'); // Added
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "Feature changes"', { cwd: testDir });
      
      const result = await detectChanges(testDir, vectorDB, defaultConfig);
      
      expect(result.reason).toBe('git-state-changed');
      expect(result.modified).toContain(toRelative(file1)); // Should detect file1 as modified
      expect(result.added).toContain(toRelative(file3)); // Should detect file3 as added
      expect(result.deleted.length).toBe(0);
      // file2 should NOT be in any category (unchanged)
      expect(result.modified).not.toContain(toRelative(file2));
      expect(result.added).not.toContain(toRelative(file2));
    });

    it('should detect deleted files on branch switch using git diff', async () => {
      // Create and commit files on main branch
      const file1 = path.join(testDir, 'file1.ts');
      const file2 = path.join(testDir, 'file2.ts');
      await fs.writeFile(file1, 'export const a = 1;');
      await fs.writeFile(file2, 'export const b = 2;');
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "Initial commit"', { cwd: testDir });
      
      const { stdout: commit1 } = await execAsync('git rev-parse HEAD', { cwd: testDir });
      const mainCommit = commit1.trim();
      
      // Create manifest
      const savedManifest = createEmptyManifest();
      const stats1 = await fs.stat(file1);
      const stats2 = await fs.stat(file2);
      
      savedManifest.files[file1] = {
        filepath: file1,
        lastModified: stats1.mtimeMs,
        chunkCount: 1,
      };
      savedManifest.files[file2] = {
        filepath: file2,
        lastModified: stats2.mtimeMs,
        chunkCount: 1,
      };
      savedManifest.gitState = {
        branch: 'main',
        commit: mainCommit,
        timestamp: Date.now(),
      };
      await manifest.save(savedManifest);
      
      // Create feature branch, delete file2
      await execAsync('git checkout -b feature', { cwd: testDir });
      await fs.unlink(file2);
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "Delete file2"', { cwd: testDir });
      
      const result = await detectChanges(testDir, vectorDB, defaultConfig);
      
      expect(result.reason).toBe('git-state-changed');
      expect(result.deleted).toContain(toRelative(file2));
      expect(result.modified.length).toBe(0);
      expect(result.added.length).toBe(0);
    });

    it('should detect only changed files, not all files, on commit change', async () => {
      // Create initial commit with 5 files
      const files = [];
      for (let i = 1; i <= 5; i++) {
        const file = path.join(testDir, `file${i}.ts`);
        await fs.writeFile(file, `export const v${i} = ${i};`);
        files.push(file);
      }
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "Initial commit"', { cwd: testDir });
      
      const { stdout: commit1 } = await execAsync('git rev-parse HEAD', { cwd: testDir });
      const initialCommit = commit1.trim();
      
      // Create manifest
      const savedManifest = createEmptyManifest();
      for (const file of files) {
        const stats = await fs.stat(file);
        savedManifest.files[file] = {
          filepath: file,
          lastModified: stats.mtimeMs,
          chunkCount: 1,
        };
      }
      savedManifest.gitState = {
        branch: 'main',
        commit: initialCommit,
        timestamp: Date.now(),
      };
      await manifest.save(savedManifest);
      
      // Modify only 1 file
      await fs.writeFile(files[0], 'export const v1 = 100;');
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "Modify file1"', { cwd: testDir });
      
      const result = await detectChanges(testDir, vectorDB, defaultConfig);
      
      expect(result.reason).toBe('git-state-changed');
      expect(result.modified.length).toBe(1); // Only 1 file modified
      expect(result.modified).toContain(toRelative(files[0]));
      expect(result.added.length).toBe(0);
      expect(result.deleted.length).toBe(0);
      // The other 4 files should NOT be detected
      expect(result.modified).not.toContain(toRelative(files[1]));
      expect(result.modified).not.toContain(toRelative(files[2]));
      expect(result.modified).not.toContain(toRelative(files[3]));
      expect(result.modified).not.toContain(toRelative(files[4]));
    });

    it('should fall back to full reindex if git diff fails', async () => {
      // Create initial commit
      const file1 = path.join(testDir, 'file1.ts');
      await fs.writeFile(file1, 'export const a = 1;');
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "Initial"', { cwd: testDir });
      
      // Create manifest with git state but invalid commit
      const savedManifest = createEmptyManifest();
      const stats = await fs.stat(file1);
      
      savedManifest.files[file1] = {
        filepath: file1,
        lastModified: stats.mtimeMs,
        chunkCount: 1,
      };
      savedManifest.gitState = {
        branch: 'main',
        commit: 'invalid-commit-sha-that-does-not-exist', // Invalid
        timestamp: Date.now(),
      };
      await manifest.save(savedManifest);
      
      // Add another file
      const file2 = path.join(testDir, 'file2.ts');
      await fs.writeFile(file2, 'export const b = 2;');
      
      const result = await detectChanges(testDir, vectorDB, defaultConfig);
      
      // Should fall back to full reindex when git diff fails
      expect(result.reason).toBe('git-state-changed');
      expect(result.added.length).toBe(2); // All files treated as added (fallback)
      expect(result.modified.length).toBe(0);
    });

    it('should handle new files not in git but on filesystem', async () => {
      // Create and commit initial file
      const file1 = path.join(testDir, 'file1.ts');
      await fs.writeFile(file1, 'export const a = 1;');
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "Initial commit"', { cwd: testDir });
      
      const { stdout: commit1 } = await execAsync('git rev-parse HEAD', { cwd: testDir });
      const initialCommit = commit1.trim();
      
      // Create manifest
      const savedManifest = createEmptyManifest();
      const stats1 = await fs.stat(file1);
      savedManifest.files[file1] = {
        filepath: file1,
        lastModified: stats1.mtimeMs,
        chunkCount: 1,
      };
      savedManifest.gitState = {
        branch: 'main',
        commit: initialCommit,
        timestamp: Date.now(),
      };
      await manifest.save(savedManifest);
      
      // Create new branch with committed changes
      await execAsync('git checkout -b feature', { cwd: testDir });
      const file2 = path.join(testDir, 'file2.ts');
      await fs.writeFile(file2, 'export const b = 2;');
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "Add file2"', { cwd: testDir });
      
      // Create unstaged file (not in git)
      const file3 = path.join(testDir, 'file3.ts');
      await fs.writeFile(file3, 'export const c = 3;');
      
      const result = await detectChanges(testDir, vectorDB, defaultConfig);
      
      expect(result.reason).toBe('git-state-changed');
      expect(result.added).toContain(toRelative(file2)); // From git diff
      expect(result.added).toContain(toRelative(file3)); // New file not in git or manifest
    });
  });

  describe('Edge cases', () => {
    it('should handle empty project', async () => {
      const result = await detectChanges(testDir, vectorDB, defaultConfig);
      
      expect(result.reason).toBe('full');
      expect(result.added.length).toBe(0);
      expect(result.modified.length).toBe(0);
      expect(result.deleted.length).toBe(0);
    });

    it('should handle manifest with no files', async () => {
      const savedManifest = createEmptyManifest();
      await manifest.save(savedManifest);
      
      const file1 = path.join(testDir, 'file1.ts');
      await fs.writeFile(file1, 'export const a = 1;');
      
      const result = await detectChanges(testDir, vectorDB, defaultConfig);
      
      expect(result.added).toContain(toRelative(file1));
    });
  });
});

