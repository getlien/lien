import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { writeFile } from 'fs/promises';
import { PersistentEmbeddingCache, embedBatchWithCache, computeEmbeddingHash } from './persistent-cache.js';
import { EmbeddingService } from './types.js';

class MockEmbeddingService implements EmbeddingService {
  embedCallCount = 0;
  embedBatchCallCount = 0;

  async initialize(): Promise<void> {
    // No-op
  }

  async embed(text: string): Promise<Float32Array> {
    this.embedCallCount++;
    const embedding = new Float32Array(384);
    embedding.fill(text.length / 1000);
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    this.embedBatchCallCount++;
    return Promise.all(texts.map(text => this.embed(text)));
  }

  async dispose(): Promise<void> {
    // No-op
  }
}

describe('PersistentEmbeddingCache', () => {
  let tmpDir: string;
  let cachePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'lien-cache-test-'));
    cachePath = path.join(tmpDir, 'embedding-cache');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function makeVector(value: number, dimensions = 384): Float32Array {
    const vec = new Float32Array(dimensions);
    vec.fill(value);
    return vec;
  }

  describe('computeEmbeddingHash', () => {
    it('should return consistent hash for same input', () => {
      const hash1 = computeEmbeddingHash('hello world');
      const hash2 = computeEmbeddingHash('hello world');
      expect(hash1).toBe(hash2);
    });

    it('should return different hashes for different inputs', () => {
      const hash1 = computeEmbeddingHash('hello world');
      const hash2 = computeEmbeddingHash('goodbye world');
      expect(hash1).not.toBe(hash2);
    });

    it('should return 16 character hex string', () => {
      const hash = computeEmbeddingHash('test');
      expect(hash).toHaveLength(16);
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  describe('get/set', () => {
    it('should return undefined on cache miss', async () => {
      const cache = new PersistentEmbeddingCache({ cachePath });
      await cache.initialize();

      const result = cache.get('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should return correct vector on cache hit', async () => {
      const cache = new PersistentEmbeddingCache({ cachePath });
      await cache.initialize();

      const vec = makeVector(0.5);
      const hash = computeEmbeddingHash('test text');
      cache.set(hash, vec);

      const result = cache.get(hash);
      expect(result).toBeDefined();
      expect(result!.length).toBe(384);
      for (let i = 0; i < 384; i++) {
        expect(result![i]).toBeCloseTo(0.5);
      }
    });

    it('should track hit and miss counts', async () => {
      const cache = new PersistentEmbeddingCache({ cachePath });
      await cache.initialize();

      const hash = computeEmbeddingHash('test');
      cache.set(hash, makeVector(1.0));

      expect(cache.hitCount).toBe(0);
      expect(cache.missCount).toBe(0);

      cache.get('nonexistent');
      expect(cache.missCount).toBe(1);

      cache.get(hash);
      expect(cache.hitCount).toBe(1);

      cache.get(hash);
      expect(cache.hitCount).toBe(2);
      expect(cache.missCount).toBe(1);
    });

    it('should update existing entry on set', async () => {
      const cache = new PersistentEmbeddingCache({ cachePath });
      await cache.initialize();

      const hash = computeEmbeddingHash('test');
      cache.set(hash, makeVector(1.0));
      cache.set(hash, makeVector(2.0));

      expect(cache.size).toBe(1);
      const result = cache.get(hash);
      expect(result![0]).toBeCloseTo(2.0);
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest entry when at capacity', async () => {
      const cache = new PersistentEmbeddingCache({
        cachePath,
        maxEntries: 5,
      });
      await cache.initialize();

      // Fill cache with 5 entries
      for (let i = 0; i < 5; i++) {
        cache.set(`hash${i}`, makeVector(i));
      }
      expect(cache.size).toBe(5);

      // Adding 6th should evict hash0 (oldest)
      cache.set('hash5', makeVector(5));
      expect(cache.size).toBe(5);

      // hash0 should be gone
      const evicted = cache.get('hash0');
      expect(evicted).toBeUndefined();

      // hash5 should exist
      const newest = cache.get('hash5');
      expect(newest).toBeDefined();
      expect(newest![0]).toBeCloseTo(5);
    });

    it('should keep recently accessed entries', async () => {
      const cache = new PersistentEmbeddingCache({
        cachePath,
        maxEntries: 5,
      });
      await cache.initialize();

      // Fill cache
      for (let i = 0; i < 5; i++) {
        cache.set(`hash${i}`, makeVector(i));
      }

      // Access hash0 to make it recently used
      cache.get('hash0');

      // Add new entry — should evict hash1 (oldest non-accessed)
      cache.set('hash5', makeVector(5));
      expect(cache.size).toBe(5);

      // hash0 should still be there (recently accessed)
      expect(cache.get('hash0')).toBeDefined();

      // hash1 should be evicted
      expect(cache.get('hash1')).toBeUndefined();
    });
  });

  describe('embedBatchWithCache', () => {
    it('should only embed uncached texts', async () => {
      const cache = new PersistentEmbeddingCache({ cachePath });
      await cache.initialize();
      const mockService = new MockEmbeddingService();

      // Pre-cache some texts
      const hash1 = computeEmbeddingHash('cached text 1');
      const hash2 = computeEmbeddingHash('cached text 2');
      cache.set(hash1, makeVector(0.1));
      cache.set(hash2, makeVector(0.2));

      // Embed a batch with mix of cached and uncached
      const results = await embedBatchWithCache(
        ['cached text 1', 'new text', 'cached text 2', 'another new text'],
        mockService,
        cache,
      );

      expect(results).toHaveLength(4);
      // Only 2 uncached texts should have been embedded
      expect(mockService.embedBatchCallCount).toBe(1);
      expect(mockService.embedCallCount).toBe(2); // embedBatch calls embed internally

      // Cached results should be returned correctly
      expect(results[0][0]).toBeCloseTo(0.1);
      expect(results[2][0]).toBeCloseTo(0.2);
    });

    it('should cache newly embedded texts', async () => {
      const cache = new PersistentEmbeddingCache({ cachePath });
      await cache.initialize();
      const mockService = new MockEmbeddingService();

      await embedBatchWithCache(['text1', 'text2'], mockService, cache);
      expect(cache.size).toBe(2);

      // Second batch with same texts should all be cached
      mockService.embedCallCount = 0;
      mockService.embedBatchCallCount = 0;
      await embedBatchWithCache(['text1', 'text2'], mockService, cache);
      expect(mockService.embedBatchCallCount).toBe(0);
    });

    it('should handle all cached', async () => {
      const cache = new PersistentEmbeddingCache({ cachePath });
      await cache.initialize();
      const mockService = new MockEmbeddingService();

      // Pre-cache everything
      const hash = computeEmbeddingHash('only text');
      cache.set(hash, makeVector(0.42));

      const results = await embedBatchWithCache(['only text'], mockService, cache);
      expect(results).toHaveLength(1);
      expect(results[0][0]).toBeCloseTo(0.42);
      expect(mockService.embedBatchCallCount).toBe(0);
    });
  });

  describe('flush/reload', () => {
    it('should persist and reload entries', async () => {
      // Create cache, add entries, flush
      const cache1 = new PersistentEmbeddingCache({ cachePath });
      await cache1.initialize();

      const hash1 = computeEmbeddingHash('text1');
      const hash2 = computeEmbeddingHash('text2');
      cache1.set(hash1, makeVector(1.0));
      cache1.set(hash2, makeVector(2.0));
      await cache1.flush();

      // Create new cache from same path, initialize
      const cache2 = new PersistentEmbeddingCache({ cachePath });
      await cache2.initialize();

      expect(cache2.size).toBe(2);
      const result1 = cache2.get(hash1);
      expect(result1).toBeDefined();
      expect(result1![0]).toBeCloseTo(1.0);

      const result2 = cache2.get(hash2);
      expect(result2).toBeDefined();
      expect(result2![0]).toBeCloseTo(2.0);
    });

    it('should preserve slot allocation after reload', async () => {
      const cache1 = new PersistentEmbeddingCache({ cachePath, maxEntries: 10 });
      await cache1.initialize();

      for (let i = 0; i < 5; i++) {
        cache1.set(`h${i}`, makeVector(i));
      }
      await cache1.flush();

      const cache2 = new PersistentEmbeddingCache({ cachePath, maxEntries: 10 });
      await cache2.initialize();

      // Add more entries — should not collide with existing slots
      cache2.set('h5', makeVector(5));
      expect(cache2.size).toBe(6);

      // All entries should be valid
      for (let i = 0; i <= 5; i++) {
        const result = cache2.get(`h${i}`);
        expect(result).toBeDefined();
        expect(result![0]).toBeCloseTo(i);
      }
    });
  });

  describe('model mismatch', () => {
    it('should clear cache when model name mismatches', async () => {
      // Create cache with model A
      const cache1 = new PersistentEmbeddingCache({
        cachePath,
        modelName: 'model-A',
      });
      await cache1.initialize();
      cache1.set(computeEmbeddingHash('test'), makeVector(1.0));
      await cache1.flush();

      // Re-initialize with model B
      const cache2 = new PersistentEmbeddingCache({
        cachePath,
        modelName: 'model-B',
      });
      await cache2.initialize();

      expect(cache2.size).toBe(0);
      expect(cache2.get(computeEmbeddingHash('test'))).toBeUndefined();
    });

    it('should keep cache when model name matches', async () => {
      const cache1 = new PersistentEmbeddingCache({
        cachePath,
        modelName: 'model-A',
      });
      await cache1.initialize();
      const hash = computeEmbeddingHash('test');
      cache1.set(hash, makeVector(1.0));
      await cache1.flush();

      const cache2 = new PersistentEmbeddingCache({
        cachePath,
        modelName: 'model-A',
      });
      await cache2.initialize();

      expect(cache2.size).toBe(1);
      expect(cache2.get(hash)).toBeDefined();
    });
  });

  describe('empty cache', () => {
    it('should return undefined for get on empty cache', async () => {
      const cache = new PersistentEmbeddingCache({ cachePath });
      await cache.initialize();

      expect(cache.get('anything')).toBeUndefined();
      expect(cache.size).toBe(0);
    });

    it('should not error on flush of empty cache', async () => {
      const cache = new PersistentEmbeddingCache({ cachePath });
      await cache.initialize();

      await expect(cache.flush()).resolves.not.toThrow();
    });

    it('should not error on dispose of empty cache', async () => {
      const cache = new PersistentEmbeddingCache({ cachePath });
      await cache.initialize();

      await expect(cache.dispose()).resolves.not.toThrow();
    });
  });

  describe('dispose', () => {
    it('should clear all state after dispose', async () => {
      const cache = new PersistentEmbeddingCache({ cachePath });
      await cache.initialize();

      cache.set(computeEmbeddingHash('test'), makeVector(1.0));
      expect(cache.size).toBe(1);

      await cache.dispose();
      expect(cache.size).toBe(0);
    });

    it('should not error on flush after dispose', async () => {
      const cache = new PersistentEmbeddingCache({ cachePath });
      await cache.initialize();

      cache.set(computeEmbeddingHash('test'), makeVector(1.0));
      await cache.dispose();

      // Flush after dispose should be idempotent
      await expect(cache.flush()).resolves.not.toThrow();
    });
  });

  describe('dimension validation', () => {
    it('should throw on dimension mismatch in set()', async () => {
      const cache = new PersistentEmbeddingCache({ cachePath, dimensions: 384 });
      await cache.initialize();

      const wrongDims = new Float32Array(128);
      wrongDims.fill(1.0);

      expect(() => cache.set('hash1', wrongDims)).toThrow('Embedding dimension mismatch: expected 384, got 128');
    });
  });

  describe('corrupt file recovery', () => {
    it('should recover from truncated .bin file', async () => {
      // Create a valid cache and flush
      const cache1 = new PersistentEmbeddingCache({ cachePath });
      await cache1.initialize();
      cache1.set(computeEmbeddingHash('text1'), makeVector(1.0));
      cache1.set(computeEmbeddingHash('text2'), makeVector(2.0));
      await cache1.flush();

      // Truncate the .bin file
      await writeFile(cachePath + '.bin', Buffer.alloc(10));

      // Should recover gracefully (fall back to empty cache)
      const cache2 = new PersistentEmbeddingCache({ cachePath });
      await cache2.initialize();
      expect(cache2.size).toBe(0);
    });

    it('should recover from corrupt .json file', async () => {
      // Write garbage JSON
      await writeFile(cachePath + '.json', 'not valid json', 'utf-8');
      await writeFile(cachePath + '.bin', Buffer.alloc(100));

      const cache = new PersistentEmbeddingCache({ cachePath });
      await cache.initialize();
      expect(cache.size).toBe(0);
    });

    it('should recover from missing .bin file with valid .json', async () => {
      // Write valid JSON but no .bin file
      const index = {
        version: 1,
        modelName: 'default',
        dimensions: 384,
        entries: { 'abc123': { slot: 0, lastAccess: 1 } },
        nextSlot: 1,
        freeSlots: [],
      };
      await writeFile(cachePath + '.json', JSON.stringify(index), 'utf-8');

      const cache = new PersistentEmbeddingCache({ cachePath });
      await cache.initialize();
      expect(cache.size).toBe(0);
    });
  });

  describe('buffer growth', () => {
    it('should grow buffer beyond initial allocation', async () => {
      // INITIAL_ALLOCATED_SLOTS is 1000, so adding 1001+ entries triggers growth
      // Use small dimensions to keep test fast
      const cache = new PersistentEmbeddingCache({
        cachePath,
        maxEntries: 2000,
        dimensions: 4,
      });
      await cache.initialize();

      // Add more entries than initial allocation
      for (let i = 0; i < 1100; i++) {
        const vec = new Float32Array(4);
        vec.fill(i / 1000);
        cache.set(`h${i}`, vec);
      }

      expect(cache.size).toBe(1100);

      // Verify first and last entries are valid
      const first = cache.get('h0');
      expect(first).toBeDefined();
      expect(first![0]).toBeCloseTo(0);

      const last = cache.get('h1099');
      expect(last).toBeDefined();
      expect(last![0]).toBeCloseTo(1.099);
    });
  });

  describe('free slot reuse', () => {
    it('should reuse evicted slots for new entries', async () => {
      const cache = new PersistentEmbeddingCache({
        cachePath,
        maxEntries: 3,
        dimensions: 4,
      });
      await cache.initialize();

      // Fill cache
      for (let i = 0; i < 3; i++) {
        const vec = new Float32Array(4);
        vec.fill(i + 1);
        cache.set(`h${i}`, vec);
      }
      expect(cache.size).toBe(3);

      // Evict h0 by adding h3
      const vec3 = new Float32Array(4);
      vec3.fill(10);
      cache.set('h3', vec3);
      expect(cache.size).toBe(3);
      expect(cache.get('h0')).toBeUndefined();

      // h3 should have reused h0's slot — verify it reads correctly
      const result = cache.get('h3');
      expect(result).toBeDefined();
      expect(result![0]).toBeCloseTo(10);

      // Flush and reload to verify slot reuse persists
      await cache.flush();
      const cache2 = new PersistentEmbeddingCache({
        cachePath,
        maxEntries: 3,
        dimensions: 4,
      });
      await cache2.initialize();
      expect(cache2.size).toBe(3);

      const reloaded = cache2.get('h3');
      expect(reloaded).toBeDefined();
      expect(reloaded![0]).toBeCloseTo(10);
    });
  });

  describe('flush optimization', () => {
    it('should not write .bin on read-only access', async () => {
      const cache = new PersistentEmbeddingCache({ cachePath });
      await cache.initialize();

      // Write data and flush
      cache.set(computeEmbeddingHash('test'), makeVector(1.0));
      await cache.flush();

      // Record .bin modification time
      const { stat } = await import('fs/promises');
      const binStatBefore = await stat(cachePath + '.bin');

      // Wait a bit to ensure mtime would differ
      await new Promise(resolve => setTimeout(resolve, 50));

      // Read-only access (only updates access counters)
      cache.get(computeEmbeddingHash('test'));
      await cache.flush();

      // .bin should NOT have been rewritten
      const binStatAfter = await stat(cachePath + '.bin');
      expect(binStatAfter.mtimeMs).toBe(binStatBefore.mtimeMs);
    });
  });
});
