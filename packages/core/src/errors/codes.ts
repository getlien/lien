/**
 * Error codes for all Lien-specific errors.
 * Used to identify error types programmatically.
 */
export enum LienErrorCode {
  // Configuration
  CONFIG_NOT_FOUND = 'CONFIG_NOT_FOUND',
  CONFIG_INVALID = 'CONFIG_INVALID',
  
  // Index
  INDEX_NOT_FOUND = 'INDEX_NOT_FOUND',
  INDEX_CORRUPTED = 'INDEX_CORRUPTED',
  
  // Embeddings
  EMBEDDING_MODEL_FAILED = 'EMBEDDING_MODEL_FAILED',
  EMBEDDING_GENERATION_FAILED = 'EMBEDDING_GENERATION_FAILED',
  
  // File System
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  FILE_NOT_READABLE = 'FILE_NOT_READABLE',
  INVALID_PATH = 'INVALID_PATH',
  
  // Tool Input
  INVALID_INPUT = 'INVALID_INPUT',
  
  // System
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

