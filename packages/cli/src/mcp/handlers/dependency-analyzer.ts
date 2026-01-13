import type { SearchResult } from '@liendev/core';
import { VectorDBInterface } from '@liendev/core';
import { QdrantDB } from '@liendev/core';
import { normalizePath, matchesFile, getCanonicalPath, isTestFile } from '../utils/path-matching.js';

/**
 * Maximum number of chunks to scan for dependency analysis.
 * Larger codebases may have incomplete results if they exceed this limit.
 */
const SCAN_LIMIT = 10000;

/**
 * Complexity metrics for a single dependent file.
 */
export interface FileComplexity {
  filepath: string;
  avgComplexity: number;
  maxComplexity: number;
  complexityScore: number; // Sum of all complexities
  chunksWithComplexity: number;
}

/**
 * Aggregate complexity metrics for all dependents.
 */
export interface ComplexityMetrics {
  averageComplexity: number;
  maxComplexity: number;
  filesWithComplexityData: number;
  highComplexityDependents: Array<{
    filepath: string;
    maxComplexity: number;
    avgComplexity: number;
  }>;
  complexityRiskBoost: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Complexity thresholds for risk assessment.
 */
const COMPLEXITY_THRESHOLDS = {
  HIGH_COMPLEXITY_DEPENDENT: 10,  // Individual file is complex
  CRITICAL_AVG: 15,              // Average complexity indicates systemic complexity
  CRITICAL_MAX: 25,              // Peak complexity indicates hotspot
  HIGH_AVG: 10,                  // Moderately complex on average
  HIGH_MAX: 20,                  // Some complex functions exist
  MEDIUM_AVG: 6,                 // Slightly above simple code
  MEDIUM_MAX: 15,                // Occasional branching
} as const;

/** Risk level ordering for comparison */
const RISK_ORDER = { low: 0, medium: 1, high: 2, critical: 3 } as const;
type RiskLevel = keyof typeof RISK_ORDER;

/**
 * A single usage of a symbol (call site).
 */
export interface SymbolUsage {
  /** The function/method that contains this call */
  callerSymbol: string;
  /** Line number where the call occurs */
  line: number;
  /** Code snippet showing the call */
  snippet: string;
}

/**
 * Dependent file info, with optional symbol-level usages.
 */
export interface DependentInfo {
  filepath: string;
  isTestFile: boolean;
  /** Only present when symbol parameter is provided */
  usages?: SymbolUsage[];
}

/**
 * Dependency analysis result.
 */
export interface DependencyAnalysisResult {
  dependents: DependentInfo[];
  productionDependentCount: number;
  testDependentCount: number;
  chunksByFile: Map<string, SearchResult[]>;
  fileComplexities: FileComplexity[];
  complexityMetrics: ComplexityMetrics;
  hitLimit: boolean;
  allChunks: SearchResult[];
  /** Total count of usages across all files (when symbol is specified) */
  totalUsageCount?: number;
}

/**
 * Find all dependents of a target file.
 * 
 * @param vectorDB - Vector database to scan
 * @param filepath - Path to file to find dependents for
 * @param crossRepo - Whether to search across repos
 * @param log - Logging function
 * @param symbol - Optional: specific symbol to find usages of
 */
export async function findDependents(
  vectorDB: VectorDBInterface,
  filepath: string,
  crossRepo: boolean,
  log: (message: string, level?: 'warning') => void,
  symbol?: string
): Promise<DependencyAnalysisResult> {
  // Use cross-repo scan if enabled and backend supports it
  let allChunks: SearchResult[];
  if (crossRepo && vectorDB instanceof QdrantDB) {
    allChunks = await vectorDB.scanCrossRepo({ limit: SCAN_LIMIT });
  } else {
    if (crossRepo) {
      log('Warning: crossRepo=true requires Qdrant backend. Falling back to single-repo search.', 'warning');
    }
    allChunks = await vectorDB.scanWithFilter({ limit: SCAN_LIMIT });
  }

  const hitLimit = allChunks.length === SCAN_LIMIT;
  if (hitLimit) {
    log(`Scanned ${SCAN_LIMIT} chunks (limit reached). Results may be incomplete.`, 'warning');
  }
  log(`Scanning ${allChunks.length} chunks for imports...`);

  const workspaceRoot = process.cwd().replace(/\\/g, '/');
  const pathCache = new Map<string, string>();
  const normalizePathCached = (path: string): string => {
    if (!pathCache.has(path)) pathCache.set(path, normalizePath(path, workspaceRoot));
    return pathCache.get(path)!;
  };

  // Build index and find dependents
  const importIndex = buildImportIndex(allChunks, normalizePathCached);
  const normalizedTarget = normalizePathCached(filepath);
  const dependentChunks = findDependentChunks(importIndex, normalizedTarget);

  // Group by canonical file path
  const chunksByFile = new Map<string, SearchResult[]>();
  for (const chunk of dependentChunks) {
    const canonical = getCanonicalPath(chunk.metadata.file, workspaceRoot);
    const existing = chunksByFile.get(canonical) || [];
    existing.push(chunk);
    chunksByFile.set(canonical, existing);
  }

  // Calculate metrics
  const fileComplexities = calculateFileComplexities(chunksByFile);
  const complexityMetrics = calculateOverallComplexityMetrics(fileComplexities);

  // Build dependents list with optional symbol-level usages
  let dependents: DependentInfo[];
  let totalUsageCount: number | undefined;

  if (symbol) {
    // Symbol-level analysis: find usages of the specific symbol
    const result = findSymbolUsages(chunksByFile, symbol, normalizedTarget, normalizePathCached);
    dependents = result.dependents;
    totalUsageCount = result.totalUsageCount;
  } else {
    // File-level analysis: just list dependent files
    dependents = Array.from(chunksByFile.keys()).map(fp => ({
      filepath: fp,
      isTestFile: isTestFile(fp),
    }));
  }

  // Calculate test/production split
  const testDependentCount = dependents.filter(f => f.isTestFile).length;
  const productionDependentCount = dependents.length - testDependentCount;

  return {
    dependents,
    productionDependentCount,
    testDependentCount,
    chunksByFile,
    fileComplexities,
    complexityMetrics,
    hitLimit,
    allChunks,
    totalUsageCount,
  };
}

/**
 * Build import-to-chunk index for O(n) instead of O(n*m) lookup.
 */
function buildImportIndex(
  allChunks: SearchResult[],
  normalizePathCached: (path: string) => string
): Map<string, SearchResult[]> {
  const importIndex = new Map<string, SearchResult[]>();

  for (const chunk of allChunks) {
    const imports = chunk.metadata.imports || [];
    for (const imp of imports) {
      const normalizedImport = normalizePathCached(imp);
      if (!importIndex.has(normalizedImport)) {
        importIndex.set(normalizedImport, []);
      }
      importIndex.get(normalizedImport)!.push(chunk);
    }
  }

  return importIndex;
}

/**
 * Find dependent chunks using direct lookup and fuzzy matching.
 */
function findDependentChunks(
  importIndex: Map<string, SearchResult[]>,
  normalizedTarget: string
): SearchResult[] {
  const dependentChunks: SearchResult[] = [];
  const seenChunkIds = new Set<string>();

  const addChunk = (chunk: SearchResult) => {
    const chunkId = `${chunk.metadata.file}:${chunk.metadata.startLine}-${chunk.metadata.endLine}`;
    if (!seenChunkIds.has(chunkId)) {
      dependentChunks.push(chunk);
      seenChunkIds.add(chunkId);
    }
  };

  // Direct index lookup (fastest path)
  if (importIndex.has(normalizedTarget)) {
    for (const chunk of importIndex.get(normalizedTarget)!) {
      addChunk(chunk);
    }
  }

  // Fuzzy match for relative imports and path variations
  for (const [normalizedImport, chunks] of importIndex.entries()) {
    if (normalizedImport !== normalizedTarget && matchesFile(normalizedImport, normalizedTarget)) {
      for (const chunk of chunks) {
        addChunk(chunk);
      }
    }
  }

  return dependentChunks;
}

/**
 * Calculate complexity metrics for each file from its chunks.
 */
function calculateFileComplexities(
  chunksByFile: Map<string, SearchResult[]>
): FileComplexity[] {
  const fileComplexities: FileComplexity[] = [];

  for (const [filepath, chunks] of chunksByFile.entries()) {
    const complexities = chunks
      .map(c => c.metadata.complexity)
      .filter((c): c is number => typeof c === 'number' && c > 0);

    if (complexities.length > 0) {
      const sum = complexities.reduce((a, b) => a + b, 0);
      fileComplexities.push({
        filepath,
        avgComplexity: Math.round((sum / complexities.length) * 10) / 10,
        maxComplexity: Math.max(...complexities),
        complexityScore: sum,
        chunksWithComplexity: complexities.length,
      });
    }
  }

  return fileComplexities;
}

/**
 * Calculate overall complexity metrics from per-file complexities.
 */
function calculateOverallComplexityMetrics(
  fileComplexities: FileComplexity[]
): ComplexityMetrics {
  if (fileComplexities.length === 0) {
    return {
      averageComplexity: 0,
      maxComplexity: 0,
      filesWithComplexityData: 0,
      highComplexityDependents: [],
      complexityRiskBoost: 'low',
    };
  }

  const allAvgs = fileComplexities.map(f => f.avgComplexity);
  const allMaxes = fileComplexities.map(f => f.maxComplexity);
  const totalAvg = allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length;
  const globalMax = Math.max(...allMaxes);

  const highComplexityDependents = fileComplexities
    .filter(f => f.maxComplexity > COMPLEXITY_THRESHOLDS.HIGH_COMPLEXITY_DEPENDENT)
    .sort((a, b) => b.maxComplexity - a.maxComplexity)
    .slice(0, 5)
    .map(f => ({ filepath: f.filepath, maxComplexity: f.maxComplexity, avgComplexity: f.avgComplexity }));

  const complexityRiskBoost = calculateComplexityRiskBoost(totalAvg, globalMax);

  return {
    averageComplexity: Math.round(totalAvg * 10) / 10,
    maxComplexity: globalMax,
    filesWithComplexityData: fileComplexities.length,
    highComplexityDependents,
    complexityRiskBoost,
  };
}

/**
 * Calculate complexity-based risk boost level.
 */
function calculateComplexityRiskBoost(avgComplexity: number, maxComplexity: number): RiskLevel {
  if (avgComplexity > COMPLEXITY_THRESHOLDS.CRITICAL_AVG || maxComplexity > COMPLEXITY_THRESHOLDS.CRITICAL_MAX) {
    return 'critical';
  }
  if (avgComplexity > COMPLEXITY_THRESHOLDS.HIGH_AVG || maxComplexity > COMPLEXITY_THRESHOLDS.HIGH_MAX) {
    return 'high';
  }
  if (avgComplexity > COMPLEXITY_THRESHOLDS.MEDIUM_AVG || maxComplexity > COMPLEXITY_THRESHOLDS.MEDIUM_MAX) {
    return 'medium';
  }
  return 'low';
}

/**
 * Calculate risk level based on dependent count and complexity.
 * @param dependentCount Total number of dependent files
 * @param complexityRiskBoost Risk boost from complexity analysis
 * @param productionDependentCount Optional: if provided, use this for risk calculation instead of dependentCount
 */
export function calculateRiskLevel(
  dependentCount: number,
  complexityRiskBoost: 'low' | 'medium' | 'high' | 'critical',
  productionDependentCount?: number
): 'low' | 'medium' | 'high' | 'critical' {
  const DEPENDENT_COUNT_THRESHOLDS = {
    LOW: 5,
    MEDIUM: 15,
    HIGH: 30,
  } as const;

  const RISK_ORDER = { low: 0, medium: 1, high: 2, critical: 3 } as const;
  type RiskLevel = keyof typeof RISK_ORDER;

  // Use production count if provided, otherwise fall back to total
  const effectiveCount = productionDependentCount ?? dependentCount;

  let riskLevel: RiskLevel =
    effectiveCount === 0 ? 'low' :
    effectiveCount <= DEPENDENT_COUNT_THRESHOLDS.LOW ? 'low' :
    effectiveCount <= DEPENDENT_COUNT_THRESHOLDS.MEDIUM ? 'medium' :
    effectiveCount <= DEPENDENT_COUNT_THRESHOLDS.HIGH ? 'high' : 'critical';

  // Boost if complexity risk is higher
  if (RISK_ORDER[complexityRiskBoost] > RISK_ORDER[riskLevel]) {
    riskLevel = complexityRiskBoost;
  }

  return riskLevel;
}

/**
 * Group dependents by repository ID.
 */
export function groupDependentsByRepo(
  dependents: DependentInfo[],
  chunks: SearchResult[]
): Record<string, DependentInfo[]> {
  const repoMap = new Map<string, Set<string>>();

  // Build map of filepath -> repoId
  for (const chunk of chunks) {
    const repoId = chunk.metadata.repoId || 'unknown';
    const filepath = chunk.metadata.file;
    if (!repoMap.has(repoId)) {
      repoMap.set(repoId, new Set());
    }
    repoMap.get(repoId)!.add(filepath);
  }

  // Group dependents by repo
  const grouped: Record<string, DependentInfo[]> = {};
  for (const dependent of dependents) {
    // Find which repo this file belongs to
    let foundRepo = 'unknown';
    for (const [repoId, files] of repoMap.entries()) {
      if (files.has(dependent.filepath)) {
        foundRepo = repoId;
        break;
      }
    }

    if (!grouped[foundRepo]) {
      grouped[foundRepo] = [];
    }
    grouped[foundRepo].push(dependent);
  }

  return grouped;
}

/**
 * Find usages of a specific symbol in dependent files.
 * 
 * Looks for:
 * 1. Files that import the symbol from the target file
 * 2. Chunks within those files that have call sites for the symbol
 */
function findSymbolUsages(
  chunksByFile: Map<string, SearchResult[]>,
  targetSymbol: string,
  normalizedTarget: string,
  normalizePathCached: (path: string) => string
): { dependents: DependentInfo[]; totalUsageCount: number } {
  const dependents: DependentInfo[] = [];
  let totalUsageCount = 0;

  for (const [filepath, chunks] of chunksByFile.entries()) {
    // Check if any chunk imports the target symbol
    const importsSymbol = chunks.some(chunk => {
      const importedSymbols = chunk.metadata.importedSymbols;
      if (!importedSymbols) return false;
      
      // Check all import paths that might match our target file
      for (const [importPath, symbols] of Object.entries(importedSymbols)) {
        const normalizedImport = normalizePathCached(importPath);
        if (matchesFile(normalizedImport, normalizedTarget)) {
          // Check if the target symbol is imported
          if (symbols.includes(targetSymbol)) {
            return true;
          }
          // Also match namespace imports: * as utils
          if (symbols.some(s => s.startsWith('* as '))) {
            return true;
          }
        }
      }
      return false;
    });

    if (!importsSymbol) {
      // This file doesn't import the target symbol, skip it
      continue;
    }

    // Find call sites within this file's chunks
    const usages: SymbolUsage[] = [];
    
    for (const chunk of chunks) {
      const callSites = chunk.metadata.callSites;
      if (!callSites) continue;
      
      // Find calls to the target symbol
      for (const call of callSites) {
        if (call.symbol === targetSymbol) {
          // Extract snippet from the chunk content
          const lines = chunk.content.split('\n');
          const lineIndex = call.line - chunk.metadata.startLine;
          const snippet = lines[lineIndex]?.trim() || `${targetSymbol}(...)`;
          
          usages.push({
            callerSymbol: chunk.metadata.symbolName || 'unknown',
            line: call.line,
            snippet,
          });
        }
      }
    }

    // If we found usages, add this file with usage details
    // If no usages but imports the symbol, still include the file
    dependents.push({
      filepath,
      isTestFile: isTestFile(filepath),
      usages: usages.length > 0 ? usages : undefined,
    });

    totalUsageCount += usages.length;
  }

  return { dependents, totalUsageCount };
}

