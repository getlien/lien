/**
 * Centralized constants for @liendev/core.
 * This file contains all magic numbers and configuration defaults.
 */

// Re-export parser constants for backward compatibility
export {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_OVERLAP,
  MAX_CHUNKS_PER_FILE,
  PARSE_STAGE_MAX_CONCURRENCY,
  getParseStageConcurrency,
} from '@liendev/parser';

// Concurrency and batching
export const DEFAULT_CONCURRENCY = 4;
export const DEFAULT_STAT_CONCURRENCY = 32; // Higher concurrency for I/O-bound stat calls

// MCP server configuration
export const DEFAULT_PORT = 7133; // LIEN in leetspeak
export const VERSION_CHECK_INTERVAL_MS = 2000;

// Git detection
export const DEFAULT_GIT_POLL_INTERVAL_MS = 10000; // Check every 10 seconds

// Index format version - bump on ANY breaking change to indexing
// Examples that require version bump:
// - Chunking algorithm changes
// - Structural store schema changes (new metadata fields/columns)
// - Metadata structure changes
// v2: AST-based chunking + enhanced metadata (symbolName, complexity, etc.)
// v3: Added cognitiveComplexity field to schema
// v4: Added Halstead metrics (volume, difficulty, effort, bugs)
// v5: Resolved relative imports to workspace-relative paths in chunk metadata (#525)
export const INDEX_FORMAT_VERSION = 5;
