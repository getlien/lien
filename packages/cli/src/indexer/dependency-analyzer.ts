import { SearchResult } from '../vectordb/types.js';
import { normalizePath, getCanonicalPath, matchesFile, isTestFile } from '../mcp/utils/path-matching.js';
import { RISK_ORDER, RiskLevel } from '../insights/types.js';

/**
 * Risk level thresholds for dependent count.
 * Based on impact analysis: more dependents = higher risk of breaking changes.
 */
export const DEPENDENT_COUNT_THRESHOLDS = {
  LOW: 5,       // Few dependents, safe to change
  MEDIUM: 15,   // Moderate impact, review dependents
  HIGH: 30,     // High impact, careful planning needed
} as const;

/**
 * Complexity thresholds for risk assessment.
 * Based on cyclomatic complexity: higher complexity = harder to change safely.
 */
export const COMPLEXITY_THRESHOLDS = {
  HIGH_COMPLEXITY_DEPENDENT: 10,  // Individual file is complex
  CRITICAL_AVG: 15,              // Average complexity indicates systemic complexity
  CRITICAL_MAX: 25,              // Peak complexity indicates hotspot
  HIGH_AVG: 10,                  // Moderately complex on average
  HIGH_MAX: 20,                  // Some complex functions exist
  MEDIUM_AVG: 6,                 // Slightly above simple code
  MEDIUM_MAX: 15,                // Occasional branching
} as const;

export interface FileComplexityInfo {
  filepath: string;
  avgComplexity: number;
  maxComplexity: number;
  complexityScore: number;
  chunksWithComplexity: number;
}

export interface DependencyAnalysisResult {
  dependents: Array<{
    filepath: string;
    isTestFile: boolean;
  }>;
  dependentCount: number;
  riskLevel: RiskLevel;
  complexityMetrics?: {
    averageComplexity: number;
    maxComplexity: number;
    filesWithComplexityData: number;
    highComplexityDependents: Array<{
      filepath: string;
      maxComplexity: number;
      avgComplexity: number;
    }>;
    complexityRiskBoost: RiskLevel;
  };
}

/**
 * Creates a cached path normalizer to avoid repeated string operations.
 */
function createPathNormalizer(workspaceRoot: string): (path: string) => string {
  const cache = new Map<string, string>();
  return (path: string): string => {
    const cached = cache.get(path);
    if (cached !== undefined) return cached;
    const normalized = normalizePath(path, workspaceRoot);
    cache.set(path, normalized);
    return normalized;
  };
}

/**
 * Builds an index mapping normalized import paths to chunks that import them.
 * Enables O(1) lookup instead of O(n*m) iteration.
 */
function buildImportIndex(
  chunks: SearchResult[],
  normalizePathCached: (path: string) => string
): Map<string, SearchResult[]> {
  const importIndex = new Map<string, SearchResult[]>();
  
  for (const chunk of chunks) {
    const imports = chunk.metadata.imports || [];
    for (const imp of imports) {
      const normalizedImport = normalizePathCached(imp);
      let chunkList = importIndex.get(normalizedImport);
      if (!chunkList) {
        chunkList = [];
        importIndex.set(normalizedImport, chunkList);
      }
      chunkList.push(chunk);
    }
  }
  
  return importIndex;
}

/**
 * Finds all chunks that import the target file using index + fuzzy matching.
 */
function findDependentChunks(
  normalizedTarget: string,
  importIndex: Map<string, SearchResult[]>
): SearchResult[] {
  const dependentChunks: SearchResult[] = [];
  const seenChunkIds = new Set<string>();
  
  const addChunk = (chunk: SearchResult): void => {
    const chunkId = `${chunk.metadata.file}:${chunk.metadata.startLine}-${chunk.metadata.endLine}`;
    if (!seenChunkIds.has(chunkId)) {
      dependentChunks.push(chunk);
      seenChunkIds.add(chunkId);
    }
  };
  
  // Direct index lookup (fastest path)
  const directMatches = importIndex.get(normalizedTarget);
  if (directMatches) {
    for (const chunk of directMatches) {
      addChunk(chunk);
    }
  }
  
  // Fuzzy match for relative imports and path variations
  // Note: This is O(M) where M = unique import paths. For large codebases with many
  // violations, consider caching fuzzy match results at a higher level.
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
 * Groups chunks by their canonical file path.
 */
function groupChunksByFile(
  chunks: SearchResult[],
  workspaceRoot: string
): Map<string, SearchResult[]> {
  const chunksByFile = new Map<string, SearchResult[]>();
  
  for (const chunk of chunks) {
    const canonical = getCanonicalPath(chunk.metadata.file, workspaceRoot);
    let existing = chunksByFile.get(canonical);
    if (!existing) {
      existing = [];
      chunksByFile.set(canonical, existing);
    }
    existing.push(chunk);
  }
  
  return chunksByFile;
}

/**
 * Calculates complexity metrics for each file based on its chunks.
 */
function calculateFileComplexities(
  chunksByFile: Map<string, SearchResult[]>
): FileComplexityInfo[] {
  const fileComplexities: FileComplexityInfo[] = [];
  
  for (const [filepath, chunks] of chunksByFile.entries()) {
    const complexities = chunks
      .map(c => c.metadata.complexity)
      .filter((c): c is number => typeof c === 'number' && c > 0);
    
    if (complexities.length > 0) {
      const sum = complexities.reduce((a, b) => a + b, 0);
      const avg = sum / complexities.length;
      const max = Math.max(...complexities);
      
      fileComplexities.push({
        filepath,
        avgComplexity: Math.round(avg * 10) / 10,
        maxComplexity: max,
        complexityScore: sum,
        chunksWithComplexity: complexities.length,
      });
    }
  }
  
  return fileComplexities;
}

/**
 * Calculates overall complexity metrics from per-file data.
 */
function calculateOverallComplexityMetrics(
  fileComplexities: FileComplexityInfo[]
): DependencyAnalysisResult['complexityMetrics'] | undefined {
  if (fileComplexities.length === 0) {
    return undefined;
  }
  
  const allAvgs = fileComplexities.map(f => f.avgComplexity);
  const allMaxes = fileComplexities.map(f => f.maxComplexity);
  const totalAvg = allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length;
  const globalMax = Math.max(...allMaxes);
  
  // Identify high-complexity dependents (top 5)
  const highComplexityDependents = fileComplexities
    .filter(f => f.maxComplexity > COMPLEXITY_THRESHOLDS.HIGH_COMPLEXITY_DEPENDENT)
    .sort((a, b) => b.maxComplexity - a.maxComplexity)
    .slice(0, 5)
    .map(f => ({
      filepath: f.filepath,
      maxComplexity: f.maxComplexity,
      avgComplexity: f.avgComplexity,
    }));
  
  // Calculate complexity-based risk boost
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
 * Determines risk level based on complexity thresholds.
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
 * Calculates risk level based on dependent count.
 */
function calculateRiskLevelFromCount(count: number): RiskLevel {
  if (count === 0 || count <= DEPENDENT_COUNT_THRESHOLDS.LOW) {
    return 'low';
  }
  if (count <= DEPENDENT_COUNT_THRESHOLDS.MEDIUM) {
    return 'medium';
  }
  if (count <= DEPENDENT_COUNT_THRESHOLDS.HIGH) {
    return 'high';
  }
  return 'critical';
}

/**
 * Analyzes dependencies for a given file by finding all chunks that import it.
 * 
 * @param targetFilepath - The file to analyze dependencies for
 * @param allChunks - All chunks from the vector database
 * @param workspaceRoot - The workspace root directory
 * @returns Dependency analysis including dependents, count, and risk level
 */
export function analyzeDependencies(
  targetFilepath: string,
  allChunks: SearchResult[],
  workspaceRoot: string
): DependencyAnalysisResult {
  // Create cached path normalizer
  const normalizePathCached = createPathNormalizer(workspaceRoot);
  
  // Build import index for efficient lookup
  const importIndex = buildImportIndex(allChunks, normalizePathCached);
  
  // Find all dependent chunks
  const normalizedTarget = normalizePathCached(targetFilepath);
  const dependentChunks = findDependentChunks(normalizedTarget, importIndex);
  
  // Group by file for analysis
  const chunksByFile = groupChunksByFile(dependentChunks, workspaceRoot);
  
  // Calculate complexity metrics
  const fileComplexities = calculateFileComplexities(chunksByFile);
  const complexityMetrics = calculateOverallComplexityMetrics(fileComplexities);
  
  // Build dependents list
  const dependents = Array.from(chunksByFile.keys()).map(filepath => ({
    filepath,
    isTestFile: isTestFile(filepath),
  }));
  
  // Calculate risk level
  let riskLevel = calculateRiskLevelFromCount(dependents.length);
  
  // Boost risk level if complexity warrants it
  if (complexityMetrics?.complexityRiskBoost) {
    if (RISK_ORDER[complexityMetrics.complexityRiskBoost] > RISK_ORDER[riskLevel]) {
      riskLevel = complexityMetrics.complexityRiskBoost;
    }
  }
  
  return {
    dependents,
    dependentCount: dependents.length,
    riskLevel,
    complexityMetrics,
  };
}
