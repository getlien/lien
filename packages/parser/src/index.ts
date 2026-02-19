// @liendev/parser - AST parsing, complexity analysis, and semantic chunking

// =============================================================================
// TYPES
// =============================================================================

export type { CodeChunk, ChunkMetadata, ScanOptions } from './types.js';

// Complexity types
export type {
  RiskLevel,
  ComplexityMetricType,
  HalsteadDetails,
  ComplexityViolation,
  FileComplexityData,
  ComplexityReport,
} from './insights/types.js';

export { RISK_ORDER } from './insights/types.js';

// =============================================================================
// CONSTANTS
// =============================================================================

export { DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP, MAX_CHUNKS_PER_FILE } from './constants.js';

// =============================================================================
// UTILITIES
// =============================================================================

export { normalizePath, matchesFile, getCanonicalPath, isTestFile } from './utils/path-matching.js';

export { extractRepoId } from './utils/repo-id.js';

// =============================================================================
// AST
// =============================================================================

export { chunkByAST, shouldUseAST } from './ast/chunker.js';
export type { ASTChunkOptions } from './ast/chunker.js';
export { parseAST, detectLanguage, isASTSupported } from './ast/parser.js';
export {
  extractSymbolInfo,
  extractImports,
  extractImportedSymbols,
  extractExports,
  extractCallSites,
} from './ast/symbols.js';
export type { SupportedLanguage, ASTChunk, SymbolInfo } from './ast/types.js';
export { getTraverser } from './ast/traversers/index.js';
export { getExtractor, getImportExtractor, getSymbolExtractor } from './ast/extractors/index.js';
export { calculateCognitiveComplexity, calculateHalstead } from './ast/complexity/index.js';

// AST Language Registry
export {
  getSupportedExtensions,
  getLanguage,
  getAllLanguages,
  languageExists,
} from './ast/languages/registry.js';

// =============================================================================
// CHUNKING
// =============================================================================

export { chunkFile, chunkText } from './chunker.js';
export type { ChunkOptions } from './chunker.js';

// =============================================================================
// SCANNING
// =============================================================================

export { scanCodebase, detectFileType } from './scanner.js';

// =============================================================================
// SYMBOL EXTRACTION (line-based)
// =============================================================================

export { extractSymbols } from './symbol-extractor.js';

// =============================================================================
// LIQUID & JSON TEMPLATE CHUNKING
// =============================================================================

export { chunkLiquidFile } from './liquid-chunker.js';
export { chunkJSONTemplate } from './json-template-chunker.js';

// =============================================================================
// GITIGNORE
// =============================================================================

export { createGitignoreFilter, ALWAYS_IGNORE_PATTERNS } from './gitignore.js';

// =============================================================================
// ECOSYSTEM PRESETS
// =============================================================================

export {
  detectEcosystems,
  getEcosystemExcludePatterns,
  ECOSYSTEM_PRESETS,
} from './ecosystem-presets.js';
export type { EcosystemPreset } from './ecosystem-presets.js';

// =============================================================================
// CONTENT HASH
// =============================================================================

export { computeContentHash, isHashAlgorithmCompatible } from './content-hash.js';

// =============================================================================
// TEST ASSOCIATIONS
// =============================================================================

export { findTestAssociationsFromChunks } from './test-associations.js';

// =============================================================================
// DEPENDENCY ANALYSIS
// =============================================================================

export {
  analyzeDependencies,
  findTransitiveDependents,
  groupChunksByNormalizedPath,
  chunkImportsFrom,
  fileIsReExporter,
  DEPENDENT_COUNT_THRESHOLDS,
  COMPLEXITY_THRESHOLDS,
} from './dependency-analyzer.js';
export type { FileComplexityInfo, DependencyAnalysisResult } from './dependency-analyzer.js';

// =============================================================================
// COMPLEXITY ANALYSIS (chunk-based, no VectorDB)
// =============================================================================

export { analyzeComplexityFromChunks } from './insights/chunk-complexity.js';

// =============================================================================
// CHUNK-ONLY INDEXING (no embeddings or VectorDB)
// =============================================================================

export { performChunkOnlyIndex } from './chunk-only-index.js';
export type { ChunkOnlyOptions, ChunkOnlyResult } from './chunk-only-index.js';
