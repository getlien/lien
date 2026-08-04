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

// Indexable-file size ceiling (#1025): a single file this large is almost
// never real source, and chunking it whole is what turned 462 files into a
// 10.5 GB index on a maintainer's machine (the files responsible were OS
// cache/binary blobs, not source at any plausible size). This is a backstop
// independent of path-based filtering (ALWAYS_IGNORE_PATTERNS, the
// home-root guard in cli/unsafe-root.ts) — it protects an ordinary project
// against an accidentally committed multi-GB blob exactly as much as it
// protects an explicitly-overridden home-root index against a keychain
// database. 5 MB comfortably clears every real source/config/doc file this
// codebase (or any typical one) produces.
export const MAX_INDEXABLE_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/** Whether `sizeBytes` exceeds {@link MAX_INDEXABLE_FILE_SIZE_BYTES}. */
export function isOversizedForIndexing(sizeBytes: number): boolean {
  return sizeBytes > MAX_INDEXABLE_FILE_SIZE_BYTES;
}

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
