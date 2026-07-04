import type { ChunkMetadata } from '@liendev/parser';
import type { RelevanceCategory } from './relevance.js';

export interface SearchResult {
  content: string;
  metadata: ChunkMetadata;
  /**
   * Search score. For lexical `search`, a BM25-derived value where lower
   * means a better match. For scroll/scan operations (scanWithFilter, scanAll,
   * querySymbols) this is always 0 because no scoring is performed.
   */
  score: number;
  /**
   * Relevance category derived from the score. For scroll/scan operations that
   * do not compute scores this is always 'not_relevant' to indicate the
   * results are unscored rather than irrelevant.
   */
  relevance: RelevanceCategory;
}

/** Maps symbolType filter values to the set of matching record types */
export const SYMBOL_TYPE_MATCHES: Record<string, Set<string>> = {
  function: new Set(['function', 'method']),
  method: new Set(['method']),
  class: new Set(['class']),
  interface: new Set(['interface']),
};

export interface VectorDBInterface {
  /** Path to local storage (used for manifest and version files) */
  readonly dbPath: string;
  initialize(): Promise<void>;
  insertBatch(metadatas: ChunkMetadata[], contents: string[]): Promise<void>;
  /** Lexical (FTS5/BM25) full-text search over the query string. */
  search(query: string, limit?: number): Promise<SearchResult[]>;
  scanWithFilter(options: {
    file?: string | string[];
    language?: string;
    pattern?: string;
    symbolType?: 'function' | 'method' | 'class' | 'interface';
    limit?: number;
  }): Promise<SearchResult[]>;
  scanAll(options?: { language?: string; pattern?: string }): Promise<SearchResult[]>;
  querySymbols(options: {
    language?: string;
    pattern?: string;
    symbolType?: 'function' | 'method' | 'class' | 'interface';
    limit?: number;
  }): Promise<SearchResult[]>;
  clear(): Promise<void>;
  deleteByFile(filepath: string): Promise<void>;
  updateFile(filepath: string, metadatas: ChunkMetadata[], contents: string[]): Promise<void>;
  hasData(): Promise<boolean>;
  checkVersion(): Promise<boolean>;
  /** Scan all chunks using paginated iteration. Yields pages to avoid loading everything into memory. */
  scanPaginated(options?: { pageSize?: number }): AsyncGenerator<SearchResult[]>;
  reconnect(): Promise<void>;
  getCurrentVersion(): number;
  getVersionDate(): string;
  /** Whether this backend supports cross-repo operations. */
  readonly supportsCrossRepo: boolean;
  /** True for the worktree overlay backend (shared read-only base + writable
   *  overlay). Lets the indexer route to the overlay build instead of a full
   *  reindex of the worktree. */
  readonly isOverlay: boolean;
  /** Scan across all repos in the organization. Returns [] if unsupported. */
  scanCrossRepo(options: {
    language?: string;
    pattern?: string;
    limit?: number;
    repoIds?: string[];
    branch?: string;
  }): Promise<SearchResult[]>;
}
