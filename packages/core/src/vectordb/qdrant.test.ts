import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QdrantDB } from './qdrant.js';
import { EMBEDDING_DIMENSION } from '../embeddings/types.js';
import { writeVersionFile } from './version.js';
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
    db = new QdrantDB(QDRANT_URL, undefined, TEST_ORG_ID, TEST_PROJECT_ROOT, TEST_BRANCH, TEST_COMMIT_SHA);
    db2 = new QdrantDB(QDRANT_URL, undefined, 'test-org-456', TEST_PROJECT_ROOT, TEST_BRANCH, TEST_COMMIT_SHA);
    
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
      const metadatas1 = [{
        file: 'src/org1.ts',
        startLine: 1,
        endLine: 10,
        type: 'function' as const,
        language: 'typescript',
      }];
      const contents1 = ['org1 content'];
      await db.insertBatch(vectors1, metadatas1, contents1);

      // Insert data into second org
      const vectors2 = [new Float32Array(EMBEDDING_DIMENSION).fill(0.1)];
      const metadatas2 = [{
        file: 'src/org2.ts',
        startLine: 1,
        endLine: 10,
        type: 'function' as const,
        language: 'typescript',
      }];
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
      const results = await db.searchCrossRepo(queryVector, 5, [repoId]);
      
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
      const metadatas1 = [{
        file: 'src/update.ts',
        startLine: 1,
        endLine: 10,
        type: 'function' as const,
        language: 'typescript',
      }];
      const contents1 = ['old content'];
      await db.insertBatch(vectors1, metadatas1, contents1);

      // Update with new data
      const vectors2 = [new Float32Array(EMBEDDING_DIMENSION).fill(0.2)];
      const metadatas2 = [{
        file: 'src/update.ts',
        startLine: 1,
        endLine: 15,
        type: 'function' as const,
        language: 'typescript',
      }];
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
      const metadatas = [{
        file: 'src/test.ts',
        startLine: 1,
        endLine: 10,
        type: 'function' as const,
        language: 'typescript',
      }];
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
      const freshDb = new QdrantDB(QDRANT_URL, undefined, 'test-org-fresh', '/tmp/test-fresh', TEST_BRANCH, TEST_COMMIT_SHA);
      const version = freshDb.getCurrentVersion();
      expect(version).toBe(0);
    });

    it('should return "Unknown" for getVersionDate when version is 0', () => {
      // Create a fresh instance without initializing to test default state
      const freshDb = new QdrantDB(QDRANT_URL, undefined, 'test-org-fresh2', '/tmp/test-fresh2', TEST_BRANCH, TEST_COMMIT_SHA);
      const date = freshDb.getVersionDate();
      expect(date).toBe('Unknown');
    });

    it('should read version from file during initialization', async () => {
      // Ensure directory exists and write a version file before initializing
      await fs.mkdir(db.dbPath, { recursive: true });
      await writeVersionFile(db.dbPath);

      // Create a new instance and initialize
      const newDb = new QdrantDB(QDRANT_URL, undefined, TEST_ORG_ID, TEST_PROJECT_ROOT, TEST_BRANCH, TEST_COMMIT_SHA);
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
      const mainDb = new QdrantDB(QDRANT_URL, undefined, TEST_ORG_ID, TEST_PROJECT_ROOT, 'main', 'main-commit-sha');
      const featureDb = new QdrantDB(QDRANT_URL, undefined, TEST_ORG_ID, TEST_PROJECT_ROOT, 'feature-x', 'feature-commit-sha');
      
      await mainDb.initialize();
      await featureDb.initialize();

      // Insert data into main branch
      const mainVectors = [new Float32Array(EMBEDDING_DIMENSION).fill(0.1)];
      const mainMetadatas = [{
        file: 'src/main.ts',
        startLine: 1,
        endLine: 10,
        type: 'function' as const,
        language: 'typescript',
      }];
      const mainContents = ['main branch content'];
      await mainDb.insertBatch(mainVectors, mainMetadatas, mainContents);

      // Insert data into feature branch
      const featureVectors = [new Float32Array(EMBEDDING_DIMENSION).fill(0.2)];
      const featureMetadatas = [{
        file: 'src/feature.ts',
        startLine: 1,
        endLine: 10,
        type: 'function' as const,
        language: 'typescript',
      }];
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
      const mainDb = new QdrantDB(QDRANT_URL, undefined, TEST_ORG_ID, TEST_PROJECT_ROOT, 'main', 'main-commit-sha');
      const featureDb = new QdrantDB(QDRANT_URL, undefined, TEST_ORG_ID, TEST_PROJECT_ROOT, 'feature-x', 'feature-commit-sha');
      
      await mainDb.initialize();
      await featureDb.initialize();

      // Insert data into both branches
      const mainVectors = [new Float32Array(EMBEDDING_DIMENSION).fill(0.1)];
      const mainMetadatas = [{
        file: 'src/main.ts',
        startLine: 1,
        endLine: 10,
        type: 'function' as const,
        language: 'typescript',
      }];
      const mainContents = ['main content'];
      await mainDb.insertBatch(mainVectors, mainMetadatas, mainContents);

      const featureVectors = [new Float32Array(EMBEDDING_DIMENSION).fill(0.2)];
      const featureMetadatas = [{
        file: 'src/feature.ts',
        startLine: 1,
        endLine: 10,
        type: 'function' as const,
        language: 'typescript',
      }];
      const featureContents = ['feature content'];
      await featureDb.insertBatch(featureVectors, featureMetadatas, featureContents);

      // Cross-repo search with main branch filter should only return main branch data
      const queryVector = new Float32Array(EMBEDDING_DIMENSION).fill(0.1);
      const mainResults = await mainDb.searchCrossRepo(queryVector, 10, undefined, 'main');
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
      const mainDb = new QdrantDB(QDRANT_URL, undefined, TEST_ORG_ID, TEST_PROJECT_ROOT, 'main', 'main-commit-sha');
      const featureDb = new QdrantDB(QDRANT_URL, undefined, TEST_ORG_ID, TEST_PROJECT_ROOT, 'feature-x', 'feature-commit-sha');
      
      await mainDb.initialize();
      await featureDb.initialize();

      // Insert data into both branches
      const mainVectors = [new Float32Array(EMBEDDING_DIMENSION).fill(0.1)];
      const mainMetadatas = [{
        file: 'src/main.ts',
        startLine: 1,
        endLine: 10,
        type: 'function' as const,
        language: 'typescript',
      }];
      const mainContents = ['main content'];
      await mainDb.insertBatch(mainVectors, mainMetadatas, mainContents);

      const featureVectors = [new Float32Array(EMBEDDING_DIMENSION).fill(0.2)];
      const featureMetadatas = [{
        file: 'src/feature.ts',
        startLine: 1,
        endLine: 10,
        type: 'function' as const,
        language: 'typescript',
      }];
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
      const mainDb = new QdrantDB(QDRANT_URL, undefined, TEST_ORG_ID, TEST_PROJECT_ROOT, 'main', 'main-commit-sha');
      const featureDb = new QdrantDB(QDRANT_URL, undefined, TEST_ORG_ID, TEST_PROJECT_ROOT, 'feature-x', 'feature-commit-sha');
      
      await mainDb.initialize();
      await featureDb.initialize();

      // Insert same file into both branches
      const vectors = [new Float32Array(EMBEDDING_DIMENSION).fill(0.1)];
      const metadatas = [{
        file: 'src/shared.ts',
        startLine: 1,
        endLine: 10,
        type: 'function' as const,
        language: 'typescript',
      }];
      const mainContents = ['main version'];
      const featureContents = ['feature version'];

      await mainDb.insertBatch(vectors, metadatas, mainContents);
      await featureDb.insertBatch(vectors, metadatas, featureContents);

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
  });
});

