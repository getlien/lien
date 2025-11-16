import { EMBEDDING_DIMENSIONS } from '../constants.js';

export interface EmbeddingService {
  initialize(): Promise<void>;
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
}

export const EMBEDDING_DIMENSION = EMBEDDING_DIMENSIONS;

