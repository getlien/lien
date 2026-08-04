// @liendev/parser - static analysis over source code: parsing, chunking,
// complexity, and dependency resolution

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

export {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_OVERLAP,
  MAX_CHUNKS_PER_FILE,
  PARSE_STAGE_MAX_CONCURRENCY,
  getParseStageConcurrency,
  DEFAULT_INDEX_INCLUDE_PATTERNS,
} from './constants.js';

// =============================================================================
// UTILITIES
// =============================================================================

export {
  normalizePath,
  createPathNormalizer,
  matchesFile,
  getCanonicalPath,
  isTestFile,
  isUnresolvableWholeModuleImport,
  importMatchesTarget,
  hasSingleFileImportSemantics,
  hasPythonModuleSemantics,
} from './utils/path-matching.js';

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
  hasWholeModuleImports,
  hasEnclosingNamespaceAccess,
  hasSameDirectoryTestConvention,
  hasSamePackageTestConvention,
  hasDependentAttributionBlindSpot,
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

export {
  createGitignoreFilter,
  ALWAYS_IGNORE_PATTERNS,
  HOME_ROOT_ONLY_IGNORE_PATTERNS,
  isHomeDirectory,
  getEffectiveAlwaysIgnorePatterns,
  getEffectiveNeverIndexPatterns,
} from './gitignore.js';

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
export {
  buildGoTestDirIndex,
  pairGoBasenameTest,
  findGoPackageLevelTests,
} from './go-same-directory-tests.js';
export type { GoTestCandidate, GoTestDirIndex } from './go-same-directory-tests.js';

// #925: Java's same-package (not same-directory) test-association signal
// (see java-same-package-tests.ts's module doc).
export {
  javaPackageRelativePath,
  toJavaTestCandidate,
  buildJavaTestDirIndex,
  pairJavaBasenameTest,
  findJavaPackageLevelTests,
} from './java-same-package-tests.js';
export type { JavaTestCandidate, JavaTestDirIndex } from './java-same-package-tests.js';

// #869 measure-gated spike: Swift's non-import symbol-usage test-association
// signal (see swift-symbol-usage-signals.ts's module doc).
export {
  findSwiftSymbolUsageAssociations,
  isMultiSegmentIdentifier,
  isTypeShapedIdentifier,
} from './swift-symbol-usage-signals.js';

// #930 (part 2): C#'s non-import type-reference signal, originally built for
// `get_dependents` and reused by test-association (#1040) -- see
// csharp-type-reference-signals.ts's module doc. `buildCSharpTypeReferenceIndex`/
// `resolveCSharpTypeReferenceDependents` let a caller resolving MANY target
// files (e.g. `get_files_context`'s `findTestAssociations`) build the
// project-wide index once and reuse it, instead of calling
// `findCSharpTypeReferenceDependents` (which rebuilds it) per file.
// `resolveCSharpTypeReferenceDependentsBruteForce` is #1071's never-pruned
// oracle -- exported (like `dependent-count-index.ts`'s
// `computeDependentCountsBruteForce`) purely so equivalence can be checked
// from outside the module; never call it in production.
export {
  findCSharpTypeReferenceDependents,
  buildCSharpTypeReferenceIndex,
  resolveCSharpTypeReferenceDependents,
  resolveCSharpTypeReferenceDependentsBruteForce,
} from './csharp-type-reference-signals.js';
export type { CSharpTypeReferenceIndex } from './csharp-type-reference-signals.js';

// #1039: Go's root-package export-lookup dependents signal (see
// go-root-package-signals.ts's module doc). Mirrors the C# exports
// immediately above -- `buildGoRootPackageIndex`/`resolveGoRootPackageDependents`
// let a caller resolving MANY target root files build the project-wide index
// once and reuse it, instead of calling `findGoRootPackageDependents` (which
// rebuilds it) per file.
export {
  findGoRootPackageDependents,
  buildGoRootPackageIndex,
  resolveGoRootPackageDependents,
  isRootLevelGoFile,
} from './go-root-package-signals.js';
export type { GoRootPackageIndex } from './go-root-package-signals.js';

// #1071: batch reverse-dependency counts for EVERY file in one pass, resolving
// through the same guarded `importMatchesTarget` decision `findDependents` uses
// (plus the C#/Go recovery tiers above) rather than a private relative-only
// matcher. Feeds `search_code`'s structural ranking boost, precomputed at index
// time -- see dependent-count-index.ts's module doc for the candidate-index
// pruning argument and for what is deliberately not counted.
export {
  computeDependentCountsFromChunks,
  computeDependentCountsBruteForce,
} from './dependent-count-index.js';

// =============================================================================
// GRAPH TRAVERSAL (generic bounded BFS — domain graphs build on this)
// =============================================================================

export { walkBounded } from './graph/bounded-bfs.js';
export type {
  BoundedBfsOptions,
  BoundedBfsEdgeResult,
  BoundedBfsResult,
} from './graph/bounded-bfs.js';

// =============================================================================
// DEPENDENCY ANALYSIS
// =============================================================================

// `hasTestImporterFromChunks`/`hasTestImporterBruteForce` are #1075's fast path
// and its never-pruned oracle for the "does any test file import this?"
// predicate behind `uncoveredProductionDependents` -- exported (like
// `computeDependentCountsBruteForce` above) purely so equivalence can be checked
// from outside the module against real corpora; never call the brute-force one
// in production.
export {
  analyzeDependencies,
  findDependents,
  findTransitiveDependents,
  groupChunksByNormalizedPath,
  addFuzzyMatchChunks,
  findDependentChunks,
  chunkImportsFrom,
  fileIsReExporter,
  findReExportedSymbolsForFile,
  hasTestImporterFromChunks,
  hasTestImporterBruteForce,
  DEPENDENT_COUNT_THRESHOLDS,
  COMPLEXITY_THRESHOLDS,
} from './dependency-analyzer.js';
export type {
  FileComplexityInfo,
  DependencyAnalysisResult,
  FindDependentsResult,
  ComplexityMetrics,
  DependentInfo,
  SymbolUsage,
  ImportIndexEntry,
} from './dependency-analyzer.js';

// Which non-import fallback recovered a `confidence: 'inferred'` dependent,
// plus the canonical prose every consumer-facing surface must derive from
// rather than restate (#1018) -- see inferred-dependent-mechanisms.ts's module
// doc, and ADR-016 for the axis model it belongs to.
export {
  INFERRED_DEPENDENT_MECHANISMS,
  INFERRED_DEPENDENT_MECHANISM_IDS,
  summarizeInferredDependentMechanisms,
  describeInferredDependentRecovery,
} from './inferred-dependent-mechanisms.js';
export type {
  InferredDependentMechanism,
  InferredDependentMechanismDescriptor,
} from './inferred-dependent-mechanisms.js';

// =============================================================================
// COMPLEXITY ANALYSIS (chunk-based, no VectorDB)
// =============================================================================

export {
  analyzeComplexityFromChunks,
  DEFAULT_COMPLEXITY_THRESHOLDS,
  effortToMinutes,
  formatTime,
} from './insights/chunk-complexity.js';
export type { ComplexityThresholds } from './insights/chunk-complexity.js';

// Complexity delta (before/after content → per-function verdicts) — shared by
// the `lien delta` CLI and (as a follow-up) the PR-review engine.
export {
  computeComplexityDelta,
  computeFileComplexityDelta,
  resolveComplexityDeltaThresholds,
  hasRegressions,
  DEFAULT_COMPLEXITY_DELTA_THRESHOLDS,
} from './insights/complexity-delta.js';
export type {
  ComplexityDeltaThresholds,
  ComplexityDeltaVerdict,
  MetricComplexityDelta,
  FunctionComplexityDelta,
  FileComplexityDelta,
  ComplexityDeltaSummary,
  ComplexityDeltaResult,
  FileContentChange,
} from './insights/complexity-delta.js';

// =============================================================================
// CHUNK-ONLY INDEXING (no embeddings or VectorDB)
// =============================================================================

export { performChunkOnlyIndex } from './chunk-only-index.js';
export type { ChunkOnlyOptions, ChunkOnlyResult } from './chunk-only-index.js';

// =============================================================================
// RISK ANALYSIS
// =============================================================================

export { computeBlastRadiusRisk } from './risk/blast-radius-risk.js';
export type { BlastRadiusRiskInput, BlastRadiusRisk } from './risk/blast-radius-risk.js';

// =============================================================================
// DOC REFERENCE MATCHING (shared by the review docs-drift pass and the CLI's
// edit-time docRefs lookup — see doc-reference-matching.ts's own docstring)
// =============================================================================

export { wordBoundaryRe, isDistinctiveToken } from './doc-reference-matching.js';
