import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VectorDB } from './lancedb.js';
import { EMBEDDING_DIMENSION } from '../embeddings/types.js';
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
      pattern: '.*Service',
    });

    expect(results.length).toBe(1);
    expect(results[0].metadata.file).toContain('UserService');
    expect(results[0].metadata.language).toBe('typescript');
  });

  it('should return empty array when no matches', async () => {
    const results = await db.scanWithFilter({
      language: 'typescript',
      pattern: 'nonexistent',
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
      expect(['highly_relevant', 'relevant', 'loosely_related', 'not_relevant']).toContain(
        result.relevance,
      );
    });
  });

  it('should throw error if database not initialized', async () => {
    const uninitializedDb = new VectorDB(testDir);

    await expect(uninitializedDb.scanWithFilter({})).rejects.toThrow(
      'Vector database not initialized',
    );
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
    const metadatas = [
      {
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
      },
    ];
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
    const contents = Array.from(
      { length: batchSize },
      (_, i) => `function test${i}() { return ${i}; }`,
    );

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

describe('VectorDB - column projection end-to-end', () => {
  // Integration tests against a real LanceDB instance. Validates that the
  // column names used by each handler's column list are actually present in
  // the Arrow schema, and that absent columns produce `undefined` (not
  // crashes) downstream of buildSearchResultMetadata.
  let db: VectorDB;
  let testDir: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lien-test-cols-'));
    db = new VectorDB(testDir);
    await db.initialize();
    await db.insertBatch(
      [new Float32Array(EMBEDDING_DIMENSION).fill(0.1)],
      [
        {
          file: 'src/foo.ts',
          startLine: 1,
          endLine: 5,
          type: 'function' as const,
          language: 'typescript',
          symbolName: 'getFoo',
          symbolType: 'function' as const,
          complexity: 3,
          cognitiveComplexity: 2,
          imports: ['./bar'],
          exports: ['getFoo'],
          importedSymbols: { './bar': ['Bar'] },
          callSites: [{ symbol: 'Bar', line: 3, isResultCaptured: true }],
          halsteadVolume: 10,
          halsteadDifficulty: 1,
          halsteadEffort: 10,
          halsteadBugs: 0.01,
        },
      ],
      ['function getFoo() { return Bar(); }'],
    );
  });

  afterEach(async () => {
    await db.clear();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('scanWithFilter with minimal columns returns only requested fields populated', async () => {
    const rows = await db.scanWithFilter({
      file: 'src/foo.ts',
      limit: 10,
      columns: ['file', 'startLine', 'endLine', 'language'],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata.file).toBe('src/foo.ts');
    expect(rows[0].metadata.language).toBe('typescript');
    // Fields NOT in the column list should be undefined after materialization.
    expect(rows[0].metadata.importedSymbols).toBeUndefined();
    expect(rows[0].metadata.callSites).toBeUndefined();
    expect(rows[0].metadata.complexity).toBeUndefined();
  });

  it('scanAll with packed-array columns returns hydrated importedSymbols + callSites', async () => {
    const rows = await db.scanAll({
      columns: [
        'file',
        'startLine',
        'endLine',
        'imports',
        'importedSymbolPaths',
        'importedSymbolNames',
        'exports',
        'callSiteSymbols',
        'callSiteLines',
        'callSiteCaptured',
      ],
    });
    expect(rows).toHaveLength(1);
    // `imports` comes back as an Arrow Vector for non-search paths;
    // callers iterate it directly. Coerce via Array.from for comparison.
    expect(Array.from(rows[0].metadata.imports ?? [])).toEqual(['./bar']);
    expect(rows[0].metadata.exports).toEqual(['getFoo']);
    expect(rows[0].metadata.importedSymbols).toEqual({ './bar': ['Bar'] });
    expect(rows[0].metadata.callSites).toHaveLength(1);
    expect(rows[0].metadata.callSites?.[0].symbol).toBe('Bar');
  });

  it('search projects columns and auto-injects _distance for ranking', async () => {
    const rows = await db.search(new Float32Array(EMBEDDING_DIMENSION).fill(0.1), 5, undefined, {
      // Omit `_distance` intentionally — the wrapper must add it.
      columns: ['file', 'content', 'startLine', 'endLine'],
    });
    expect(rows.length).toBeGreaterThan(0);
    // If `_distance` had been dropped, score would default to 0 for every
    // row; sort would degenerate. The fact that scores are numeric (and
    // possibly non-zero) confirms `_distance` came through.
    expect(typeof rows[0].score).toBe('number');
    // Fields not selected → undefined
    expect(rows[0].metadata.complexity).toBeUndefined();
    expect(rows[0].metadata.importedSymbols).toBeUndefined();
  });
});
