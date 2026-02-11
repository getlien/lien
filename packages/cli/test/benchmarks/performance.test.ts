import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  VectorDB,
  LocalEmbeddings,
  CachedEmbeddings,
  chunkFile,
  extractSymbols,
} from '@liendev/core';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Benchmark thresholds (can be adjusted based on hardware)
const BENCHMARKS = {
  SEARCH_LATENCY_MS: 500,
  EMBEDDING_GENERATION_MS: 200,
  CHUNK_PROCESSING_MS: 50,
  SYMBOL_EXTRACTION_MS: 100,
  VECTOR_DB_QUERY_MS: 300,
};

describe('Performance Benchmarks', () => {
  let vectorDB: VectorDB;
  let embeddings: LocalEmbeddings;
  let cachedEmbeddings: CachedEmbeddings;
  let testDir: string;

  beforeAll(async () => {
    // Create temporary test directory
    testDir = path.join(os.tmpdir(), `lien-bench-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    // Initialize services
    vectorDB = new VectorDB(testDir);
    await vectorDB.initialize();

    embeddings = new LocalEmbeddings();
    await embeddings.initialize();

    cachedEmbeddings = new CachedEmbeddings(embeddings, 100);
    await cachedEmbeddings.initialize();

    // Seed vector database with test data
    await seedTestData();
  }, 60000); // 60 second timeout for CI (embedding model initialization is slow)

  afterAll(async () => {
    // Cleanup
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  async function seedTestData() {
    const testCode = `
export function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}

export class ShoppingCart {
  private items: Item[] = [];
  
  addItem(item: Item): void {
    this.items.push(item);
  }
  
  getTotal(): number {
    return calculateTotal(this.items);
  }
}

interface Item {
  name: string;
  price: number;
  quantity: number;
}
`;

    // Create 50 chunks for meaningful search results
    const vectors: Float32Array[] = [];
    const contents: string[] = [];
    const metadatas: any[] = [];

    for (let i = 0; i < 50; i++) {
      const content = testCode + `\n// File ${i}`;
      const vector = await embeddings.embed(content);

      vectors.push(vector);
      contents.push(content);
      metadatas.push({
        file: `test-${i}.ts`,
        startLine: 1,
        endLine: 20,
        type: 'block',
        language: 'typescript',
      });
    }

    await vectorDB.insertBatch(vectors, metadatas, contents);
  }

  describe('Embedding Generation', () => {
    it('should generate embeddings within performance threshold', async () => {
      const testText = 'This is a test query for embedding generation performance';
      const iterations = 5;
      const timings: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await embeddings.embed(testText);
        const duration = performance.now() - start;
        timings.push(duration);
      }

      const avgDuration = timings.reduce((a, b) => a + b, 0) / iterations;

      console.log(`Average embedding generation: ${avgDuration.toFixed(2)}ms`);
      expect(avgDuration).toBeLessThan(BENCHMARKS.EMBEDDING_GENERATION_MS);
    });

    it('should demonstrate cache performance improvement', async () => {
      const testText = 'This is a cached query test';

      // First call - no cache
      const start1 = performance.now();
      await cachedEmbeddings.embed(testText);
      const uncachedDuration = performance.now() - start1;

      // Second call - should hit cache
      const start2 = performance.now();
      await cachedEmbeddings.embed(testText);
      const cachedDuration = performance.now() - start2;

      console.log(
        `Uncached: ${uncachedDuration.toFixed(2)}ms, Cached: ${cachedDuration.toFixed(2)}ms`,
      );
      console.log(`Cache speedup: ${(uncachedDuration / cachedDuration).toFixed(1)}x faster`);

      // Cache should be significantly faster
      expect(cachedDuration).toBeLessThan(uncachedDuration / 5); // At least 5x faster
    });
  });

  describe('Vector Database Search', () => {
    it('should search within performance threshold', async () => {
      const queryText = 'calculate total price of items';
      const queryVector = await embeddings.embed(queryText);
      const iterations = 10;
      const timings: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await vectorDB.search(queryVector, 5);
        const duration = performance.now() - start;
        timings.push(duration);
      }

      const avgDuration = timings.reduce((a, b) => a + b, 0) / iterations;

      console.log(`Average vector DB search: ${avgDuration.toFixed(2)}ms`);
      expect(avgDuration).toBeLessThan(BENCHMARKS.VECTOR_DB_QUERY_MS);
    });

    it('should handle larger result sets efficiently', async () => {
      const queryText = 'typescript code';
      const queryVector = await embeddings.embed(queryText);

      const start = performance.now();
      const results = await vectorDB.search(queryVector, 20);
      const duration = performance.now() - start;

      console.log(`Large result set (${results.length} results): ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(BENCHMARKS.VECTOR_DB_QUERY_MS * 1.5);
    });
  });

  describe('End-to-End Search Latency', () => {
    it('should complete full search within latency threshold', async () => {
      const queryText = 'shopping cart implementation';
      const iterations = 5;
      const timings: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();

        // Full search pipeline: embed + search
        const queryVector = await embeddings.embed(queryText);
        await vectorDB.search(queryVector, 5);

        const duration = performance.now() - start;
        timings.push(duration);
      }

      const avgDuration = timings.reduce((a, b) => a + b, 0) / iterations;

      console.log(`Average end-to-end search: ${avgDuration.toFixed(2)}ms`);
      expect(avgDuration).toBeLessThan(BENCHMARKS.SEARCH_LATENCY_MS);
    });
  });

  describe('Code Processing', () => {
    it('should chunk files efficiently', async () => {
      const testCode = 'function test() {\n  return 42;\n}\n'.repeat(100);
      const iterations = 10;
      const timings: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        chunkFile('test.ts', testCode, { chunkSize: 75, chunkOverlap: 10 });
        const duration = performance.now() - start;
        timings.push(duration);
      }

      const avgDuration = timings.reduce((a, b) => a + b, 0) / iterations;

      console.log(
        `Average chunking (${testCode.split('\n').length} lines): ${avgDuration.toFixed(2)}ms`,
      );
      expect(avgDuration).toBeLessThan(BENCHMARKS.CHUNK_PROCESSING_MS);
    });

    it('should extract symbols efficiently', () => {
      const testCode = `
function foo() {}
function bar() {}
class MyClass {}
interface MyInterface {}
export class AnotherClass {}
`.repeat(20);

      const start = performance.now();
      const symbols = extractSymbols(testCode, 'typescript');
      const duration = performance.now() - start;

      console.log(
        `Symbol extraction (${symbols.functions.length} functions, ${symbols.classes.length} classes): ${duration.toFixed(2)}ms`,
      );
      expect(duration).toBeLessThan(BENCHMARKS.SYMBOL_EXTRACTION_MS);
    });
  });

  describe('Batch Operations', () => {
    it('should handle batch embedding efficiently', async () => {
      const texts = Array(10)
        .fill(0)
        .map((_, i) => `Test query number ${i}`);

      const start = performance.now();
      const results = await embeddings.embedBatch(texts);
      const duration = performance.now() - start;

      console.log(`Batch embedding (${texts.length} texts): ${duration.toFixed(2)}ms`);
      console.log(`Per-item average: ${(duration / texts.length).toFixed(2)}ms`);

      expect(results).toHaveLength(texts.length);
      expect(duration / texts.length).toBeLessThan(BENCHMARKS.EMBEDDING_GENERATION_MS);
    });
  });
});

/**
 * Baseline Performance Metrics
 *
 * These benchmarks establish performance baselines for the Lien codebase.
 * Run with: npm run test:benchmark
 *
 * Expected results on modern hardware:
 * - Embedding generation: < 200ms per query
 * - Vector DB search: < 300ms per query
 * - End-to-end search: < 500ms total
 * - Code chunking: < 50ms per file
 * - Symbol extraction: < 100ms per file
 *
 * Cache should provide 5-10x speedup for repeated queries.
 */
