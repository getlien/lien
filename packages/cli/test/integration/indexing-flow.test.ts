import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDir, cleanupTestDir, createTestFile } from '@liendev/core/test';
import { createVectorDB, scanCodebase, chunkFile } from '@liendev/core';
import type { VectorDBInterface } from '@liendev/core';
import fs from 'fs/promises';

describe('Indexing Flow Integration', () => {
  let testDir: string;
  let vectorDB: VectorDBInterface;

  beforeEach(async () => {
    testDir = await createTestDir();
    vectorDB = await createVectorDB(testDir);
    await vectorDB.initialize();
  });

  afterEach(async () => {
    await vectorDB.clear();
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

    // Step 3: Insert into the structural store (no embeddings — lexical FTS5)
    const texts = chunks.map(chunk => chunk.content);
    const metadatas = chunks.map(chunk => chunk.metadata);
    await vectorDB.insertBatch(metadatas, texts);

    // Step 4: Lexical search for relevant code
    const results = await vectorDB.search('calculateSum', 5);

    // Verify results
    expect(results.length).toBeGreaterThan(0);
    const hasCalculateSum = results.some(r => r.content.includes('calculateSum'));
    expect(hasCalculateSum).toBe(true);
  });

  it('should handle multiple files', async () => {
    // Create multiple test files
    await createTestFile(testDir, 'utils.ts', 'export function helper() { return "test"; }');
    await createTestFile(
      testDir,
      'constants.ts',
      'export const API_URL = "https://api.example.com";',
    );

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
      const metadatas = chunks.map(chunk => chunk.metadata);
      await vectorDB.insertBatch(metadatas, texts);
    }

    // Search
    const results = await vectorDB.search('API_URL constant', 5);

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
