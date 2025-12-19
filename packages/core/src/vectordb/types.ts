import { ChunkMetadata } from '../indexer/types.js';
import { RelevanceCategory } from './relevance.js';

export interface SearchResult {
  content: string;
  metadata: ChunkMetadata;
  score: number;
  relevance: RelevanceCategory;
}

export interface VectorDBInterface {
  /** Path to local storage (used for manifest and version files, even with remote backends like Qdrant) */
  readonly dbPath: string;
  initialize(): Promise<void>;
  insertBatch(vectors: Float32Array[], metadatas: ChunkMetadata[], contents: string[]): Promise<void>;
  search(queryVector: Float32Array, limit?: number): Promise<SearchResult[]>;
  scanWithFilter(options: {
    language?: string;
    pattern?: string;
    limit?: number;
  }): Promise<SearchResult[]>;
  querySymbols(options: {
    language?: string;
    pattern?: string;
    symbolType?: 'function' | 'class' | 'interface';
    limit?: number;
  }): Promise<SearchResult[]>;
  clear(): Promise<void>;
  deleteByFile(filepath: string): Promise<void>;
  updateFile(filepath: string, vectors: Float32Array[], metadatas: ChunkMetadata[], contents: string[]): Promise<void>;
  hasData(): Promise<boolean>;
}

