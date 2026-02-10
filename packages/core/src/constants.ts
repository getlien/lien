/**
 * Centralized constants for @liendev/core.
 * This file contains all magic numbers and configuration defaults.
 */

// Chunking settings
export const DEFAULT_CHUNK_SIZE = 75;
export const DEFAULT_CHUNK_OVERLAP = 10;

// Concurrency and batching
export const DEFAULT_CONCURRENCY = 4;
export const DEFAULT_EMBEDDING_BATCH_SIZE = 50;

// Micro-batching for event loop yielding
// Process N embeddings at a time, then yield to event loop
// This prevents UI freezing during CPU-intensive embedding generation
export const EMBEDDING_MICRO_BATCH_SIZE = 10;

// Vector database batch size limits
// Maximum batch size before splitting (prevents LanceDB errors on very large batches)
export const VECTOR_DB_MAX_BATCH_SIZE = 1000;
// Minimum batch size for retry logic (stop splitting below this size)
export const VECTOR_DB_MIN_BATCH_SIZE = 10;

// Embedding model configuration
export const EMBEDDING_DIMENSIONS = 384; // all-MiniLM-L6-v2
export const DEFAULT_EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';

// MCP server configuration
export const DEFAULT_PORT = 7133; // LIEN in leetspeak
export const VERSION_CHECK_INTERVAL_MS = 2000;

// Git detection
export const DEFAULT_GIT_POLL_INTERVAL_MS = 10000; // Check every 10 seconds

// File watching
export const DEFAULT_DEBOUNCE_MS = 1000;


// File query estimation
// Maximum chunks expected per file when sizing scan queries.
// Used by both the LanceDB query layer and MCP handler to avoid full table scans.
export const MAX_CHUNKS_PER_FILE = 100;

// Index format version - bump on ANY breaking change to indexing
// Examples that require version bump:
// - Chunking algorithm changes
// - Embedding model changes (e.g., switch from all-MiniLM-L6-v2 to another model)
// - Vector DB schema changes (new metadata fields)
// - Metadata structure changes
// v2: AST-based chunking + enhanced metadata (symbolName, complexity, etc.)
// v3: Added cognitiveComplexity field to schema
// v4: Added Halstead metrics (volume, difficulty, effort, bugs)
export const INDEX_FORMAT_VERSION = 4;

// Persistent embedding cache
export const DEFAULT_EMBEDDING_CACHE_MAX_ENTRIES = 50_000;
