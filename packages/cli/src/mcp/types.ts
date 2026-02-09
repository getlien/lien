import type { SearchResult, VectorDBInterface, EmbeddingService } from '@liendev/core';
import type { ReindexState } from './reindex-state-manager.js';

/**
 * MCP log levels matching the protocol specification.
 */
export type LogLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error';

/**
 * Logging function type for MCP server.
 * Supports optional log level (defaults to 'info' for informational messages).
 */
export type LogFn = (message: string, level?: LogLevel) => void;

/**
 * Shared context passed to all tool handlers.
 * Contains dependencies and utilities needed by handlers.
 */
export interface ToolContext {
  /** Vector database instance for queries */
  vectorDB: VectorDBInterface;
  /** Embeddings instance for generating vectors */
  embeddings: EmbeddingService;
  /** Workspace root directory */
  rootDir: string;
  /** Logging function (logs via MCP notifications with proper levels) */
  log: LogFn;
  /** Check if index has been updated and reconnect if needed */
  checkAndReconnect: () => Promise<void>;
  /** Get current index metadata for responses */
  getIndexMetadata: () => {
    indexVersion: number;
    indexDate: string;
    reindexInProgress?: boolean;
    pendingFileCount?: number;
    lastReindexDurationMs?: number | null;
    msSinceLastReindex?: number | null;
  };
  /** Get current reindex state */
  getReindexState: () => ReindexState;
}

/**
 * Result type for MCP tool handlers
 */
export interface MCPToolResult {
  isError?: boolean;
  content?: Array<{ type: 'text'; text: string }>;
  [key: string]: unknown;
}

/**
 * Type for a tool handler function
 */
export type ToolHandler = (
  args: unknown,
  ctx: ToolContext
) => Promise<MCPToolResult>;

/**
 * Metadata about the index state
 */
export interface IndexMetadata {
  lastIndexed: string | null;
  version: number;
  hasData: boolean;
  // Reindex status fields
  reindexInProgress?: boolean;
  pendingFileCount?: number;
  lastReindexDurationMs?: number | null;
  msSinceLastReindex?: number | null;
}

/**
 * Response for semantic_search tool
 */
export interface SearchResultResponse {
  indexInfo: IndexMetadata;
  results: SearchResult[];
  /** Warning note when cross-repo fallback occurs or other issues */
  note?: string;
}

/**
 * Response for get_files_context tool (single file)
 */
export interface FilesContextResponse {
  indexInfo: IndexMetadata;
  file: string;
  chunks: SearchResult[];
  testAssociations: string[];
  note?: string;
}

/**
 * Response for get_files_context tool (multiple files)
 */
export interface FilesContextMultiResponse {
  indexInfo: IndexMetadata;
  files: Record<string, { 
    chunks: SearchResult[];
    testAssociations: string[];
  }>;
  /** Warning note when scan limit reached or other issues */
  note?: string;
}

/**
 * Response for find_similar tool
 */
export interface SimilarCodeResponse {
  indexInfo: IndexMetadata;
  results: SearchResult[];
  /** Diagnostic note when no results are found */
  note?: string;
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

