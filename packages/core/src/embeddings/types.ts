import { EMBEDDING_DIMENSIONS } from '../constants.js';

export interface EmbeddingService {
  initialize(): Promise<void>;
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  dispose(): Promise<void>;
}

export const EMBEDDING_DIMENSION = EMBEDDING_DIMENSIONS;

// Re-export for convenience
export { EMBEDDING_DIMENSIONS };
