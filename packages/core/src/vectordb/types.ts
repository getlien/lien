import { ChunkMetadata } from '../indexer/types.js';
import { RelevanceCategory } from './relevance.js';

export interface SearchResult {
  content: string;
  metadata: ChunkMetadata;
  /**
   * Similarity score from vector search.
   *
   * For semantic search operations, this is the distance metric (e.g., cosine distance)
   * returned by the vector database, where lower values indicate more similar results.
   * For scroll/scan-based operations (e.g. scanWithFilter, scanAll, querySymbols),
   * this is always 0 because no scoring is performed.
   */
  score: number;
  /**
   * Relevance category derived from the score.
   *
   * For scroll/scan-based operations that do not compute scores, this is
   * always 'not_relevant' to indicate that results are unscored rather than
   * semantically irrelevant.
   */
  relevance: RelevanceCategory;
}

export interface VectorDBInterface {
  /** Path to local storage (used for manifest and version files, even with remote backends like Qdrant) */
  readonly dbPath: string;
  initialize(): Promise<void>;
  insertBatch(vectors: Float32Array[], metadatas: ChunkMetadata[], contents: string[]): Promise<void>;
  search(queryVector: Float32Array, limit?: number, query?: string): Promise<SearchResult[]>;
  scanWithFilter(options: {
    language?: string;
    pattern?: string;
    limit?: number;
  }): Promise<SearchResult[]>;
  scanAll(options?: {
    language?: string;
    pattern?: string;
  }): Promise<SearchResult[]>;
  querySymbols(options: {
    language?: string;
    pattern?: string;
    symbolType?: 'function' | 'method' | 'class' | 'interface';
    limit?: number;
  }): Promise<SearchResult[]>;
  clear(): Promise<void>;
  deleteByFile(filepath: string): Promise<void>;
  updateFile(filepath: string, vectors: Float32Array[], metadatas: ChunkMetadata[], contents: string[]): Promise<void>;
  hasData(): Promise<boolean>;
  checkVersion(): Promise<boolean>;
  reconnect(): Promise<void>;
  getCurrentVersion(): number;
  getVersionDate(): string;
}

