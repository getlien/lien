import { SearchResult } from '../vectordb/types.js';

/**
 * Metadata about the index state
 */
export interface IndexMetadata {
  lastIndexed: string | null;
  version: number;
  hasData: boolean;
}

/**
 * Response for semantic_search tool
 */
export interface SearchResultResponse {
  indexInfo: IndexMetadata;
  results: SearchResult[];
}

/**
 * Response for get_files_context tool (single file)
 */
export interface FilesContextResponse {
  indexInfo: IndexMetadata;
  file: string;
  chunks: SearchResult[];
  note?: string;
}

/**
 * Response for get_files_context tool (multiple files)
 */
export interface FilesContextMultiResponse {
  indexInfo: IndexMetadata;
  files: Record<string, { chunks: SearchResult[] }>;
}

/**
 * Response for find_similar tool
 */
export interface SimilarCodeResponse {
  indexInfo: IndexMetadata;
  results: SearchResult[];
}

/**
 * Symbol information
 */
export interface SymbolInfo {
  name: string;
  file: string;
  language: string;
  type: 'function' | 'class' | 'interface';
}

/**
 * Response for list_functions tool
 */
export interface SymbolListResponse {
  indexInfo: IndexMetadata;
  symbols: SymbolInfo[];
  method: 'symbols' | 'content';
  note?: string;
}

/**
 * Helper to create index metadata
 */
export function createIndexMetadata(
  lastIndexed: string | null,
  version: number,
  hasData: boolean
): IndexMetadata {
  return {
    lastIndexed,
    version,
    hasData,
  };
}

