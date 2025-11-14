import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VectorDB } from './lancedb.js';
import { ChunkMetadata } from '../indexer/types.js';
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
    expect(result.metadata).toHaveProperty('isTest');
    expect(result.metadata).toHaveProperty('relatedTests');
    expect(result.metadata).toHaveProperty('relatedSources');
    expect(result.metadata).toHaveProperty('testFramework');
    expect(result.metadata).toHaveProperty('detectionMethod');
  });

  it('should throw error if database not initialized', async () => {
    const uninitializedDb = new VectorDB(testDir);
    
    await expect(uninitializedDb.scanWithFilter({})).rejects.toThrow('Vector database not initialized');
  });
});

