import { EmbeddingService } from './types.js';

/**
 * LRU cache for embeddings with configurable max size.
 * Wraps any EmbeddingService to add caching functionality.
 * 
 * Benefits:
 * - Faster repeated searches
 * - Reduced CPU usage
 * - Better user experience for common queries
 */
export class CachedEmbeddings implements EmbeddingService {
  private cache = new Map<string, Float32Array>();
  private readonly maxSize: number;
  private readonly underlying: EmbeddingService;

  /**
   * Creates a new cached embeddings service
   * @param underlying - The underlying embedding service to wrap
   * @param maxSize - Maximum number of embeddings to cache (default: 1000)
   */
  constructor(underlying: EmbeddingService, maxSize: number = 1000) {
    this.underlying = underlying;
    this.maxSize = maxSize;
  }

  async initialize(): Promise<void> {
    return this.underlying.initialize();
  }

  async embed(text: string): Promise<Float32Array> {
    // Check cache first
    const cached = this.cache.get(text);
    if (cached) {
      return cached;
    }

    // Generate embedding
    const result = await this.underlying.embed(text);

    // Add to cache with LRU eviction
    if (this.cache.size >= this.maxSize) {
      // Remove oldest entry (first key in Map)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(text, result);
    return result;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const results: Float32Array[] = [];
    const uncachedTexts: string[] = [];
    const uncachedIndices: number[] = [];

    // Check cache for each text
    for (let i = 0; i < texts.length; i++) {
      const cached = this.cache.get(texts[i]);
      if (cached) {
        results[i] = cached;
      } else {
        uncachedTexts.push(texts[i]);
        uncachedIndices.push(i);
      }
    }

    // Generate embeddings for uncached texts
    if (uncachedTexts.length > 0) {
      const newEmbeddings = await this.underlying.embedBatch(uncachedTexts);

      // Store in cache and results
      for (let i = 0; i < newEmbeddings.length; i++) {
        const text = uncachedTexts[i];
        const embedding = newEmbeddings[i];
        const resultIndex = uncachedIndices[i];

        // Add to cache with LRU eviction
        if (this.cache.size >= this.maxSize) {
          const firstKey = this.cache.keys().next().value;
          if (firstKey !== undefined) {
            this.cache.delete(firstKey);
          }
        }

        this.cache.set(text, embedding);
        results[resultIndex] = embedding;
      }
    }

    return results;
  }

  /**
   * Gets the current cache size
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Gets cache statistics
   */
  getCacheStats(): { size: number; maxSize: number; hitRate?: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
    };
  }

  /**
   * Clears the cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Checks if a text is in the cache
   */
  has(text: string): boolean {
    return this.cache.has(text);
  }

  async dispose(): Promise<void> {
    this.cache.clear();
    await this.underlying.dispose();
  }
}

