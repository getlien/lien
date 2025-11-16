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

