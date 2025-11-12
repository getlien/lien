import { ChunkMetadata } from '../indexer/types.js';

export interface SearchResult {
  content: string;
  metadata: ChunkMetadata;
  score: number;
}

export interface VectorDBInterface {
  initialize(): Promise<void>;
  insertBatch(vectors: Float32Array[], metadatas: ChunkMetadata[], contents: string[]): Promise<void>;
  search(queryVector: Float32Array, limit?: number): Promise<SearchResult[]>;
  clear(): Promise<void>;
  deleteByFile(filepath: string): Promise<void>;
  updateFile(filepath: string, vectors: Float32Array[], metadatas: ChunkMetadata[], contents: string[]): Promise<void>;
  hasData(): Promise<boolean>;
}

