import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDir, cleanupTestDir, createTestFile } from '../helpers/test-db.js';
import { MockEmbeddings } from '../helpers/mock-embeddings.js';
import { VectorDB } from '../../src/vectordb/lancedb.js';
import { scanCodebase } from '../../src/indexer/scanner.js';
import { chunkFile } from '../../src/indexer/chunker.js';
import fs from 'fs/promises';

describe('Indexing Flow Integration', () => {
  let testDir: string;
  let embeddings: MockEmbeddings;
  let vectorDB: VectorDB;

  beforeEach(async () => {
    testDir = await createTestDir();
    embeddings = new MockEmbeddings();
    vectorDB = new VectorDB(testDir);

    await embeddings.initialize();
    await vectorDB.initialize();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it('should index and search a simple TypeScript file', async () => {
    // Create a test file
    const testCode = `
export function calculateSum(a: number, b: number): number {
  return a + b;
}

export function calculateProduct(a: number, b: number): number {
  return a * b;
}
`;
    await createTestFile(testDir, 'math.ts', testCode);

    // Step 1: Scan files
    const files = await scanCodebase({
      rootDir: testDir,
      includePatterns: ['**/*.ts'],
      excludePatterns: [],
    });
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('math.ts');

    // Step 2: Chunk the file
    const content = await fs.readFile(files[0], 'utf-8');
    const chunks = chunkFile(files[0], content);
    expect(chunks.length).toBeGreaterThan(0);

    // Step 3: Generate embeddings
    const texts = chunks.map(chunk => chunk.content);
    const vectors = await embeddings.embedBatch(texts);
    expect(vectors).toHaveLength(chunks.length);

    // Step 4: Insert into vector DB
    const metadatas = chunks.map(chunk => chunk.metadata);
    await vectorDB.insertBatch(vectors, metadatas, texts);

    // Step 5: Search for relevant code
    const queryVector = await embeddings.embed('function that adds numbers');
    const results = await vectorDB.search(queryVector, 5);

    // Verify results
    expect(results.length).toBeGreaterThan(0);
    // With AST chunking, both functions are separate chunks
    // Check that calculateSum is in the results (may not be first due to semantic similarity)
    const hasCalculateSum = results.some(r => r.content.includes('calculateSum'));
    expect(hasCalculateSum).toBe(true);
  });

  it('should handle multiple files', async () => {
    // Create multiple test files
    await createTestFile(testDir, 'utils.ts', 'export function helper() { return "test"; }');
    await createTestFile(testDir, 'constants.ts', 'export const API_URL = "https://api.example.com";');

    // Scan files
    const files = await scanCodebase({
      rootDir: testDir,
      includePatterns: ['**/*.ts'],
      excludePatterns: [],
    });
    expect(files).toHaveLength(2);

    // Index all files
    for (const file of files) {
      const content = await fs.readFile(file, 'utf-8');
      const chunks = chunkFile(file, content);
      const texts = chunks.map(chunk => chunk.content);
      const vectors = await embeddings.embedBatch(texts);
      const metadatas = chunks.map(chunk => chunk.metadata);
      await vectorDB.insertBatch(vectors, metadatas, texts);
    }

    // Search
    const queryVector = await embeddings.embed('API URL constant');
    const results = await vectorDB.search(queryVector, 5);

    expect(results.length).toBeGreaterThan(0);
    const hasConstantsFile = results.some(r => r.metadata.file.includes('constants.ts'));
    expect(hasConstantsFile).toBe(true);
  });

  it('should respect .gitignore patterns', async () => {
    // Create files
    await createTestFile(testDir, 'src/index.ts', 'export const main = () => {};');
    await createTestFile(testDir, 'node_modules/pkg/index.js', 'module.exports = {};');
    await createTestFile(testDir, '.gitignore', 'node_modules/');

    // Scan files
    const files = await scanCodebase({
      rootDir: testDir,
      includePatterns: ['**/*.ts', '**/*.js'],
      excludePatterns: [],
    });

    // Should include src/index.ts but not node_modules files
    expect(files.some(f => f.includes('src/index.ts'))).toBe(true);
    expect(files.some(f => f.includes('node_modules'))).toBe(false);
  });
});

