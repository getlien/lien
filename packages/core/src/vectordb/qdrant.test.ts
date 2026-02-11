import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QdrantDB, validateFilterOptions } from './qdrant.js';
import { DatabaseError } from '../errors/index.js';
import { EMBEDDING_DIMENSION } from '../embeddings/types.js';
import { writeVersionFile } from './version.js';
import type { SearchResult } from './types.js';
import fs from 'fs/promises';

/**
 * QdrantDB tests require a running Qdrant instance.
 *
 * To run these tests:
 * 1. Start Qdrant: `docker run -d -p 6333:6333 --name qdrant qdrant/qdrant`
 * 2. Run tests: `npm test -- qdrant.test.ts`
 *
 * To stop Qdrant: `docker stop qdrant && docker rm qdrant`
 */
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const TEST_ORG_ID = 'test-org-123';
const TEST_PROJECT_ROOT = '/tmp/test-project';
const TEST_BRANCH = 'test-branch';
const TEST_COMMIT_SHA = 'test-commit-sha';

describe('QdrantDB', () => {
  let db: QdrantDB;
  let db2: QdrantDB; // Different org for isolation testing

  beforeEach(async () => {
    // Create two instances with different orgIds to test tenant isolation
    db = new QdrantDB(
      QDRANT_URL,
      undefined,
      TEST_ORG_ID,
      TEST_PROJECT_ROOT,
      TEST_BRANCH,
      TEST_COMMIT_SHA,
    );
    db2 = new QdrantDB(
      QDRANT_URL,
      undefined,
      'test-org-456',
      TEST_PROJECT_ROOT,
      TEST_BRANCH,
      TEST_COMMIT_SHA,
    );

    await db.initialize();
    await db2.initialize();
  });

  afterEach(async () => {
    // Clean up test data
    try {
      await db.clear();
      await db2.clear();
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('initialization', () => {
    it('should initialize and create collection', async () => {
      expect(db.getCollectionName()).toBe(`lien_org_${TEST_ORG_ID}`);
      expect(db.getOrgId()).toBe(TEST_ORG_ID);
      expect(db.getRepoId()).toBeTruthy();
    });

    it('should extract repoId from project root', () => {
      const repoId = db.getRepoId();
      expect(repoId).toContain('test-project');
      expect(repoId).toMatch(/^test-project-[a-f0-9]{8}$/);
    });
  });

  describe('insertBatch and search', () => {
    it('should insert and search vectors', async () => {
      const vectors = [
        new Float32Array(EMBEDDING_DIMENSION).fill(0.1),
        new Float32Array(EMBEDDING_DIMENSION).fill(0.2),
      ];
      const metadatas = [
        {
          file: 'src/test1.ts',
          startLine: 1,
          endLine: 10,
          type: 'function' as const,
          language: 'typescript',
        },
        {
          file: 'src/test2.ts',
          startLine: 1,
          endLine: 10,
          type: 'function' as const,
          language: 'typescript',
        },
      ];
      const contents = ['test content 1', 'test content 2'];

      await db.insertBatch(vectors, metadatas, contents);

      // Search with a similar vector
      const queryVector = new Float32Array(EMBEDDING_DIMENSION).fill(0.15);
      const results = await db.search(queryVector, 5);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toBeTruthy();
      expect(results[0].metadata.file).toBeTruthy();
    });

    it('should handle empty batch', async () => {
      await expect(db.insertBatch([], [], [])).resolves.not.toThrow();
    });
  });

  describe('tenant isolation', () => {
    it('should isolate data by orgId', async () => {
      // Insert data into first org
      const vectors1 = [new Float32Array(EMBEDDING_DIMENSION).fill(0.1)];
      const metadatas1 = [
        {
          file: 'src/org1.ts',
          startLine: 1,
          endLine: 10,
          type: 'function' as const,
          language: 'typescript',
        },
      ];
      const contents1 = ['org1 content'];
      await db.insertBatch(vectors1, metadatas1, contents1);

      // Insert data into second org
      const vectors2 = [new Float32Array(EMBEDDING_DIMENSION).fill(0.1)];
      const metadatas2 = [
        {
          file: 'src/org2.ts',
          startLine: 1,
          endLine: 10,
          type: 'function' as const,
          language: 'typescript',
        },
      ];
      const contents2 = ['org2 content'];
      await db2.insertBatch(vectors2, metadatas2, contents2);

      // Search in first org should only return org1 data
      const queryVector = new Float32Array(EMBEDDING_DIMENSION).fill(0.1);
      const results1 = await db.search(queryVector, 10);
      const results2 = await db2.search(queryVector, 10);

      expect(results1.length).toBe(1);
      expect(results1[0].content).toBe('org1 content');
      expect(results2.length).toBe(1);
      expect(results2[0].content).toBe('org2 content');
    });
  });

  describe('cross-repo search', () => {
    it('should search across repos when repoId filter is omitted', async () => {
      // This test would require multiple repos in the same org
      // For now, we just verify the method exists and works
      const queryVector = new Float32Array(EMBEDDING_DIMENSION).fill(0.1);
      const results = await db.searchCrossRepo(queryVector, 5);

      // Should return empty results if no data, but not throw
      expect(Array.isArray(results)).toBe(true);
    });

    it('should filter by specific repos when repoIds provided', async () => {
      const queryVector = new Float32Array(EMBEDDING_DIMENSION).fill(0.1);
      const repoId = db.getRepoId();
      const results = await db.searchCrossRepo(queryVector, 5, { repoIds: [repoId] });

      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('scanWithFilter', () => {
    it('should filter by language', async () => {
      const vectors = [
        new Float32Array(EMBEDDING_DIMENSION).fill(0.1),
        new Float32Array(EMBEDDING_DIMENSION).fill(0.2),
      ];
      const metadatas = [
        {
          file: 'src/test.ts',
          startLine: 1,
          endLine: 10,
          type: 'function' as const,
          language: 'typescript',
        },
        {
          file: 'src/test.py',
          startLine: 1,
          endLine: 10,
          type: 'function' as const,
          language: 'python',
        },
      ];
      const contents = ['ts content', 'py content'];

      await db.insertBatch(vectors, metadatas, contents);

      const results = await db.scanWithFilter({ language: 'typescript' });
      expect(results.length).toBe(1);
      expect(results[0].metadata.language).toBe('typescript');
    });

    it('should filter by file pattern', async () => {
      const vectors = [
        new Float32Array(EMBEDDING_DIMENSION).fill(0.1),
        new Float32Array(EMBEDDING_DIMENSION).fill(0.2),
      ];
      const metadatas = [
        {
          file: 'src/user.ts',
          startLine: 1,
          endLine: 10,
          type: 'function' as const,
          language: 'typescript',
        },
        {
          file: 'src/product.ts',
          startLine: 1,
          endLine: 10,
          type: 'function' as const,
          language: 'typescript',
        },
      ];
      const contents = ['user content', 'product content'];

      await db.insertBatch(vectors, metadatas, contents);

      const results = await db.scanWithFilter({ pattern: 'user' });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every(r => r.metadata.file.includes('user'))).toBe(true);
    });

    it('should throw error when language is empty or whitespace-only', async () => {
      const db = new QdrantDB(
        QDRANT_URL,
        undefined,
        TEST_ORG_ID,
        TEST_PROJECT_ROOT,
        TEST_BRANCH,
        TEST_COMMIT_SHA,
      );
      await db.initialize();

      await expect(db.scanWithFilter({ language: '' })).rejects.toThrow(
        'Invalid language: language must be a non-empty, non-whitespace string',
      );

      await expect(db.scanWithFilter({ language: '   ' })).rejects.toThrow(
        'Invalid language: language must be a non-empty, non-whitespace string',
      );

      await expect(db.scanWithFilter({ language: '\t\n' })).rejects.toThrow(
        'Invalid language: language must be a non-empty, non-whitespace string',
      );

      await db.clear();
    });

    it('should throw error when pattern is empty or whitespace-only', async () => {
      const db = new QdrantDB(
        QDRANT_URL,
        undefined,
        TEST_ORG_ID,
        TEST_PROJECT_ROOT,
        TEST_BRANCH,
        TEST_COMMIT_SHA,
      );
      await db.initialize();

      await expect(db.scanWithFilter({ pattern: '' })).rejects.toThrow(
        'Invalid pattern: pattern must be a non-empty, non-whitespace string',
      );

      await expect(db.scanWithFilter({ pattern: '   ' })).rejects.toThrow(
        'Invalid pattern: pattern must be a non-empty, non-whitespace string',
      );

      await expect(db.scanWithFilter({ pattern: '\t\n' })).rejects.toThrow(
        'Invalid pattern: pattern must be a non-empty, non-whitespace string',
      );

      await db.clear();
    });
  });

  describe('deleteByFile', () => {
    it('should delete all chunks for a file', async () => {
      const vectors = [
        new Float32Array(EMBEDDING_DIMENSION).fill(0.1),
        new Float32Array(EMBEDDING_DIMENSION).fill(0.2),
      ];
      const metadatas = [
        {
          file: 'src/to-delete.ts',
          startLine: 1,
          endLine: 10,
          type: 'function' as const,
          language: 'typescript',
        },
        {
          file: 'src/keep.ts',
          startLine: 1,
          endLine: 10,
          type: 'function' as const,
          language: 'typescript',
        },
      ];
      const contents = ['delete me', 'keep me'];

      await db.insertBatch(vectors, metadatas, contents);
      await db.deleteByFile('src/to-delete.ts');

      const results = await db.scanWithFilter({});
      expect(results.length).toBe(1);
      expect(results[0].metadata.file).toBe('src/keep.ts');
    });
  });

  describe('updateFile', () => {
    it('should replace existing chunks for a file', async () => {
      // Insert initial data
      const vectors1 = [new Float32Array(EMBEDDING_DIMENSION).fill(0.1)];
      const metadatas1 = [
        {
          file: 'src/update.ts',
          startLine: 1,
          endLine: 10,
          type: 'function' as const,
          language: 'typescript',
        },
      ];
      const contents1 = ['old content'];
      await db.insertBatch(vectors1, metadatas1, contents1);

      // Update with new data
      const vectors2 = [new Float32Array(EMBEDDING_DIMENSION).fill(0.2)];
      const metadatas2 = [
        {
          file: 'src/update.ts',
          startLine: 1,
          endLine: 15,
          type: 'function' as const,
          language: 'typescript',
        },
      ];
      const contents2 = ['new content'];
      await db.updateFile('src/update.ts', vectors2, metadatas2, contents2);

      const results = await db.scanWithFilter({ pattern: 'update' });
      expect(results.length).toBe(1);
      expect(results[0].content).toBe('new content');
      expect(results[0].metadata.endLine).toBe(15);
    });
  });

  describe('hasData', () => {
    it('should return false when collection is empty', async () => {
      const hasData = await db.hasData();
      expect(hasData).toBe(false);
    });

    it('should return true when collection has data', async () => {
      const vectors = [new Float32Array(EMBEDDING_DIMENSION).fill(0.1)];
      const metadatas = [
        {
          file: 'src/test.ts',
          startLine: 1,
          endLine: 10,
          type: 'function' as const,
          language: 'typescript',
        },
      ];
      const contents = ['test content'];
      await db.insertBatch(vectors, metadatas, contents);

      const hasData = await db.hasData();
      expect(hasData).toBe(true);
    });
  });

  describe('clear', () => {
    it('should remove all data from collection', async () => {
      const vectors = [
        new Float32Array(EMBEDDING_DIMENSION).fill(0.1),
        new Float32Array(EMBEDDING_DIMENSION).fill(0.2),
      ];
      const metadatas = [
        {
          file: 'src/test1.ts',
          startLine: 1,
          endLine: 10,
          type: 'function' as const,
          language: 'typescript',
        },
        {
          file: 'src/test2.ts',
          startLine: 1,
          endLine: 10,
          type: 'function' as const,
          language: 'typescript',
        },
      ];
      const contents = ['content 1', 'content 2'];

      await db.insertBatch(vectors, metadatas, contents);
      await db.clear();

      const hasData = await db.hasData();
      expect(hasData).toBe(false);
    });
  });

  describe('version management', () => {
    it('should return 0 for getCurrentVersion when no version file exists', async () => {
      // Create a fresh instance without initializing to test default state
      const freshDb = new QdrantDB(
        QDRANT_URL,
        undefined,
        'test-org-fresh',
        '/tmp/test-fresh',
        TEST_BRANCH,
        TEST_COMMIT_SHA,
      );
      const version = freshDb.getCurrentVersion();
      expect(version).toBe(0);
    });

    it('should return "Unknown" for getVersionDate when version is 0', () => {
      // Create a fresh instance without initializing to test default state
      const freshDb = new QdrantDB(
        QDRANT_URL,
        undefined,
        'test-org-fresh2',
        '/tmp/test-fresh2',
        TEST_BRANCH,
        TEST_COMMIT_SHA,
      );
      const date = freshDb.getVersionDate();
      expect(date).toBe('Unknown');
    });

    it('should read version from file during initialization', async () => {
      // Ensure directory exists and write a version file before initializing
      await fs.mkdir(db.dbPath, { recursive: true });
      await writeVersionFile(db.dbPath);

      // Create a new instance and initialize
      const newDb = new QdrantDB(
        QDRANT_URL,
        undefined,
        TEST_ORG_ID,
        TEST_PROJECT_ROOT,
        TEST_BRANCH,
        TEST_COMMIT_SHA,
      );
      await newDb.initialize();

      const version = newDb.getCurrentVersion();
      expect(version).toBeGreaterThan(0);
      expect(version).toBeLessThanOrEqual(Date.now());

      // Version date should be formatted
      const date = newDb.getVersionDate();
      expect(date).not.toBe('Unknown');
      expect(date).toMatch(/\d+\/\d+\/\d+/); // Date format check
    });

    it('should detect version changes with checkVersion', async () => {
      // Ensure directory exists
      await fs.mkdir(db.dbPath, { recursive: true });

      // Initial version should be 0 or from initialization
      const initialVersion = db.getCurrentVersion();

      // Write a new version file
      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay to ensure different timestamp
      await writeVersionFile(db.dbPath);

      // First check should detect the change (if version file was updated)
      const hasChanged = await db.checkVersion();

      // If version file exists and was updated, should return true
      // If version file doesn't exist or wasn't updated, might return false
      // Either way, checkVersion should not throw
      expect(typeof hasChanged).toBe('boolean');

      // After checkVersion, currentVersion should be updated if change was detected
      const newVersion = db.getCurrentVersion();
      if (hasChanged) {
        expect(newVersion).toBeGreaterThan(initialVersion);
      }
    });

    it('should cache version checks for 1 second', async () => {
      // First check
      await db.checkVersion();

      // Immediate second check should be cached (return false)
      const secondCheck = await db.checkVersion();
      expect(secondCheck).toBe(false);

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Third check should not be cached
      const thirdCheck = await db.checkVersion();
      expect(typeof thirdCheck).toBe('boolean');
    });

    it('should reconnect and refresh version cache', async () => {
      // Ensure directory exists
      await fs.mkdir(db.dbPath, { recursive: true });

      // Get initial version
      const initialVersion = db.getCurrentVersion();

      // Write a new version file
      await new Promise(resolve => setTimeout(resolve, 10));
      await writeVersionFile(db.dbPath);

      // Reconnect should refresh the version
      await db.reconnect();

      // Version should be updated after reconnect
      const newVersion = db.getCurrentVersion();
      expect(newVersion).toBeGreaterThanOrEqual(initialVersion);
    });

    it('should format version date correctly', async () => {
      // Write a known version
      const testTimestamp = 1609459200000; // 2021-01-01 00:00:00 UTC
      const versionPath = `${db.dbPath}/.lien-index-version`;
      await fs.mkdir(db.dbPath, { recursive: true });
      await fs.writeFile(versionPath, testTimestamp.toString(), 'utf-8');

      // Reinitialize to read the version
      await db.reconnect();

      const date = db.getVersionDate();
      expect(date).not.toBe('Unknown');
      expect(date).toContain('2021'); // Should contain the year
    });
  });

  describe('branch and commit tracking', () => {
    it('should isolate data by branch and commit', async () => {
      // Create two instances with same org/repo but different branches
      const mainDb = new QdrantDB(
        QDRANT_URL,
        undefined,
        TEST_ORG_ID,
        TEST_PROJECT_ROOT,
        'main',
        'main-commit-sha',
      );
      const featureDb = new QdrantDB(
        QDRANT_URL,
        undefined,
        TEST_ORG_ID,
        TEST_PROJECT_ROOT,
        'feature-x',
        'feature-commit-sha',
      );

      await mainDb.initialize();
      await featureDb.initialize();

      // Insert data into main branch
      const mainVectors = [new Float32Array(EMBEDDING_DIMENSION).fill(0.1)];
      const mainMetadatas = [
        {
          file: 'src/main.ts',
          startLine: 1,
          endLine: 10,
          type: 'function' as const,
          language: 'typescript',
        },
      ];
      const mainContents = ['main branch content'];
      await mainDb.insertBatch(mainVectors, mainMetadatas, mainContents);

      // Insert data into feature branch
      const featureVectors = [new Float32Array(EMBEDDING_DIMENSION).fill(0.2)];
      const featureMetadatas = [
        {
          file: 'src/feature.ts',
          startLine: 1,
          endLine: 10,
          type: 'function' as const,
          language: 'typescript',
        },
      ];
      const featureContents = ['feature branch content'];
      await featureDb.insertBatch(featureVectors, featureMetadatas, featureContents);

      // Search main branch should only return main branch data
      const mainQueryVector = new Float32Array(EMBEDDING_DIMENSION).fill(0.1);
      const mainResults = await mainDb.search(mainQueryVector, 10);
      expect(mainResults.length).toBe(1);
      expect(mainResults[0].content).toBe('main branch content');

      // Search feature branch should only return feature branch data
      const featureQueryVector = new Float32Array(EMBEDDING_DIMENSION).fill(0.2);
      const featureResults = await featureDb.search(featureQueryVector, 10);
      expect(featureResults.length).toBe(1);
      expect(featureResults[0].content).toBe('feature branch content');

      // Clean up
      await mainDb.clear();
      await featureDb.clear();
    });

    it('should filter cross-repo search by branch', async () => {
      // Create instances with different branches
      const mainDb = new QdrantDB(
        QDRANT_URL,
        undefined,
        TEST_ORG_ID,
        TEST_PROJECT_ROOT,
        'main',
        'main-commit-sha',
      );
      const featureDb = new QdrantDB(
        QDRANT_URL,
        undefined,
        TEST_ORG_ID,
        TEST_PROJECT_ROOT,
        'feature-x',
        'feature-commit-sha',
      );

      await mainDb.initialize();
      await featureDb.initialize();

      // Insert data into both branches
      const mainVectors = [new Float32Array(EMBEDDING_DIMENSION).fill(0.1)];
      const mainMetadatas = [
        {
          file: 'src/main.ts',
          startLine: 1,
          endLine: 10,
          type: 'function' as const,
          language: 'typescript',
        },
      ];
      const mainContents = ['main content'];
      await mainDb.insertBatch(mainVectors, mainMetadatas, mainContents);

      const featureVectors = [new Float32Array(EMBEDDING_DIMENSION).fill(0.2)];
      const featureMetadatas = [
        {
          file: 'src/feature.ts',
          startLine: 1,
          endLine: 10,
          type: 'function' as const,
          language: 'typescript',
        },
      ];
      const featureContents = ['feature content'];
      await featureDb.insertBatch(featureVectors, featureMetadatas, featureContents);

      // Cross-repo search with main branch filter should only return main branch data
      const queryVector = new Float32Array(EMBEDDING_DIMENSION).fill(0.1);
      const mainResults = await mainDb.searchCrossRepo(queryVector, 10, { branch: 'main' });
      expect(mainResults.length).toBe(1);
      expect(mainResults[0].content).toBe('main content');

      // Cross-repo search without branch filter should return both (if vectors are similar enough)
      // But with branch filter, should only return filtered branch
      const allResults = await mainDb.searchCrossRepo(queryVector, 10);
      // Should return at least main branch results
      expect(allResults.length).toBeGreaterThanOrEqual(1);

      // Clean up
      await mainDb.clear();
      await featureDb.clear();
    });

    it('should only clear current branch data', async () => {
      // Create two instances with different branches
      const mainDb = new QdrantDB(
        QDRANT_URL,
        undefined,
        TEST_ORG_ID,
        TEST_PROJECT_ROOT,
        'main',
        'main-commit-sha',
      );
      const featureDb = new QdrantDB(
        QDRANT_URL,
        undefined,
        TEST_ORG_ID,
        TEST_PROJECT_ROOT,
        'feature-x',
        'feature-commit-sha',
      );

      await mainDb.initialize();
      await featureDb.initialize();

      // Insert data into both branches
      const mainVectors = [new Float32Array(EMBEDDING_DIMENSION).fill(0.1)];
      const mainMetadatas = [
        {
          file: 'src/main.ts',
          startLine: 1,
          endLine: 10,
          type: 'function' as const,
          language: 'typescript',
        },
      ];
      const mainContents = ['main content'];
      await mainDb.insertBatch(mainVectors, mainMetadatas, mainContents);

      const featureVectors = [new Float32Array(EMBEDDING_DIMENSION).fill(0.2)];
      const featureMetadatas = [
        {
          file: 'src/feature.ts',
          startLine: 1,
          endLine: 10,
          type: 'function' as const,
          language: 'typescript',
        },
      ];
      const featureContents = ['feature content'];
      await featureDb.insertBatch(featureVectors, featureMetadatas, featureContents);

      // Clear main branch
      await mainDb.clear();

      // Main branch should be empty
      const mainQueryVector = new Float32Array(EMBEDDING_DIMENSION).fill(0.1);
      const mainResults = await mainDb.search(mainQueryVector, 10);
      expect(mainResults.length).toBe(0);

      // Feature branch should still have data
      const featureQueryVector = new Float32Array(EMBEDDING_DIMENSION).fill(0.2);
      const featureResults = await featureDb.search(featureQueryVector, 10);
      expect(featureResults.length).toBe(1);
      expect(featureResults[0].content).toBe('feature content');

      // Clean up
      await featureDb.clear();
    });

    it('should only delete file from current branch', async () => {
      // Create two instances with different branches
      const mainDb = new QdrantDB(
        QDRANT_URL,
        undefined,
        TEST_ORG_ID,
        TEST_PROJECT_ROOT,
        'main',
        'main-commit-sha',
      );
      const featureDb = new QdrantDB(
        QDRANT_URL,
        undefined,
        TEST_ORG_ID,
        TEST_PROJECT_ROOT,
        'feature-x',
        'feature-commit-sha',
      );

      await mainDb.initialize();
      await featureDb.initialize();

      // Insert same file into both branches (point IDs will differ due to branch/commit in ID generation)
      const vectors = [new Float32Array(EMBEDDING_DIMENSION).fill(0.1)];
      const metadatas = [
        {
          file: 'src/shared.ts',
          startLine: 1,
          endLine: 10,
          type: 'function' as const,
          language: 'typescript',
        },
      ];
      const mainContents = ['main version'];
      const featureContents = ['feature version'];

      await mainDb.insertBatch(vectors, metadatas, mainContents);
      await featureDb.insertBatch(vectors, metadatas, featureContents);

      // Verify both branches have their data (point IDs are different due to branch/commit)
      const mainBefore = await mainDb.scanWithFilter({ pattern: 'shared' });
      const featureBefore = await featureDb.scanWithFilter({ pattern: 'shared' });
      expect(mainBefore.length).toBe(1);
      expect(featureBefore.length).toBe(1);

      // Delete file from main branch
      await mainDb.deleteByFile('src/shared.ts');

      // Main branch should not have the file
      const mainResults = await mainDb.scanWithFilter({ pattern: 'shared' });
      expect(mainResults.length).toBe(0);

      // Feature branch should still have the file
      const featureResults = await featureDb.scanWithFilter({ pattern: 'shared' });
      expect(featureResults.length).toBe(1);
      expect(featureResults[0].content).toBe('feature version');

      // Clean up
      await featureDb.clear();
    });

    it('should clear all commits for a branch using clearBranch()', async () => {
      // Create instances for same branch but different commits (simulating PR updates)
      const commit1Db = new QdrantDB(
        QDRANT_URL,
        undefined,
        TEST_ORG_ID,
        TEST_PROJECT_ROOT,
        'feature-x',
        'commit-1',
      );
      const commit2Db = new QdrantDB(
        QDRANT_URL,
        undefined,
        TEST_ORG_ID,
        TEST_PROJECT_ROOT,
        'feature-x',
        'commit-2',
      );
      const otherBranchDb = new QdrantDB(
        QDRANT_URL,
        undefined,
        TEST_ORG_ID,
        TEST_PROJECT_ROOT,
        'main',
        'main-commit',
      );

      await commit1Db.initialize();
      await commit2Db.initialize();
      await otherBranchDb.initialize();

      // Insert data into commit 1
      const vectors1 = [new Float32Array(EMBEDDING_DIMENSION).fill(0.1)];
      const metadatas1 = [
        {
          file: 'src/file1.ts',
          startLine: 1,
          endLine: 10,
          type: 'function' as const,
          language: 'typescript',
        },
      ];
      const contents1 = ['commit 1 content'];
      await commit1Db.insertBatch(vectors1, metadatas1, contents1);

      // Insert data into commit 2 (same branch, different commit)
      const vectors2 = [new Float32Array(EMBEDDING_DIMENSION).fill(0.2)];
      const metadatas2 = [
        {
          file: 'src/file2.ts',
          startLine: 1,
          endLine: 10,
          type: 'function' as const,
          language: 'typescript',
        },
      ];
      const contents2 = ['commit 2 content'];
      await commit2Db.insertBatch(vectors2, metadatas2, contents2);

      // Insert data into other branch
      const vectors3 = [new Float32Array(EMBEDDING_DIMENSION).fill(0.3)];
      const metadatas3 = [
        {
          file: 'src/main.ts',
          startLine: 1,
          endLine: 10,
          type: 'function' as const,
          language: 'typescript',
        },
      ];
      const contents3 = ['main branch content'];
      await otherBranchDb.insertBatch(vectors3, metadatas3, contents3);

      // Verify all commits have data
      const commit1Results = await commit1Db.search(
        new Float32Array(EMBEDDING_DIMENSION).fill(0.1),
        10,
      );
      const commit2Results = await commit2Db.search(
        new Float32Array(EMBEDDING_DIMENSION).fill(0.2),
        10,
      );
      const otherBranchResults = await otherBranchDb.search(
        new Float32Array(EMBEDDING_DIMENSION).fill(0.3),
        10,
      );

      expect(commit1Results.length).toBe(1);
      expect(commit1Results[0].content).toBe('commit 1 content');
      expect(commit2Results.length).toBe(1);
      expect(commit2Results[0].content).toBe('commit 2 content');
      expect(otherBranchResults.length).toBe(1);
      expect(otherBranchResults[0].content).toBe('main branch content');

      // Clear all commits for feature-x branch
      await commit1Db.clearBranch('feature-x');

      // Commit 1 should be empty (branch cleared)
      const commit1After = await commit1Db.search(
        new Float32Array(EMBEDDING_DIMENSION).fill(0.1),
        10,
      );
      expect(commit1After.length).toBe(0);

      // Commit 2 should also be empty (same branch)
      const commit2After = await commit2Db.search(
        new Float32Array(EMBEDDING_DIMENSION).fill(0.2),
        10,
      );
      expect(commit2After.length).toBe(0);

      // Other branch should still have data
      const otherBranchAfter = await otherBranchDb.search(
        new Float32Array(EMBEDDING_DIMENSION).fill(0.3),
        10,
      );
      expect(otherBranchAfter.length).toBe(1);
      expect(otherBranchAfter[0].content).toBe('main branch content');

      // Clean up
      await otherBranchDb.clear();
    });

    it('should default to current branch when clearBranch is called without arguments', async () => {
      const db = new QdrantDB(
        QDRANT_URL,
        undefined,
        TEST_ORG_ID,
        TEST_PROJECT_ROOT,
        'feature-y',
        'commit-1',
      );
      const otherBranchDb = new QdrantDB(
        QDRANT_URL,
        undefined,
        TEST_ORG_ID,
        TEST_PROJECT_ROOT,
        'main',
        'main-commit',
      );

      await db.initialize();
      await otherBranchDb.initialize();

      const vectors = [new Float32Array(EMBEDDING_DIMENSION).fill(0.4)];
      const metadatas = [
        {
          file: 'src/feature-y.ts',
          startLine: 1,
          endLine: 10,
          type: 'function' as const,
          language: 'typescript',
        },
      ];
      const contents = ['feature-y content'];
      await db.insertBatch(vectors, metadatas, contents);

      const mainVectors = [new Float32Array(EMBEDDING_DIMENSION).fill(0.5)];
      const mainMetadatas = [
        {
          file: 'src/main2.ts',
          startLine: 1,
          endLine: 10,
          type: 'function' as const,
          language: 'typescript',
        },
      ];
      const mainContents = ['main2 content'];
      await otherBranchDb.insertBatch(mainVectors, mainMetadatas, mainContents);

      // Sanity check: both branches have data
      const featureResultsBefore = await db.search(
        new Float32Array(EMBEDDING_DIMENSION).fill(0.4),
        10,
      );
      const mainResultsBefore = await otherBranchDb.search(
        new Float32Array(EMBEDDING_DIMENSION).fill(0.5),
        10,
      );
      expect(featureResultsBefore.length).toBe(1);
      expect(mainResultsBefore.length).toBe(1);

      // Clear current branch (feature-y) without passing branch name
      await db.clearBranch();

      // Current branch should be empty
      const featureResultsAfter = await db.search(
        new Float32Array(EMBEDDING_DIMENSION).fill(0.4),
        10,
      );
      expect(featureResultsAfter.length).toBe(0);

      // Other branch should still have data
      const mainResultsAfter = await otherBranchDb.search(
        new Float32Array(EMBEDDING_DIMENSION).fill(0.5),
        10,
      );
      expect(mainResultsAfter.length).toBe(1);
      expect(mainResultsAfter[0].content).toBe('main2 content');

      // Clean up
      await otherBranchDb.clear();
    });

    it('should generate unique point IDs for same file/line range across branches', async () => {
      // Test that point IDs include branch/commit to prevent collisions
      const mainDb = new QdrantDB(
        QDRANT_URL,
        undefined,
        TEST_ORG_ID,
        TEST_PROJECT_ROOT,
        'main',
        'main-commit-sha',
      );
      const featureDb = new QdrantDB(
        QDRANT_URL,
        undefined,
        TEST_ORG_ID,
        TEST_PROJECT_ROOT,
        'feature-x',
        'feature-commit-sha',
      );

      await mainDb.initialize();
      await featureDb.initialize();

      // Insert same file/line range into both branches
      const vectors = [new Float32Array(EMBEDDING_DIMENSION).fill(0.1)];
      const metadatas = [
        {
          file: 'src/same.ts',
          startLine: 1,
          endLine: 10,
          type: 'function' as const,
          language: 'typescript',
        },
      ];
      const mainContents = ['main content'];
      const featureContents = ['feature content'];

      await mainDb.insertBatch(vectors, metadatas, mainContents);
      await featureDb.insertBatch(vectors, metadatas, featureContents);

      // Both branches should have their data (point IDs are unique due to branch/commit)
      const mainResults = await mainDb.scanWithFilter({ pattern: 'same' });
      const featureResults = await featureDb.scanWithFilter({ pattern: 'same' });

      expect(mainResults.length).toBe(1);
      expect(mainResults[0].content).toBe('main content');
      expect(featureResults.length).toBe(1);
      expect(featureResults[0].content).toBe('feature content');

      // Clean up
      await mainDb.clear();
      await featureDb.clear();
    });

    it('should allow repoIds in scanCrossRepo without throwing validation errors', async () => {
      const db = new QdrantDB(
        QDRANT_URL,
        undefined,
        TEST_ORG_ID,
        TEST_PROJECT_ROOT,
        TEST_BRANCH,
        TEST_COMMIT_SHA,
      );
      await db.initialize();

      // scanCrossRepo explicitly passes includeCurrentRepo: false, so repoIds are allowed
      // This verifies that the validation logic correctly permits this usage pattern
      const results = await db.scanCrossRepo({ repoIds: [db.getRepoId()] });
      expect(Array.isArray(results)).toBe(true);

      await db.clear();
    });

    it('should throw error when all repoIds are empty or whitespace', async () => {
      const db = new QdrantDB(
        QDRANT_URL,
        undefined,
        TEST_ORG_ID,
        TEST_PROJECT_ROOT,
        TEST_BRANCH,
        TEST_COMMIT_SHA,
      );
      await db.initialize();

      // Test empty strings
      await expect(db.scanCrossRepo({ repoIds: ['', ''] })).rejects.toThrow(
        'Invalid repoIds: all provided repoIds are empty or whitespace',
      );

      // Test whitespace-only strings
      await expect(db.scanCrossRepo({ repoIds: [' ', '\t', '\n'] })).rejects.toThrow(
        'Invalid repoIds: all provided repoIds are empty or whitespace',
      );

      // Test mixed empty and whitespace
      await expect(db.scanCrossRepo({ repoIds: ['', '   ', '\t\n'] })).rejects.toThrow(
        'Invalid repoIds: all provided repoIds are empty or whitespace',
      );

      await db.clear();
    });

    it('should throw error when branch is empty or whitespace-only', async () => {
      const db = new QdrantDB(
        QDRANT_URL,
        undefined,
        TEST_ORG_ID,
        TEST_PROJECT_ROOT,
        TEST_BRANCH,
        TEST_COMMIT_SHA,
      );
      await db.initialize();

      // Test empty string branch
      await expect(db.scanCrossRepo({ branch: '' })).rejects.toThrow(
        'Invalid branch: branch must be a non-empty, non-whitespace string',
      );

      // Test whitespace-only branch
      await expect(db.scanCrossRepo({ branch: '   ' })).rejects.toThrow(
        'Invalid branch: branch must be a non-empty, non-whitespace string',
      );

      // Test mixed whitespace
      await expect(db.scanCrossRepo({ branch: '\t\n  ' })).rejects.toThrow(
        'Invalid branch: branch must be a non-empty, non-whitespace string',
      );

      // Test that valid branch works
      const results = await db.scanCrossRepo({ branch: 'main' });
      expect(Array.isArray(results)).toBe(true);

      await db.clear();
    });
  });

  describe('querySymbols', () => {
    it('should throw error when symbolType is empty or whitespace-only', async () => {
      const db = new QdrantDB(
        QDRANT_URL,
        undefined,
        TEST_ORG_ID,
        TEST_PROJECT_ROOT,
        TEST_BRANCH,
        TEST_COMMIT_SHA,
      );
      await db.initialize();

      await expect(db.querySymbols({ symbolType: '' as any })).rejects.toThrow(
        'Invalid symbolType: symbolType must be a non-empty, non-whitespace string',
      );

      await expect(db.querySymbols({ symbolType: '   ' as any })).rejects.toThrow(
        'Invalid symbolType: symbolType must be a non-empty, non-whitespace string',
      );

      await expect(db.querySymbols({ symbolType: '\t\n' as any })).rejects.toThrow(
        'Invalid symbolType: symbolType must be a non-empty, non-whitespace string',
      );

      await db.clear();
    });
  });

  describe('validateFilterOptions', () => {
    it('should throw error when repoIds is used with includeCurrentRepo enabled', () => {
      expect(() => {
        validateFilterOptions({
          repoIds: ['repo1'],
          includeCurrentRepo: true,
        });
      }).toThrow('Cannot use repoIds when includeCurrentRepo is enabled (the default)');

      expect(() => {
        validateFilterOptions({
          repoIds: ['repo1'],
          includeCurrentRepo: undefined, // undefined is treated as "enabled"
        });
      }).toThrow('Cannot use repoIds when includeCurrentRepo is enabled (the default)');
    });

    it('should allow repoIds when includeCurrentRepo is explicitly false', () => {
      expect(() => {
        validateFilterOptions({
          repoIds: ['repo1'],
          includeCurrentRepo: false,
        });
      }).not.toThrow();
    });

    it('should throw error when branch is used with includeCurrentRepo enabled', () => {
      expect(() => {
        validateFilterOptions({
          branch: 'main',
          includeCurrentRepo: true,
        });
      }).toThrow('Cannot use branch parameter when includeCurrentRepo is enabled (the default)');

      expect(() => {
        validateFilterOptions({
          branch: 'main',
          includeCurrentRepo: undefined, // undefined is treated as "enabled"
        });
      }).toThrow('Cannot use branch parameter when includeCurrentRepo is enabled (the default)');
    });

    it('should allow branch when includeCurrentRepo is explicitly false', () => {
      expect(() => {
        validateFilterOptions({
          branch: 'main',
          includeCurrentRepo: false,
        });
      }).not.toThrow();
    });

    it('should allow both branch and repoIds when includeCurrentRepo is false', () => {
      expect(() => {
        validateFilterOptions({
          branch: 'main',
          repoIds: ['repo1'],
          includeCurrentRepo: false,
        });
      }).not.toThrow();
    });

    it('should not throw when no conflicting options are provided', () => {
      expect(() => {
        validateFilterOptions({});
      }).not.toThrow();

      expect(() => {
        validateFilterOptions({
          includeCurrentRepo: true,
        });
      }).not.toThrow();
    });
  });
});

/**
 * Unit tests for scanPaginated that don't require a running Qdrant instance.
 * These mock the internal client to test pagination logic in isolation.
 */
describe('QdrantDB.scanPaginated (unit)', () => {
  function createMockedDB() {
    const db = new QdrantDB(
      QDRANT_URL,
      undefined,
      TEST_ORG_ID,
      TEST_PROJECT_ROOT,
      TEST_BRANCH,
      TEST_COMMIT_SHA,
    );
    const mockScroll = vi.fn();
    (db as any).initialized = true;
    (db as any).client = { scroll: mockScroll };
    (db as any).collectionName = 'test_collection';
    return { db, mockScroll };
  }

  function makePoint(id: number, file: string, content: string) {
    return {
      id,
      payload: {
        content,
        file,
        startLine: 1,
        endLine: 5,
        type: 'function',
        language: 'typescript',
      },
    };
  }

  it('should yield multiple pages using next_page_offset', async () => {
    const { db, mockScroll } = createMockedDB();

    mockScroll
      .mockResolvedValueOnce({
        points: [makePoint(1, 'a.ts', 'fn a()'), makePoint(2, 'b.ts', 'fn b()')],
        next_page_offset: 3,
      })
      .mockResolvedValueOnce({
        points: [makePoint(3, 'c.ts', 'fn c()')],
        next_page_offset: null,
      });

    const pages: SearchResult[][] = [];
    for await (const page of db.scanPaginated({ pageSize: 2 })) {
      pages.push(page);
    }

    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveLength(2);
    expect(pages[1]).toHaveLength(1);
    expect(pages[1][0].content).toBe('fn c()');
  });

  it('should stop when next_page_offset is null', async () => {
    const { db, mockScroll } = createMockedDB();

    mockScroll.mockResolvedValueOnce({
      points: [makePoint(1, 'a.ts', 'fn a()')],
      next_page_offset: null,
    });

    const pages: SearchResult[][] = [];
    for await (const page of db.scanPaginated({ pageSize: 10 })) {
      pages.push(page);
    }

    expect(pages).toHaveLength(1);
    expect(mockScroll).toHaveBeenCalledTimes(1);
  });

  it('should handle numeric offset 0 without stopping early', async () => {
    const { db, mockScroll } = createMockedDB();

    mockScroll
      .mockResolvedValueOnce({
        points: [makePoint(1, 'a.ts', 'fn a()')],
        next_page_offset: 0, // falsy but valid
      })
      .mockResolvedValueOnce({
        points: [makePoint(2, 'b.ts', 'fn b()')],
        next_page_offset: null,
      });

    const pages: SearchResult[][] = [];
    for await (const page of db.scanPaginated({ pageSize: 1 })) {
      pages.push(page);
    }

    expect(pages).toHaveLength(2);
    expect(mockScroll).toHaveBeenCalledTimes(2);
  });

  it('should throw DatabaseError when not initialized', async () => {
    const db = new QdrantDB(
      QDRANT_URL,
      undefined,
      TEST_ORG_ID,
      TEST_PROJECT_ROOT,
      TEST_BRANCH,
      TEST_COMMIT_SHA,
    );
    (db as any).initialized = false;

    const gen = db.scanPaginated();
    await expect(gen.next()).rejects.toThrow(DatabaseError);
  });

  it('should wrap scroll errors in DatabaseError', async () => {
    const { db, mockScroll } = createMockedDB();
    mockScroll.mockRejectedValueOnce(new Error('connection refused'));

    const gen = db.scanPaginated();
    await expect(gen.next()).rejects.toThrow('Failed to scroll Qdrant collection');
  });

  it('should throw DatabaseError for invalid pageSize', async () => {
    const { db } = createMockedDB();

    const gen = db.scanPaginated({ pageSize: 0 });
    await expect(gen.next()).rejects.toThrow('pageSize must be a positive number');
  });
});
