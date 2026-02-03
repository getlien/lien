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
export { scanCodebase, scanCodebaseWithFrameworks, detectFileType } from './indexer/scanner.js';
/** @deprecated Use {@link detectFileType} instead. */
export { detectFileType as detectLanguage } from './indexer/scanner.js';
export { indexSingleFile, indexMultipleFiles, normalizeToRelativePath } from './indexer/incremental.js';
export { extractSymbols } from './indexer/symbol-extractor.js';
export { computeContentHash, isHashAlgorithmCompatible } from './indexer/content-hash.js';

// =============================================================================
// EMBEDDINGS
// =============================================================================

export { LocalEmbeddings } from './embeddings/local.js';
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
export { formatReport, formatTextReport, formatJsonReport, formatSarifReport } from './insights/formatters/index.js';
export type { OutputFormat } from './insights/formatters/index.js';

// =============================================================================
// CONFIGURATION (DEPRECATED - kept for backward compatibility)
// =============================================================================
// Note: Per-project config is no longer required. Lien now uses:
// - Global config at ~/.lien/config.json (optional, for backend selection)
// - Environment variables (LIEN_BACKEND, LIEN_QDRANT_URL, etc.)
// - Auto-detected frameworks
// - Sensible defaults for all settings

import { ConfigService, configService as _configService } from './config/service.js';
import { defaultConfig as _defaultConfig, isLegacyConfig, isModernConfig } from './config/schema.js';
import type { LienConfig, LegacyLienConfig, FrameworkConfig, FrameworkInstance } from './config/schema.js';

/**
 * @deprecated Per-project config is no longer required. Use global config or environment variables instead.
 * @see loadGlobalConfig in config/global-config.ts
 */
export { ConfigService, _configService as configService };
export type { ValidationResult } from './config/service.js';
/**
 * @deprecated Migration is no longer needed - per-project config is deprecated
 */
// Migration removed - no longer needed
/**
 * @deprecated Migration is no longer needed - per-project config is deprecated
 */
// Migration removed - no longer needed
/**
 * @deprecated Default config is no longer used - Lien uses sensible defaults automatically
 */
export { _defaultConfig as defaultConfig, isLegacyConfig, isModernConfig };
/**
 * @deprecated Config types are kept for backward compatibility only
 */
export type { LienConfig, LegacyLienConfig, FrameworkConfig, FrameworkInstance };

// Per-project config removed - no longer needed
export const createDefaultConfig = () => _defaultConfig;

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
// FRAMEWORK DETECTION
// =============================================================================

export {
  groupByConfidence,
  selectByPriority,
  resolveFrameworkConflicts,
  runAllDetectors,
  detectAllFrameworks,
  getDetectionSummary,
} from './frameworks/detector-service.js';
export type { DetectionWithPriority, GroupedDetections } from './frameworks/detector-service.js';
export { frameworkDetectors, registerFramework, getFrameworkDetector } from './frameworks/registry.js';
export type { FrameworkDetector, DetectionResult, DetectionOptions } from './frameworks/types.js';
export { laravelDetector } from './frameworks/laravel/detector.js';
export { nodejsDetector } from './frameworks/nodejs/detector.js';
export { phpDetector } from './frameworks/php/detector.js';
export { shopifyDetector } from './frameworks/shopify/detector.js';

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
