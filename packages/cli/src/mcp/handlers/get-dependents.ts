import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { GetDependentsSchema } from '../schemas/index.js';
import { normalizePath, matchesFile, getCanonicalPath, isTestFile } from '../utils/path-matching.js';
import type { ToolContext, MCPToolResult } from '../types.js';
import type { SearchResult } from '@liendev/core';
import { QdrantDB } from '@liendev/core';

/**
 * Complexity metrics for a single dependent file.
 */
interface FileComplexity {
  filepath: string;
  avgComplexity: number;
  maxComplexity: number;
  complexityScore: number; // Sum of all complexities
  chunksWithComplexity: number;
}

/**
 * Aggregate complexity metrics for all dependents.
 */
interface ComplexityMetrics {
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
 * Risk level thresholds for dependent count.
 * Based on impact analysis: more dependents = higher risk of breaking changes.
 */
const DEPENDENT_COUNT_THRESHOLDS = {
  LOW: 5,       // Few dependents, safe to change
  MEDIUM: 15,   // Moderate impact, review dependents
  HIGH: 30,     // High impact, careful planning needed
} as const;

/**
 * Complexity thresholds for risk assessment.
 * Based on cyclomatic complexity: higher complexity = harder to change safely.
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

/**
 * Maximum number of chunks to scan for dependency analysis.
 * Larger codebases may have incomplete results if they exceed this limit.
 */
const SCAN_LIMIT = 10000;

/** Risk level ordering for comparison */
const RISK_ORDER = { low: 0, medium: 1, high: 2, critical: 3 } as const;
type RiskLevel = keyof typeof RISK_ORDER;

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
 */
function calculateRiskLevel(dependentCount: number, complexityRiskBoost: RiskLevel): RiskLevel {
  let riskLevel: RiskLevel =
    dependentCount === 0 ? 'low' :
    dependentCount <= DEPENDENT_COUNT_THRESHOLDS.LOW ? 'low' :
    dependentCount <= DEPENDENT_COUNT_THRESHOLDS.MEDIUM ? 'medium' :
    dependentCount <= DEPENDENT_COUNT_THRESHOLDS.HIGH ? 'high' : 'critical';

  // Boost if complexity risk is higher
  if (RISK_ORDER[complexityRiskBoost] > RISK_ORDER[riskLevel]) {
    riskLevel = complexityRiskBoost;
  }

  return riskLevel;
}

/**
 * Handle get_dependents tool calls.
 * Finds all code that depends on a file (reverse dependency lookup).
 */
/**
 * Group dependents by repository ID.
 */
function groupDependentsByRepo(
  dependents: Array<{ filepath: string; isTestFile: boolean }>,
  chunks: SearchResult[]
): Record<string, Array<{ filepath: string; isTestFile: boolean }>> {
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
  const grouped: Record<string, Array<{ filepath: string; isTestFile: boolean }>> = {};
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

export async function handleGetDependents(
  args: unknown,
  ctx: ToolContext
): Promise<MCPToolResult> {
  const { vectorDB, log, checkAndReconnect, getIndexMetadata } = ctx;

  return await wrapToolHandler(
    GetDependentsSchema,
    async (validatedArgs) => {
      const { crossRepo, filepath } = validatedArgs;
      log(`Finding dependents of: ${filepath}${crossRepo ? ' (cross-repo)' : ''}`);
      await checkAndReconnect();

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
      const normalizedTarget = normalizePathCached(validatedArgs.filepath);
      const dependentChunks = findDependentChunks(importIndex, normalizedTarget);

      // Group by canonical file path
      const chunksByFile = new Map<string, typeof dependentChunks>();
      for (const chunk of dependentChunks) {
        const canonical = getCanonicalPath(chunk.metadata.file, workspaceRoot);
        const existing = chunksByFile.get(canonical) || [];
        existing.push(chunk);
        chunksByFile.set(canonical, existing);
      }

      // Calculate metrics
      const fileComplexities = calculateFileComplexities(chunksByFile);
      const complexityMetrics = calculateOverallComplexityMetrics(fileComplexities);

      const uniqueFiles = Array.from(chunksByFile.keys()).map(filepath => ({
        filepath,
        isTestFile: isTestFile(filepath),
      }));

      const riskLevel = calculateRiskLevel(uniqueFiles.length, complexityMetrics.complexityRiskBoost);
      log(`Found ${uniqueFiles.length} dependent files (risk: ${riskLevel}${complexityMetrics.filesWithComplexityData > 0 ? ', complexity-boosted' : ''})`);

      const response: any = {
        indexInfo: getIndexMetadata(),
        filepath: validatedArgs.filepath,
        dependentCount: uniqueFiles.length,
        riskLevel,
        dependents: uniqueFiles,
        complexityMetrics,
        note: hitLimit ? `Warning: Scanned ${SCAN_LIMIT} chunks (limit reached). Results may be incomplete.` : undefined,
      };

      // Group by repo if cross-repo search
      if (crossRepo && vectorDB instanceof QdrantDB) {
        response.groupedByRepo = groupDependentsByRepo(uniqueFiles, allChunks);
      }

      return response;
    }
  )(args);
}
