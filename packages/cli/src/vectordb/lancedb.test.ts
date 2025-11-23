import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VectorDB } from './lancedb.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('VectorDB - scanWithFilter', () => {
  let db: VectorDB;
  let testDir: string;

  beforeEach(async () => {
    // Create a temporary directory for test database
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lien-test-'));
    db = new VectorDB(testDir);
    await db.initialize();

    // Insert test data with multiple languages and content
    const testData = [
      {
        content: 'function getUserById(id: number) { return users.find(u => u.id === id); }',
        metadata: {
          file: 'src/users.ts',
          startLine: 10,
          endLine: 12,
          type: 'function' as const,
          language: 'typescript',
          isTest: false,
          relatedTests: [],
          relatedSources: [],
          testFramework: '',
          detectionMethod: 'convention' as const,
        },
      },
      {
        content: 'class UserService { constructor(private db: Database) {} }',
        metadata: {
          file: 'src/UserService.ts',
          startLine: 5,
          endLine: 7,
          type: 'class' as const,
          language: 'typescript',
          isTest: false,
          relatedTests: [],
          relatedSources: [],
          testFramework: '',
          detectionMethod: 'convention' as const,
        },
      },
      {
        content: 'def get_user_by_id(id): return users.get(id)',
        metadata: {
          file: 'src/users.py',
          startLine: 15,
          endLine: 16,
          type: 'function' as const,
          language: 'python',
          isTest: false,
          relatedTests: [],
          relatedSources: [],
          testFramework: '',
          detectionMethod: 'convention' as const,
        },
      },
      {
        content: 'class DataService { public function fetchData() {} }',
        metadata: {
          file: 'app/Services/DataService.php',
          startLine: 20,
          endLine: 22,
          type: 'class' as const,
          language: 'php',
          isTest: false,
          relatedTests: [],
          relatedSources: [],
          testFramework: '',
          detectionMethod: 'convention' as const,
        },
      },
    ];

    const vectors = testData.map(() => new Float32Array(384).fill(0.1));
    const metadatas = testData.map(d => d.metadata);
    const contents = testData.map(d => d.content);

    await db.insertBatch(vectors, metadatas, contents);
  });

  afterEach(async () => {
    await db.clear();
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should filter by language', async () => {
    const results = await db.scanWithFilter({ language: 'typescript' });
    
    expect(results.length).toBe(2);
    expect(results.every(r => r.metadata.language === 'typescript')).toBe(true);
  });

  it('should filter by pattern', async () => {
    const results = await db.scanWithFilter({ pattern: '.*Service' });
    
    expect(results.length).toBe(2);
    expect(results.some(r => r.metadata.file.includes('UserService'))).toBe(true);
    expect(results.some(r => r.metadata.file.includes('DataService'))).toBe(true);
  });

  it('should combine language and pattern filters', async () => {
    const results = await db.scanWithFilter({ 
      language: 'typescript',
      pattern: '.*Service'
    });
    
    expect(results.length).toBe(1);
    expect(results[0].metadata.file).toContain('UserService');
    expect(results[0].metadata.language).toBe('typescript');
  });

  it('should return empty array when no matches', async () => {
    const results = await db.scanWithFilter({ 
      language: 'typescript',
      pattern: 'nonexistent'
    });
    
    expect(results.length).toBe(0);
  });

  it('should respect limit parameter', async () => {
    const results = await db.scanWithFilter({ limit: 2 });
    
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('should filter out empty content', async () => {
    const results = await db.scanWithFilter({});
    
    expect(results.every(r => r.content && r.content.trim().length > 0)).toBe(true);
  });

  it('should match pattern in file path', async () => {
    const results = await db.scanWithFilter({ pattern: 'users' });
    
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.metadata.file.includes('users'))).toBe(true);
  });

  it('should be case insensitive for pattern matching', async () => {
    const results = await db.scanWithFilter({ pattern: 'userservice' });
    
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.metadata.file.includes('UserService'))).toBe(true);
  });

  it('should return all metadata fields', async () => {
    const results = await db.scanWithFilter({ language: 'typescript', limit: 1 });
    
    expect(results.length).toBe(1);
    const result = results[0];
    expect(result.metadata).toHaveProperty('file');
    expect(result.metadata).toHaveProperty('startLine');
    expect(result.metadata).toHaveProperty('endLine');
    expect(result.metadata).toHaveProperty('type');
    expect(result.metadata).toHaveProperty('language');
  });
  
  it('should include relevance field in results', async () => {
    const results = await db.scanWithFilter({ language: 'typescript' });
    
    expect(results.length).toBeGreaterThan(0);
    results.forEach(result => {
      expect(result).toHaveProperty('relevance');
      expect(['highly_relevant', 'relevant', 'loosely_related', 'not_relevant']).toContain(result.relevance);
    });
  });

  it('should throw error if database not initialized', async () => {
    const uninitializedDb = new VectorDB(testDir);
    
    await expect(uninitializedDb.scanWithFilter({})).rejects.toThrow('Vector database not initialized');
  });
});

describe('VectorDB - Batch Insert Retry Logic', () => {
  let db: VectorDB;
  let testDir: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lien-test-'));
    db = new VectorDB(testDir);
    await db.initialize();
  });

  afterEach(async () => {
    await db.clear();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should successfully insert small batch (< 1000 records)', async () => {
    const batchSize = 50;
    const vectors = Array.from({ length: batchSize }, () => new Float32Array(384).fill(0.1));
    const metadatas = Array.from({ length: batchSize }, (_, i) => ({
      file: `test${i}.ts`,
      startLine: 1,
      endLine: 10,
      type: 'function' as const,
      language: 'typescript',
      isTest: false,
      relatedTests: [],
      relatedSources: [],
      testFramework: '',
      detectionMethod: 'convention' as const,
    }));
    const contents = Array.from({ length: batchSize }, (_, i) => `function test${i}() {}`);

    await expect(db.insertBatch(vectors, metadatas, contents)).resolves.not.toThrow();
    
    // Verify data was inserted (specify higher limit)
    const results = await db.scanWithFilter({ limit: batchSize });
    expect(results.length).toBe(batchSize);
  });

  it('should split and insert large batch (> 1000 records)', async () => {
    const batchSize = 1500; // Larger than MAX_BATCH_SIZE (1000)
    const vectors = Array.from({ length: batchSize }, () => new Float32Array(384).fill(0.1));
    const metadatas = Array.from({ length: batchSize }, (_, i) => ({
      file: `test${i}.ts`,
      startLine: 1,
      endLine: 10,
      type: 'function' as const,
      language: 'typescript',
      isTest: false,
      relatedTests: [],
      relatedSources: [],
      testFramework: '',
      detectionMethod: 'convention' as const,
    }));
    const contents = Array.from({ length: batchSize }, (_, i) => `function test${i}() {}`);

    // Should automatically split into multiple batches
    await expect(db.insertBatch(vectors, metadatas, contents)).resolves.not.toThrow();
    
    // Verify all data was inserted (specify higher limit)
    const results = await db.scanWithFilter({ limit: batchSize + 100 });
    expect(results.length).toBe(batchSize);
  });

  it('should handle edge case at exactly MAX_BATCH_SIZE (1000)', async () => {
    const batchSize = 1000;
    const vectors = Array.from({ length: batchSize }, () => new Float32Array(384).fill(0.1));
    const metadatas = Array.from({ length: batchSize }, (_, i) => ({
      file: `test${i}.ts`,
      startLine: 1,
      endLine: 10,
      type: 'function' as const,
      language: 'typescript',
      isTest: false,
      relatedTests: [],
      relatedSources: [],
      testFramework: '',
      detectionMethod: 'convention' as const,
    }));
    const contents = Array.from({ length: batchSize }, (_, i) => `function test${i}() {}`);

    await expect(db.insertBatch(vectors, metadatas, contents)).resolves.not.toThrow();
    
    const results = await db.scanWithFilter({ limit: batchSize + 100 });
    expect(results.length).toBe(batchSize);
  });

  it('should handle empty batch gracefully', async () => {
    // Should not throw when inserting empty batch
    await expect(db.insertBatch([], [], [])).resolves.not.toThrow();
    
    // Note: table won't be created if no data inserted, so we can't scan
    // This test just verifies that empty batch doesn't cause errors
  });

  it('should handle single record batch', async () => {
    const vectors = [new Float32Array(384).fill(0.1)];
    const metadatas = [{
      file: 'single.ts',
      startLine: 1,
      endLine: 10,
      type: 'function' as const,
      language: 'typescript',
      isTest: false,
      relatedTests: [],
      relatedSources: [],
      testFramework: '',
      detectionMethod: 'convention' as const,
    }];
    const contents = ['function single() {}'];

    await expect(db.insertBatch(vectors, metadatas, contents)).resolves.not.toThrow();
    
    const results = await db.scanWithFilter({ limit: 10 });
    expect(results.length).toBe(1);
    expect(results[0].metadata.file).toBe('single.ts');
  });

  it('should handle batch at MIN_BATCH_SIZE boundary (10)', async () => {
    const batchSize = 10; // Exactly at MIN_BATCH_SIZE
    const vectors = Array.from({ length: batchSize }, () => new Float32Array(384).fill(0.1));
    const metadatas = Array.from({ length: batchSize }, (_, i) => ({
      file: `test${i}.ts`,
      startLine: 1,
      endLine: 10,
      type: 'function' as const,
      language: 'typescript',
      isTest: false,
      relatedTests: [],
      relatedSources: [],
      testFramework: '',
      detectionMethod: 'convention' as const,
    }));
    const contents = Array.from({ length: batchSize }, (_, i) => `function test${i}() {}`);

    await expect(db.insertBatch(vectors, metadatas, contents)).resolves.not.toThrow();
    
    const results = await db.scanWithFilter({ limit: batchSize + 10 });
    expect(results.length).toBe(batchSize);
  });

  it('should maintain data integrity across batch splits', async () => {
    const batchSize = 1200; // Will be split into 2 batches
    const vectors = Array.from({ length: batchSize }, (_, i) => {
      const vec = new Float32Array(384);
      vec.fill(i / 1000); // Unique values for verification
      return vec;
    });
    const metadatas = Array.from({ length: batchSize }, (_, i) => ({
      file: `test${i}.ts`,
      startLine: i,
      endLine: i + 10,
      type: 'function' as const,
      language: 'typescript',
      isTest: false,
      relatedTests: [],
      relatedSources: [],
      testFramework: '',
      detectionMethod: 'convention' as const,
    }));
    const contents = Array.from({ length: batchSize }, (_, i) => `function test${i}() { return ${i}; }`);

    await db.insertBatch(vectors, metadatas, contents);
    
    const results = await db.scanWithFilter({ limit: batchSize + 100 });
    expect(results.length).toBe(batchSize);
    
    // Verify data integrity - check a sample
    const sample = results.find(r => r.metadata.file === 'test500.ts');
    expect(sample).toBeDefined();
    expect(sample?.metadata.startLine).toBe(500);
    expect(sample?.content).toContain('test500');
  });

  it('should process batches using iterative queue (not recursive)', async () => {
    // This test verifies the queue-based approach can handle many records
    // without stack overflow (which could happen with deep recursion)
    const batchSize = 2500; // Would cause ~2-3 levels of splitting
    const vectors = Array.from({ length: batchSize }, () => new Float32Array(384).fill(0.1));
    const metadatas = Array.from({ length: batchSize }, (_, i) => ({
      file: `test${i}.ts`,
      startLine: 1,
      endLine: 10,
      type: 'function' as const,
      language: 'typescript',
      isTest: false,
      relatedTests: [],
      relatedSources: [],
      testFramework: '',
      detectionMethod: 'convention' as const,
    }));
    const contents = Array.from({ length: batchSize }, (_, i) => `function test${i}() {}`);

    // Should complete without stack overflow
    await expect(db.insertBatch(vectors, metadatas, contents)).resolves.not.toThrow();
    
    const results = await db.scanWithFilter({ limit: batchSize + 100 });
    expect(results.length).toBe(batchSize);
  });
});

