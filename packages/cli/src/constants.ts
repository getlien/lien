/**
 * Centralized constants for the Lien project.
 * This file contains all magic numbers and configuration defaults
 * to ensure consistency across the codebase.
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

// Configuration version
export const CURRENT_CONFIG_VERSION = '0.3.0';

// Index format version - bump on ANY breaking change to indexing
// Examples that require version bump:
// - Chunking algorithm changes
// - Embedding model changes (e.g., switch from all-MiniLM-L6-v2 to another model)
// - Vector DB schema changes (new metadata fields)
// - Metadata structure changes
export const INDEX_FORMAT_VERSION = 1;

