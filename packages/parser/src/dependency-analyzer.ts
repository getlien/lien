import type { CodeChunk } from './types.js';
import type { RiskLevel } from './insights/types.js';
import { normalizePath, getCanonicalPath, matchesFile, isTestFile } from './utils/path-matching.js';
import { RISK_ORDER } from './insights/types.js';

/**
 * Risk level thresholds for dependent count.
 * Based on impact analysis: more dependents = higher risk of breaking changes.
 */
export const DEPENDENT_COUNT_THRESHOLDS = {
  LOW: 5, // Few dependents, safe to change
  MEDIUM: 15, // Moderate impact, review dependents
  HIGH: 30, // High impact, careful planning needed
} as const;

/**
 * Complexity thresholds for risk assessment.
 * Based on cyclomatic complexity: higher complexity = harder to change safely.
 */
export const COMPLEXITY_THRESHOLDS = {
  HIGH_COMPLEXITY_DEPENDENT: 10, // Individual file is complex
  CRITICAL_AVG: 15, // Average complexity indicates systemic complexity
  CRITICAL_MAX: 25, // Peak complexity indicates hotspot
  HIGH_AVG: 10, // Moderately complex on average
  HIGH_MAX: 20, // Some complex functions exist
  MEDIUM_AVG: 6, // Slightly above simple code
  MEDIUM_MAX: 15, // Occasional branching
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
 *
 * @param workspaceRoot - The workspace root directory for path normalization
 * @returns A function that normalizes and caches file paths
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
 *
 * @param chunks - All chunks from the vector database
 * @param normalizePathCached - Cached path normalization function
 * @returns Map of normalized import paths to chunks that import them
 */
function buildImportIndex(
  chunks: CodeChunk[],
  normalizePathCached: (path: string) => string,
): Map<string, CodeChunk[]> {
  const importIndex = new Map<string, CodeChunk[]>();

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
 *
 * @param normalizedTarget - The normalized path of the target file
 * @param importIndex - Index mapping import paths to chunks
 * @returns Array of chunks that import the target file (deduplicated)
 */
function findDependentChunks(
  normalizedTarget: string,
  importIndex: Map<string, CodeChunk[]>,
): CodeChunk[] {
  const dependentChunks: CodeChunk[] = [];
  const seenChunkIds = new Set<string>();

  const addChunk = (chunk: CodeChunk): void => {
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
 *
 * @param chunks - Array of chunks to group
 * @param workspaceRoot - The workspace root directory
 * @returns Map of canonical file paths to their chunks
 */
function groupChunksByFile(chunks: CodeChunk[], workspaceRoot: string): Map<string, CodeChunk[]> {
  const chunksByFile = new Map<string, CodeChunk[]>();

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
 *
 * @param chunksByFile - Map of file paths to their chunks
 * @returns Array of complexity info for files with complexity data
 */
function calculateFileComplexities(chunksByFile: Map<string, CodeChunk[]>): FileComplexityInfo[] {
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
 *
 * @param fileComplexities - Array of per-file complexity info
 * @returns Aggregated complexity metrics, or undefined if no data
 */
function calculateOverallComplexityMetrics(
  fileComplexities: FileComplexityInfo[],
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
 *
 * @param avgComplexity - Average complexity across all files
 * @param maxComplexity - Maximum complexity found in any file
 * @returns Risk level based on complexity thresholds
 */
function calculateComplexityRiskBoost(avgComplexity: number, maxComplexity: number): RiskLevel {
  if (
    avgComplexity > COMPLEXITY_THRESHOLDS.CRITICAL_AVG ||
    maxComplexity > COMPLEXITY_THRESHOLDS.CRITICAL_MAX
  ) {
    return 'critical';
  }
  if (
    avgComplexity > COMPLEXITY_THRESHOLDS.HIGH_AVG ||
    maxComplexity > COMPLEXITY_THRESHOLDS.HIGH_MAX
  ) {
    return 'high';
  }
  if (
    avgComplexity > COMPLEXITY_THRESHOLDS.MEDIUM_AVG ||
    maxComplexity > COMPLEXITY_THRESHOLDS.MEDIUM_MAX
  ) {
    return 'medium';
  }
  return 'low';
}

/**
 * Calculates risk level based on dependent count.
 *
 * @param count - Number of dependent files
 * @returns Risk level based on dependent count thresholds
 */
function calculateRiskLevelFromCount(count: number): RiskLevel {
  if (count <= DEPENDENT_COUNT_THRESHOLDS.LOW) {
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
 * Maximum depth for following re-export chains.
 * Covers real-world barrel chains (A → barrel → barrel → consumer)
 * without risk of runaway traversal.
 */
const MAX_REEXPORT_DEPTH = 3;

/**
 * Check if a single chunk imports from the given source path.
 * Checks both `importedSymbols` keys and raw `imports` array.
 */
export function chunkImportsFrom(
  chunk: CodeChunk,
  sourcePath: string,
  normalizePathCached: (path: string) => string,
): boolean {
  const importedSymbols = chunk.metadata.importedSymbols;
  if (importedSymbols && typeof importedSymbols === 'object') {
    for (const importPath of Object.keys(importedSymbols)) {
      if (matchesFile(normalizePathCached(importPath), sourcePath)) return true;
    }
  }

  const imports = chunk.metadata.imports || [];
  for (const imp of imports) {
    if (matchesFile(normalizePathCached(imp), sourcePath)) return true;
  }

  return false;
}

/**
 * Check if a chunk has any exports.
 */
function chunkHasExports(chunk: CodeChunk): boolean {
  return chunk.metadata.exports != null && chunk.metadata.exports.length > 0;
}

/**
 * Group chunks by their normalized file path.
 */
export function groupChunksByNormalizedPath(
  chunks: CodeChunk[],
  normalizePathCached: (path: string) => string,
): Map<string, CodeChunk[]> {
  const grouped = new Map<string, CodeChunk[]>();
  for (const chunk of chunks) {
    const canonical = normalizePathCached(chunk.metadata.file);
    let list = grouped.get(canonical);
    if (!list) {
      list = [];
      grouped.set(canonical, list);
    }
    list.push(chunk);
  }
  return grouped;
}

/**
 * Check if a file (given its chunks) is a re-exporter from a source path.
 * A re-exporter has both imports from the source and exports.
 */
export function fileIsReExporter(
  chunks: CodeChunk[],
  sourcePath: string,
  normalizePathCached: (path: string) => string,
): boolean {
  let importsFromSource = false;
  let hasExports = false;
  for (const chunk of chunks) {
    if (!importsFromSource && chunkImportsFrom(chunk, sourcePath, normalizePathCached)) {
      importsFromSource = true;
    }
    if (!hasExports && chunkHasExports(chunk)) {
      hasExports = true;
    }
    if (importsFromSource && hasExports) return true;
  }
  return false;
}

/**
 * Build a list of files that re-export from the target file.
 *
 * A re-exporter is a file where a symbol appears in both
 * `importedSymbols[targetPath]` (or raw `imports`) AND `exports`.
 */
function buildReExportGraph(
  allChunksByFile: Map<string, CodeChunk[]>,
  normalizedTarget: string,
  normalizePathCached: (path: string) => string,
): string[] {
  const reExporters: string[] = [];

  for (const [filepath, chunks] of allChunksByFile.entries()) {
    if (matchesFile(filepath, normalizedTarget)) continue;
    if (fileIsReExporter(chunks, normalizedTarget, normalizePathCached)) {
      reExporters.push(filepath);
    }
  }

  return reExporters;
}

/**
 * Process a single dependent chunk during BFS traversal.
 * Returns the chunk if it's a new dependent, or null if already visited.
 * If the chunk's file is itself a re-exporter, adds it to the BFS queue.
 */
function processTransitiveChunk(
  chunk: CodeChunk,
  reExporterPath: string,
  depth: number,
  visited: Set<string>,
  allChunksByFile: Map<string, CodeChunk[]>,
  normalizePathCached: (path: string) => string,
  queue: Array<[string, number]>,
): CodeChunk | null {
  const chunkFile = normalizePathCached(chunk.metadata.file);
  if (visited.has(chunkFile)) return null;

  visited.add(chunkFile);

  if (depth < MAX_REEXPORT_DEPTH) {
    const fileChunks = allChunksByFile.get(chunkFile) || [];
    if (fileIsReExporter(fileChunks, reExporterPath, normalizePathCached)) {
      queue.push([chunkFile, depth + 1]);
    }
  }

  return chunk;
}

/**
 * Find transitive dependents through re-export chains using BFS.
 * Bounded to MAX_REEXPORT_DEPTH.
 */
export function findTransitiveDependents(
  reExporterPaths: string[],
  importIndex: Map<string, CodeChunk[]>,
  normalizedTarget: string,
  normalizePathCached: (path: string) => string,
  allChunksByFile: Map<string, CodeChunk[]>,
  existingFiles: Set<string>,
): CodeChunk[] {
  const transitiveChunks: CodeChunk[] = [];
  const visited = new Set<string>([normalizedTarget, ...existingFiles]);

  const queue: Array<[string, number]> = [];
  for (const rePath of reExporterPaths) {
    if (!visited.has(rePath)) {
      queue.push([rePath, 1]);
      visited.add(rePath);
    }
  }

  while (queue.length > 0) {
    const [reExporterPath, depth] = queue.shift()!;
    const dependentChunks = findDependentChunks(reExporterPath, importIndex);

    for (const chunk of dependentChunks) {
      const result = processTransitiveChunk(
        chunk,
        reExporterPath,
        depth,
        visited,
        allChunksByFile,
        normalizePathCached,
        queue,
      );
      if (result) transitiveChunks.push(result);
    }
  }

  return transitiveChunks;
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
  allChunks: CodeChunk[],
  workspaceRoot: string,
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

  // Find transitive dependents through re-export chains (barrel files)
  const allChunksByFile = groupChunksByNormalizedPath(allChunks, normalizePathCached);
  const reExporterPaths = buildReExportGraph(
    allChunksByFile,
    normalizedTarget,
    normalizePathCached,
  );
  if (reExporterPaths.length > 0) {
    const existingFiles = new Set(chunksByFile.keys());
    const transitiveChunks = findTransitiveDependents(
      reExporterPaths,
      importIndex,
      normalizedTarget,
      normalizePathCached,
      allChunksByFile,
      existingFiles,
    );
    if (transitiveChunks.length > 0) {
      const transitiveByFile = groupChunksByFile(transitiveChunks, workspaceRoot);
      for (const [fp, chunks] of transitiveByFile.entries()) {
        if (chunksByFile.has(fp)) {
          chunksByFile.get(fp)!.push(...chunks);
        } else {
          chunksByFile.set(fp, chunks);
        }
      }
    }
  }

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
