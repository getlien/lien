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
  // Path normalization cache to avoid repeated string operations
  const pathCache = new Map<string, string>();
  const normalizePathCached = (path: string): string => {
    if (pathCache.has(path)) return pathCache.get(path)!;
    const normalized = normalizePath(path, workspaceRoot);
    pathCache.set(path, normalized);
    return normalized;
  };

  // Build import-to-chunk index for O(n) instead of O(n*m) lookup
  // Key: normalized import path, Value: array of chunks that import it
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

  // Find all chunks that import the target file using index + fuzzy matching
  const normalizedTarget = normalizePathCached(targetFilepath);
  const dependentChunks: SearchResult[] = [];
  // Track chunks we've already added to avoid duplicates
  const seenChunkIds = new Set<string>();

  // First: Try direct index lookup (fastest path)
  if (importIndex.has(normalizedTarget)) {
    for (const chunk of importIndex.get(normalizedTarget)!) {
      const chunkId = `${chunk.metadata.file}:${chunk.metadata.startLine}-${chunk.metadata.endLine}`;
      if (!seenChunkIds.has(chunkId)) {
        dependentChunks.push(chunk);
        seenChunkIds.add(chunkId);
      }
    }
  }

  // Second: Fuzzy match against all unique import paths in the index
  // This handles relative imports and path variations
  // Note: This is O(M) where M = unique import paths. For large codebases with many
  // violations, consider caching fuzzy match results at a higher level (e.g., in
  // ComplexityAnalyzer) to avoid repeated iterations.
  for (const [normalizedImport, chunks] of importIndex.entries()) {
    // Skip exact match (already processed in direct lookup above)
    if (normalizedImport !== normalizedTarget && matchesFile(normalizedImport, normalizedTarget)) {
      for (const chunk of chunks) {
        const chunkId = `${chunk.metadata.file}:${chunk.metadata.startLine}-${chunk.metadata.endLine}`;
        if (!seenChunkIds.has(chunkId)) {
          dependentChunks.push(chunk);
          seenChunkIds.add(chunkId);
        }
      }
    }
  }

  // Group chunks by file for complexity analysis
  const chunksByFile = new Map<string, SearchResult[]>();
  for (const chunk of dependentChunks) {
    const canonical = getCanonicalPath(chunk.metadata.file, workspaceRoot);
    const existing = chunksByFile.get(canonical) || [];
    existing.push(chunk);
    chunksByFile.set(canonical, existing);
  }

  // Calculate complexity metrics per file
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

  // Calculate overall complexity metrics
  let complexityMetrics: DependencyAnalysisResult['complexityMetrics'];

  if (fileComplexities.length > 0) {
    const allAvgs = fileComplexities.map(f => f.avgComplexity);
    const allMaxes = fileComplexities.map(f => f.maxComplexity);
    const totalAvg = allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length;
    const globalMax = Math.max(...allMaxes);

    // Identify high-complexity dependents
    const highComplexityDependents = fileComplexities
      .filter(f => f.maxComplexity > COMPLEXITY_THRESHOLDS.HIGH_COMPLEXITY_DEPENDENT)
      .sort((a, b) => b.maxComplexity - a.maxComplexity)
      .slice(0, 5) // Top 5
      .map(f => ({
        filepath: f.filepath,
        maxComplexity: f.maxComplexity,
        avgComplexity: f.avgComplexity,
      }));

    // Calculate complexity-based risk boost
    let complexityRiskBoost: RiskLevel = 'low';
    if (totalAvg > COMPLEXITY_THRESHOLDS.CRITICAL_AVG || globalMax > COMPLEXITY_THRESHOLDS.CRITICAL_MAX) {
      complexityRiskBoost = 'critical';
    } else if (totalAvg > COMPLEXITY_THRESHOLDS.HIGH_AVG || globalMax > COMPLEXITY_THRESHOLDS.HIGH_MAX) {
      complexityRiskBoost = 'high';
    } else if (totalAvg > COMPLEXITY_THRESHOLDS.MEDIUM_AVG || globalMax > COMPLEXITY_THRESHOLDS.MEDIUM_MAX) {
      complexityRiskBoost = 'medium';
    }

    complexityMetrics = {
      averageComplexity: Math.round(totalAvg * 10) / 10,
      maxComplexity: globalMax,
      filesWithComplexityData: fileComplexities.length,
      highComplexityDependents,
      complexityRiskBoost,
    };
  }

  // Build dependents list
  const uniqueFiles = Array.from(chunksByFile.keys()).map(filepath => ({
    filepath,
    isTestFile: isTestFile(filepath),
  }));

  // Calculate risk level based on dependent count
  const count = uniqueFiles.length;
  let riskLevel: RiskLevel =
    count === 0 ? 'low' :
    count <= DEPENDENT_COUNT_THRESHOLDS.LOW ? 'low' :
    count <= DEPENDENT_COUNT_THRESHOLDS.MEDIUM ? 'medium' :
    count <= DEPENDENT_COUNT_THRESHOLDS.HIGH ? 'high' : 'critical';

  // Boost risk level if complexity is high
  if (complexityMetrics?.complexityRiskBoost) {
    if (RISK_ORDER[complexityMetrics.complexityRiskBoost] > RISK_ORDER[riskLevel]) {
      riskLevel = complexityMetrics.complexityRiskBoost;
    }
  }

  return {
    dependents: uniqueFiles,
    dependentCount: count,
    riskLevel,
    complexityMetrics,
  };
}

