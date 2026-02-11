import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CachedEmbeddings } from './cache.js';
import type { EmbeddingService } from './types.js';

// Mock embedding service for testing
class MockEmbeddingService implements EmbeddingService {
  embedCallCount = 0;
  embedBatchCallCount = 0;

  async initialize(): Promise<void> {
    // No-op
  }

  async embed(text: string): Promise<Float32Array> {
    this.embedCallCount++;
    // Generate a simple embedding based on text length
    const embedding = new Float32Array(384);
    embedding.fill(text.length / 1000);
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    this.embedBatchCallCount++;
    return Promise.all(texts.map(text => this.embed(text)));
  }

  async dispose(): Promise<void> {
    // No-op for mock
  }
}

describe('CachedEmbeddings', () => {
  let mockService: MockEmbeddingService;
  let cachedService: CachedEmbeddings;

  beforeEach(() => {
    mockService = new MockEmbeddingService();
    cachedService = new CachedEmbeddings(mockService, 5); // Small cache for testing
  });

  describe('embed', () => {
    it('should cache embeddings for repeated queries', async () => {
      const text = 'test query';

      // First call - should hit underlying service
      const result1 = await cachedService.embed(text);
      expect(mockService.embedCallCount).toBe(1);
      expect(result1).toBeInstanceOf(Float32Array);

      // Second call - should use cache
      const result2 = await cachedService.embed(text);
      expect(mockService.embedCallCount).toBe(1); // No additional call
      expect(result2).toBe(result1); // Same object reference
    });

    it('should evict oldest entry when cache is full', async () => {
      // Fill cache to capacity
      await cachedService.embed('query1');
      await cachedService.embed('query2');
      await cachedService.embed('query3');
      await cachedService.embed('query4');
      await cachedService.embed('query5');

      expect(cachedService.getCacheSize()).toBe(5);

      // Add one more - should evict query1 (oldest)
      await cachedService.embed('query6');
      expect(cachedService.getCacheSize()).toBe(5);

      // query1 should now require re-embedding
      mockService.embedCallCount = 0;
      await cachedService.embed('query1');
      expect(mockService.embedCallCount).toBe(1);

      // query6 should still be cached (most recent)
      await cachedService.embed('query6');
      expect(mockService.embedCallCount).toBe(1); // No additional call

      // query3, 4, 5 should still be cached
      await cachedService.embed('query3');
      expect(mockService.embedCallCount).toBe(1);
    });

    it('should handle different texts correctly', async () => {
      const result1 = await cachedService.embed('short');
      const result2 = await cachedService.embed('longer text');

      expect(result1[0]).not.toBe(result2[0]);
    });
  });

  describe('embedBatch', () => {
    it('should cache all embeddings from batch', async () => {
      const texts = ['query1', 'query2', 'query3'];

      // First batch call
      await cachedService.embedBatch(texts);
      expect(mockService.embedCallCount).toBe(3);

      // Re-embed individually - should all be cached
      mockService.embedCallCount = 0;
      for (const text of texts) {
        await cachedService.embed(text);
      }
      expect(mockService.embedCallCount).toBe(0);
    });

    it('should only generate embeddings for uncached texts', async () => {
      // Cache some texts
      await cachedService.embed('query1');
      await cachedService.embed('query2');

      mockService.embedCallCount = 0;

      // Batch with mix of cached and uncached
      const results = await cachedService.embedBatch([
        'query1', // cached
        'query3', // uncached
        'query2', // cached
        'query4', // uncached
      ]);

      // Should only generate 2 new embeddings
      expect(mockService.embedCallCount).toBe(2);
      expect(results).toHaveLength(4);
      expect(results[0]).toBeInstanceOf(Float32Array);
    });

    it('should handle empty batch', async () => {
      const results = await cachedService.embedBatch([]);
      expect(results).toHaveLength(0);
      expect(mockService.embedCallCount).toBe(0);
    });
  });

  describe('cache management', () => {
    it('should return correct cache size', async () => {
      expect(cachedService.getCacheSize()).toBe(0);

      await cachedService.embed('query1');
      expect(cachedService.getCacheSize()).toBe(1);

      await cachedService.embed('query2');
      expect(cachedService.getCacheSize()).toBe(2);
    });

    it('should provide cache statistics', async () => {
      await cachedService.embed('query1');

      const stats = cachedService.getCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.maxSize).toBe(5);
    });

    it('should clear cache', async () => {
      await cachedService.embed('query1');
      await cachedService.embed('query2');
      expect(cachedService.getCacheSize()).toBe(2);

      cachedService.clearCache();
      expect(cachedService.getCacheSize()).toBe(0);

      // Should re-generate after clear
      mockService.embedCallCount = 0;
      await cachedService.embed('query1');
      expect(mockService.embedCallCount).toBe(1);
    });

    it('should check if text is cached', async () => {
      expect(cachedService.has('query1')).toBe(false);

      await cachedService.embed('query1');
      expect(cachedService.has('query1')).toBe(true);
    });
  });

  describe('initialization', () => {
    it('should forward initialize call to underlying service', async () => {
      const initSpy = vi.spyOn(mockService, 'initialize');

      await cachedService.initialize();
      expect(initSpy).toHaveBeenCalledOnce();
    });
  });

  describe('custom max size', () => {
    it('should respect custom max size', async () => {
      const smallCache = new CachedEmbeddings(mockService, 2);

      await smallCache.embed('query1');
      await smallCache.embed('query2');
      expect(smallCache.getCacheSize()).toBe(2);

      await smallCache.embed('query3');
      expect(smallCache.getCacheSize()).toBe(2); // Should not exceed max
    });

    it('should work with large max size', async () => {
      const largeCache = new CachedEmbeddings(mockService, 10000);

      for (let i = 0; i < 100; i++) {
        await largeCache.embed(`query${i}`);
      }

      expect(largeCache.getCacheSize()).toBe(100);
    });
  });
});
