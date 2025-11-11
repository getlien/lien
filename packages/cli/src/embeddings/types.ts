export interface EmbeddingService {
  initialize(): Promise<void>;
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
}

export const EMBEDDING_DIMENSION = 384; // all-MiniLM-L6-v2

