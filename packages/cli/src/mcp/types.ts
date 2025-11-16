import { SearchResult } from '../vectordb/types.js';
import { TestAssociation } from '../indexer/types.js';

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
 * Test association information for file context
 */
export interface FileTestAssociation {
  isTest: boolean;
  framework?: string;
  relatedTests?: string[];
  relatedSources?: string[];
  detectionMethod?: string;
}

/**
 * Response for get_file_context tool
 */
export interface FileContextResponse {
  indexInfo: IndexMetadata;
  file: string;
  chunks: SearchResult[];
  testAssociations?: FileTestAssociation;
  note?: string;
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

/**
 * Helper to create test association from chunk metadata
 */
export function createFileTestAssociation(association: TestAssociation): FileTestAssociation {
  return {
    isTest: association.isTest,
    framework: association.framework,
    relatedTests: association.relatedTests,
    relatedSources: association.relatedSources,
    detectionMethod: association.detectionMethod,
  };
}

