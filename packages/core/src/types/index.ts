/**
 * @liendev/core types
 *
 * All shared types for Lien - single source of truth
 */

// Re-export from modules
export type { ChunkMetadata, CodeChunk, ScanOptions } from '@liendev/lien-parser';
export type { SearchResult, VectorDBInterface } from '../vectordb/types.js';
export type { EmbeddingService } from '../embeddings/types.js';
export type {
  LienConfig,
  LegacyLienConfig,
  FrameworkConfig,
  FrameworkInstance,
} from '../config/schema.js';
export type { GitState } from '../git/tracker.js';
export type { RelevanceCategory } from '../vectordb/relevance.js';

// Complexity types
export type {
  RiskLevel,
  ComplexityMetricType,
  HalsteadDetails,
  ComplexityViolation,
  FileComplexityData,
  ComplexityReport,
} from '@liendev/lien-parser';

// Re-export risk order constant
export { RISK_ORDER } from '@liendev/lien-parser';
