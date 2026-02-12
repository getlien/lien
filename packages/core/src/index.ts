/**
 * @liendev/core - Lien's indexing and analysis engine
 *
 * This is the public API for:
 * - @liendev/cli (CLI commands)
 * - @liendev/action (GitHub Action)
 * - @liendev/cloud (Cloud workers)
 * - Third-party integrations
 *
 * @example
 * ```typescript
 * import {
 *   indexCodebase,
 *   VectorDB,
 *   ComplexityAnalyzer,
 * } from '@liendev/core';
 *
 * // Index a codebase
 * const result = await indexCodebase({ rootDir: '/path/to/project' });
 *
 * // Run complexity analysis
 * const db = await VectorDB.load('/path/to/project');
 * const analyzer = new ComplexityAnalyzer(db);
 * const report = await analyzer.analyze();
 * ```
 */

// =============================================================================
// INDEXING
// =============================================================================

export { indexCodebase } from './indexer/index.js';
export type { IndexingOptions, IndexingProgress, IndexingResult } from './indexer/index.js';
export { ManifestManager } from './indexer/manifest.js';
export type { IndexManifest, FileEntry } from './indexer/manifest.js';
export { chunkFile } from './indexer/chunker.js';
export { scanCodebase, detectFileType } from './indexer/scanner.js';
/** @deprecated Use {@link detectFileType} instead. */
export { detectFileType as detectLanguage } from './indexer/scanner.js';
export {
  indexSingleFile,
  indexMultipleFiles,
  normalizeToRelativePath,
} from './indexer/incremental.js';
export { createGitignoreFilter, ALWAYS_IGNORE_PATTERNS } from './indexer/gitignore.js';
export { extractSymbols } from './indexer/symbol-extractor.js';
export { computeContentHash, isHashAlgorithmCompatible } from './indexer/content-hash.js';
export {
  groupChunksByNormalizedPath,
  findTransitiveDependents,
} from './indexer/dependency-analyzer.js';
export { findTestAssociationsFromChunks } from './indexer/test-associations.js';
export {
  detectEcosystems,
  getEcosystemExcludePatterns,
  ECOSYSTEM_PRESETS,
} from './indexer/ecosystem-presets.js';
export type { EcosystemPreset } from './indexer/ecosystem-presets.js';

// =============================================================================
// EMBEDDINGS
// =============================================================================

export { LocalEmbeddings } from './embeddings/local.js';
export { WorkerEmbeddings } from './embeddings/worker-embeddings.js';
export { CachedEmbeddings } from './embeddings/cache.js';
export type { EmbeddingService } from './embeddings/types.js';
export { EMBEDDING_DIMENSION, EMBEDDING_DIMENSIONS } from './embeddings/types.js';

// =============================================================================
// VECTOR DATABASE
// =============================================================================

export { VectorDB } from './vectordb/lancedb.js';
export { QdrantDB } from './vectordb/qdrant.js';
export { createVectorDB } from './vectordb/factory.js';
export type { VectorDBInterface, SearchResult } from './vectordb/types.js';
export { SYMBOL_TYPE_MATCHES } from './vectordb/types.js';
export { calculateRelevance } from './vectordb/relevance.js';
export type { RelevanceCategory } from './vectordb/relevance.js';
export { readVersionFile, writeVersionFile } from './vectordb/version.js';

// =============================================================================
// COMPLEXITY ANALYSIS
// =============================================================================

export { ComplexityAnalyzer } from './insights/complexity-analyzer.js';
export {
  formatReport,
  formatTextReport,
  formatJsonReport,
  formatSarifReport,
} from './insights/formatters/index.js';
export type { OutputFormat } from './insights/formatters/index.js';

// =============================================================================
// GLOBAL CONFIGURATION
// =============================================================================

export {
  loadGlobalConfig,
  saveGlobalConfig,
  mergeGlobalConfig,
  ConfigValidationError,
} from './config/global-config.js';
export type { GlobalConfig } from './config/global-config.js';

// =============================================================================
// GIT UTILITIES
// =============================================================================

export {
  isGitRepo,
  isGitAvailable,
  getCurrentBranch,
  getCurrentCommit,
  getChangedFiles,
  getChangedFilesBetweenCommits,
} from './git/utils.js';

export { GitStateTracker } from './git/tracker.js';
export type { GitState } from './git/tracker.js';

// =============================================================================
// FRAMEWORK DETECTION (DEPRECATED - replaced by ecosystem presets)
// =============================================================================
// These types are kept for backward compatibility with old configs.
// The framework detection system has been removed.
// Use detectEcosystems() and getEcosystemExcludePatterns() instead.

// =============================================================================
// ERRORS
// =============================================================================

export {
  LienError,
  LienErrorCode,
  ConfigError,
  IndexingError,
  EmbeddingError,
  DatabaseError,
  wrapError,
  isLienError,
  getErrorMessage,
  getErrorStack,
} from './errors/index.js';

// =============================================================================
// TYPES
// =============================================================================

export type {
  // Chunks
  ChunkMetadata,
  CodeChunk,
  ScanOptions,

  // Complexity
  RiskLevel,
  ComplexityMetricType,
  HalsteadDetails,
  ComplexityViolation,
  FileComplexityData,
  ComplexityReport,
} from './types/index.js';

export { RISK_ORDER } from './types/index.js';

// =============================================================================
// CONSTANTS
// =============================================================================

export {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CONCURRENCY,
  DEFAULT_EMBEDDING_BATCH_SIZE,
  EMBEDDING_MICRO_BATCH_SIZE,
  VECTOR_DB_MAX_BATCH_SIZE,
  VECTOR_DB_MIN_BATCH_SIZE,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_PORT,
  VERSION_CHECK_INTERVAL_MS,
  DEFAULT_GIT_POLL_INTERVAL_MS,
  DEFAULT_DEBOUNCE_MS,
  INDEX_FORMAT_VERSION,
  MAX_CHUNKS_PER_FILE,
} from './constants.js';

// =============================================================================
// UTILITIES
// =============================================================================

export { Result, Ok, Err, isOk, isErr, unwrap, unwrapOr } from './utils/result.js';
export { normalizePath, matchesFile, getCanonicalPath, isTestFile } from './utils/path-matching.js';
export { safeRegex } from './utils/safe-regex.js';
export { extractRepoId } from './utils/repo-id.js';

// =============================================================================
// AST LANGUAGE REGISTRY
// =============================================================================

export { getSupportedExtensions } from './indexer/ast/languages/registry.js';
