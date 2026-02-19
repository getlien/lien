/**
 * Constants used by the parser/chunking layer.
 * These will move to @liendev/parser during extraction.
 */

// Chunking settings
export const DEFAULT_CHUNK_SIZE = 75;
export const DEFAULT_CHUNK_OVERLAP = 10;

// File query estimation
// Maximum chunks expected per file when sizing scan queries.
export const MAX_CHUNKS_PER_FILE = 100;
