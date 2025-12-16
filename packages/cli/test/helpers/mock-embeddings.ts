import type { EmbeddingService } from '@liendev/core';
import { EMBEDDING_DIMENSION } from '@liendev/core';

/**
 * Mock embeddings service for testing.
 * Generates deterministic fake embeddings based on text content.
 */
export class MockEmbeddings implements EmbeddingService {
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async embed(text: string): Promise<Float32Array> {
    if (!this.initialized) {
      throw new Error('MockEmbeddings not initialized');
    }

    // Generate deterministic embedding based on text hash
    const hash = simpleHash(text);
    const embedding = new Float32Array(EMBEDDING_DIMENSION);

    for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
      // Use sine wave with hash offset for deterministic but varied values
      embedding[i] = Math.sin((hash + i) * 0.01) * 0.1;
    }

    return embedding;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (!this.initialized) {
      throw new Error('MockEmbeddings not initialized');
    }

    return Promise.all(texts.map(text => this.embed(text)));
  }
}

/**
 * Simple hash function for deterministic fake embeddings
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

