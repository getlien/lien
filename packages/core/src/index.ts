/**
 * @liendev/core - shared support for the Lien CLI
 *
 * The indexing and search engine this package used to be is gone: the SQLite
 * structural store, the indexer, index GC and FTS5 lexical search were all
 * removed along with the MCP server. What remains is the support layer the
 * CLI needs, plus a handful of parser re-exports kept so existing importers
 * do not have to reach into two packages.
 *
 * For anything analytical — chunking, complexity, dependency resolution,
 * review signals — use `@liendev/parser` directly. That is where the engine
 * actually lives, and it is unchanged.
 *
 * @example
 * ```typescript
 * import { configService } from '@liendev/core';
 * import { performChunkOnlyIndex, analyzeComplexityFromChunks } from '@liendev/parser';
 *
 * // Per-project config (.lien.config.json — complexity.thresholds only)
 * const config = await configService.load(rootDir);
 *
 * // Parse the working tree on demand; there is no index to build or read
 * const scan = await performChunkOnlyIndex(rootDir, {});
 * if (!scan.success) throw new Error(scan.error);
 * const report = analyzeComplexityFromChunks(scan.chunks);
 * ```
 */

export {
  chunkFile,
  scanCodebase,
  detectFileType,
  createGitignoreFilter,
  ALWAYS_IGNORE_PATTERNS,
  extractSymbols,
  computeContentHash,
  isHashAlgorithmCompatible,
  groupChunksByNormalizedPath,
  findTransitiveDependents,
  findTestAssociationsFromChunks,
  detectEcosystems,
  getEcosystemExcludePatterns,
  ECOSYSTEM_PRESETS,
} from '@liendev/parser';
export type { EcosystemPreset, ChunkOptions } from '@liendev/parser';
/** @deprecated Use {@link detectFileType} instead. */
export { detectFileType as detectLanguage } from '@liendev/parser';

// =============================================================================
// COMPLEXITY ANALYSIS
// =============================================================================

export { analyzeComplexityFromChunks } from '@liendev/parser';
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

// =============================================================================
// PROJECT CONFIGURATION (.lien.config.json)
// =============================================================================

export { configService, ConfigService } from './config/service.js';
export type { ValidationResult } from './config/service.js';
export { defaultConfig } from './config/schema.js';
export type { LienConfig } from './config/schema.js';

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

export { detectLinkedWorktree } from './git/worktree.js';
export type { WorktreeInfo } from './git/worktree.js';

// =============================================================================
// FRAMEWORK DETECTION (REMOVED - replaced by ecosystem presets)
// =============================================================================
// The framework detection system and its config types (FrameworkConfig,
// FrameworkInstance) have been removed, including from .lien.config.json —
// see ConfigService's retired-section handling for existing configs that
// still carry a `frameworks` array. Use detectEcosystems() and
// getEcosystemExcludePatterns() instead.

// =============================================================================
// ERRORS
// =============================================================================

export {
  LienError,
  LienErrorCode,
  ConfigError,
  IndexingError,
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
  DEFAULT_PORT,
  VERSION_CHECK_INTERVAL_MS,
  DEFAULT_GIT_POLL_INTERVAL_MS,
  INDEX_FORMAT_VERSION,
  MAX_CHUNKS_PER_FILE,
  MAX_INDEXABLE_FILE_SIZE_BYTES,
  isOversizedForIndexing,
} from './constants.js';

// =============================================================================
// UTILITIES
// =============================================================================

export { Result, Ok, Err, isOk, isErr, unwrap, unwrapOr } from './utils/result.js';
export { normalizePath, matchesFile, getCanonicalPath, isTestFile } from '@liendev/parser';
export { safeRegex } from './utils/safe-regex.js';
export { extractRepoId } from './utils/repo-id.js';
export { getLienHome } from './utils/lien-home.js';

// =============================================================================
// AST LANGUAGE REGISTRY (re-export from parser)
// =============================================================================

export { getSupportedExtensions } from '@liendev/parser';
