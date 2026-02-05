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
 * Maximum depth for following re-export chains.
 * Covers real-world barrel chains (A → barrel → barrel → consumer)
 * without risk of runaway traversal.
 */
const MAX_REEXPORT_DEPTH = 3;

/**
 * A file that re-exports symbols from another file.
 */
interface ReExporter {
  filepath: string;
  reExportedSymbols: string[];
}

/**
 * Check if a single chunk imports from the given source path.
 * Checks both `importedSymbols` keys and raw `imports` array.
 */
function chunkImportsFrom(
  chunk: SearchResult,
  sourcePath: string,
  normalizePathCached: (path: string) => string
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
 * Group chunks by their normalized file path.
 */
function groupChunksByNormalizedPath(
  chunks: SearchResult[],
  normalizePathCached: (path: string) => string
): Map<string, SearchResult[]> {
  const grouped = new Map<string, SearchResult[]>();
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
function fileIsReExporter(
  chunks: SearchResult[],
  sourcePath: string,
  normalizePathCached: (path: string) => string
): boolean {
  let importsFromSource = false;
  let hasExports = false;
  for (const chunk of chunks) {
    if (!importsFromSource && chunkImportsFrom(chunk, sourcePath, normalizePathCached)) {
      importsFromSource = true;
    }
    if (!hasExports && chunk.metadata.exports && chunk.metadata.exports.length > 0) {
      hasExports = true;
    }
    if (importsFromSource && hasExports) return true;
  }
  return false;
}

/**
 * Collect named symbols from a chunk's importedSymbols that match the target path.
 */
function collectNamedSymbolsFromChunk(
  chunk: SearchResult,
  normalizedTarget: string,
  normalizePathCached: (path: string) => string,
  symbols: Set<string>
): void {
  const importedSymbols = chunk.metadata.importedSymbols;
  if (!importedSymbols || typeof importedSymbols !== 'object') return;
  for (const [importPath, syms] of Object.entries(importedSymbols)) {
    if (matchesFile(normalizePathCached(importPath), normalizedTarget)) {
      for (const sym of syms) symbols.add(sym);
    }
  }
}

/**
 * Check if a chunk has raw imports matching the target path (adds '*' sentinel).
 */
function collectRawImportSentinel(
  chunk: SearchResult,
  normalizedTarget: string,
  normalizePathCached: (path: string) => string,
  symbols: Set<string>
): void {
  const imports = chunk.metadata.imports || [];
  for (const imp of imports) {
    if (matchesFile(normalizePathCached(imp), normalizedTarget)) symbols.add('*');
  }
}

/**
 * Collect symbols from a single chunk that are imported from the target path.
 * Adds named symbols from importedSymbols and '*' sentinel for raw imports.
 */
function collectSymbolsFromChunk(
  chunk: SearchResult,
  normalizedTarget: string,
  normalizePathCached: (path: string) => string,
  symbols: Set<string>
): void {
  collectNamedSymbolsFromChunk(chunk, normalizedTarget, normalizePathCached, symbols);
  collectRawImportSentinel(chunk, normalizedTarget, normalizePathCached, symbols);
}

/**
 * Collect symbols imported from a target path across all chunks of a file.
 * Returns a set of symbol names. Includes '*' sentinel for raw imports
 * where specific symbols are unknown.
 */
function collectImportedSymbolsFromTarget(
  chunks: SearchResult[],
  normalizedTarget: string,
  normalizePathCached: (path: string) => string
): Set<string> {
  const symbols = new Set<string>();
  for (const chunk of chunks) {
    collectSymbolsFromChunk(chunk, normalizedTarget, normalizePathCached, symbols);
  }
  return symbols;
}

/**
 * Collect all exported symbols across all chunks of a file.
 */
function collectExportsFromChunks(chunks: SearchResult[]): Set<string> {
  const allExports = new Set<string>();
  for (const chunk of chunks) {
    for (const exp of chunk.metadata.exports || []) allExports.add(exp);
  }
  return allExports;
}

/**
 * Find which symbols are re-exported (imported from target AND exported).
 * Handles wildcard/namespace imports by treating all exports as re-exported.
 */
function findReExportedSymbols(
  importsFromTarget: Set<string>,
  allExports: Set<string>
): string[] {
  if (importsFromTarget.has('*')) return [...allExports];

  for (const sym of importsFromTarget) {
    if (sym.startsWith('* as ')) return [...allExports];
  }

  const reExported: string[] = [];
  for (const sym of importsFromTarget) {
    if (allExports.has(sym)) reExported.push(sym);
  }
  return reExported;
}

/**
 * Build a graph of re-exporter files for a given target.
 *
 * A re-exporter is a file where a symbol appears in both
 * `importedSymbols[targetPath]` AND `exports`. This identifies barrel files
 * that re-export from the target.
 *
 * No new DB queries needed; uses the already-scanned chunks.
 */
function buildReExportGraph(
  allChunks: SearchResult[],
  normalizedTarget: string,
  normalizePathCached: (path: string) => string
): ReExporter[] {
  const chunksByFile = groupChunksByNormalizedPath(allChunks, normalizePathCached);
  const reExporters: ReExporter[] = [];

  for (const [filepath, chunks] of chunksByFile.entries()) {
    if (matchesFile(filepath, normalizedTarget)) continue;

    const importsFromTarget = collectImportedSymbolsFromTarget(chunks, normalizedTarget, normalizePathCached);
    const allExports = collectExportsFromChunks(chunks);
    if (importsFromTarget.size === 0 || allExports.size === 0) continue;

    const reExportedSymbols = findReExportedSymbols(importsFromTarget, allExports);
    if (reExportedSymbols.length > 0) {
      reExporters.push({ filepath, reExportedSymbols });
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
  chunk: SearchResult,
  reExporterPath: string,
  depth: number,
  visited: Set<string>,
  allChunksByFile: Map<string, SearchResult[]>,
  normalizePathCached: (path: string) => string,
  queue: Array<[string, number]>
): SearchResult | null {
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
 *
 * For each re-exporter, finds files that import from it, then checks if those
 * files are themselves re-exporters (for chained barrels). Bounded to
 * MAX_REEXPORT_DEPTH to prevent runaway traversal.
 */
function findTransitiveDependents(
  reExporters: ReExporter[],
  importIndex: Map<string, SearchResult[]>,
  normalizedTarget: string,
  normalizePathCached: (path: string) => string,
  allChunks: SearchResult[],
  existingFiles: Set<string>
): SearchResult[] {
  const transitiveChunks: SearchResult[] = [];
  const visited = new Set<string>([normalizedTarget, ...existingFiles]);
  const allChunksByFile = groupChunksByNormalizedPath(allChunks, normalizePathCached);

  const queue: Array<[string, number]> = [];
  for (const re of reExporters) {
    if (!visited.has(re.filepath)) {
      queue.push([re.filepath, 1]);
      visited.add(re.filepath);
    }
  }

  while (queue.length > 0) {
    const [reExporterPath, depth] = queue.shift()!;
    const dependentChunks = findDependentChunks(importIndex, reExporterPath);

    for (const chunk of dependentChunks) {
      const result = processTransitiveChunk(chunk, reExporterPath, depth, visited, allChunksByFile, normalizePathCached, queue);
      if (result) transitiveChunks.push(result);
    }
  }

  return transitiveChunks;
}

/**
 * Check if any chunk in the file imports the target symbol from any of the
 * given paths (direct target or re-exporter paths).
 */
function fileImportsSymbolFromAny(
  chunks: SearchResult[],
  targetSymbol: string,
  targetPaths: string[],
  normalizePathCached: (path: string) => string
): boolean {
  return chunks.some(chunk => {
    const importedSymbols = chunk.metadata.importedSymbols;
    if (!importedSymbols) return false;

    for (const [importPath, symbols] of Object.entries(importedSymbols)) {
      const normalizedImport = normalizePathCached(importPath);
      const matchesAny = targetPaths.some(tp => matchesFile(normalizedImport, tp));
      if (matchesAny) {
        if (symbols.includes(targetSymbol)) return true;
        if (symbols.some(s => s.startsWith('* as '))) return true;
      }
    }
    return false;
  });
}

/**
 * Scan chunks from the database.
 */
async function scanChunks(
  vectorDB: VectorDBInterface,
  crossRepo: boolean,
  log: (message: string, level?: 'warning') => void
): Promise<{ allChunks: SearchResult[]; hitLimit: boolean }> {
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
  
  return { allChunks, hitLimit };
}

/**
 * Create a cached path normalizer.
 */
function createPathNormalizer(): (path: string) => string {
  const workspaceRoot = process.cwd().replace(/\\/g, '/');
  const cache = new Map<string, string>();
  
  return (path: string): string => {
    if (!cache.has(path)) {
      cache.set(path, normalizePath(path, workspaceRoot));
    }
    return cache.get(path)!;
  };
}

/**
 * Group chunks by their canonical file path.
 */
function groupChunksByFile(chunks: SearchResult[]): Map<string, SearchResult[]> {
  const workspaceRoot = process.cwd().replace(/\\/g, '/');
  const chunksByFile = new Map<string, SearchResult[]>();
  
  for (const chunk of chunks) {
    const canonical = getCanonicalPath(chunk.metadata.file, workspaceRoot);
    const existing = chunksByFile.get(canonical) || [];
    existing.push(chunk);
    chunksByFile.set(canonical, existing);
  }
  
  return chunksByFile;
}

/**
 * Build the dependents list, either file-level or symbol-level.
 */
function buildDependentsList(
  chunksByFile: Map<string, SearchResult[]>,
  symbol: string | undefined,
  normalizedTarget: string,
  normalizePathCached: (path: string) => string,
  allChunks: SearchResult[],
  filepath: string,
  log: (message: string, level?: 'warning') => void,
  reExporterPaths: string[] = []
): { dependents: DependentInfo[]; totalUsageCount?: number } {
  if (symbol) {
    // Validate that the target file exports this symbol
    validateSymbolExport(allChunks, normalizedTarget, normalizePathCached, symbol, filepath, log);

    // Symbol-level analysis — check imports from target AND re-exporter paths
    return findSymbolUsages(chunksByFile, symbol, normalizedTarget, normalizePathCached, reExporterPaths);
  }

  // File-level analysis
  const dependents = Array.from(chunksByFile.keys()).map(fp => ({
    filepath: fp,
    isTestFile: isTestFile(fp),
  }));

  return { dependents, totalUsageCount: undefined };
}

/**
 * Validate that the target file exports the requested symbol.
 * 
 * Design decision: This function only logs a warning and does NOT throw an error
 * or return false to stop execution. This is intentional because:
 * 
 * 1. The export might be dynamic or conditional (not captured by static analysis)
 * 2. False positives are better than false negatives (we want to show potential matches)
 * 3. The user can see the warning and interpret results accordingly
 * 
 * The function continues to search for usages even if the symbol isn't found in exports,
 * which may reveal re-exports, dynamic exports, or help diagnose indexing issues.
 */
function validateSymbolExport(
  allChunks: SearchResult[],
  normalizedTarget: string,
  normalizePathCached: (path: string) => string,
  symbol: string,
  filepath: string,
  log: (message: string, level?: 'warning') => void
): void {
  const targetFileExportsSymbol = allChunks.some(chunk => {
    const chunkFile = normalizePathCached(chunk.metadata.file);
    return matchesFile(chunkFile, normalizedTarget) && 
           chunk.metadata.exports?.includes(symbol);
  });
  
  if (!targetFileExportsSymbol) {
    log(`Warning: Symbol "${symbol}" not found in exports of ${filepath}`, 'warning');
  }
}

/**
 * Merge source chunks into the target map, grouping by file path.
 */
function mergeChunksByFile(
  target: Map<string, SearchResult[]>,
  source: Map<string, SearchResult[]>
): void {
  for (const [fp, chunks] of source.entries()) {
    const existing = target.get(fp);
    if (existing) {
      existing.push(...chunks);
    } else {
      target.set(fp, chunks);
    }
  }
}

/**
 * Find and merge transitive dependents through re-export chains into chunksByFile.
 */
function mergeTransitiveDependents(
  reExporters: ReExporter[],
  importIndex: Map<string, SearchResult[]>,
  normalizedTarget: string,
  normalizePathCached: (path: string) => string,
  allChunks: SearchResult[],
  chunksByFile: Map<string, SearchResult[]>,
  log: (message: string, level?: 'warning') => void
): void {
  const existingFiles = new Set(chunksByFile.keys());
  const transitiveChunks = findTransitiveDependents(
    reExporters, importIndex, normalizedTarget, normalizePathCached, allChunks, existingFiles
  );
  if (transitiveChunks.length > 0) {
    const transitiveByFile = groupChunksByFile(transitiveChunks);
    mergeChunksByFile(chunksByFile, transitiveByFile);
    log(`Found ${transitiveByFile.size} additional dependents via re-export chains`);
  }
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
  // Scan chunks from database
  const { allChunks, hitLimit } = await scanChunks(vectorDB, crossRepo, log);
  log(`Scanning ${allChunks.length} chunks for imports...`);

  // Setup path normalization
  const normalizePathCached = createPathNormalizer();
  const normalizedTarget = normalizePathCached(filepath);
  
  // Find dependent chunks and group by file
  const importIndex = buildImportIndex(allChunks, normalizePathCached);
  const dependentChunks = findDependentChunks(importIndex, normalizedTarget);
  const chunksByFile = groupChunksByFile(dependentChunks);

  // Find transitive dependents through re-export chains (barrel files)
  const reExporters = buildReExportGraph(allChunks, normalizedTarget, normalizePathCached);
  if (reExporters.length > 0) {
    mergeTransitiveDependents(reExporters, importIndex, normalizedTarget, normalizePathCached, allChunks, chunksByFile, log);
  }

  // Calculate metrics
  const fileComplexities = calculateFileComplexities(chunksByFile);
  const complexityMetrics = calculateOverallComplexityMetrics(fileComplexities);

  // Build dependents list (file-level or symbol-level)
  const reExporterPaths = reExporters.map(re => re.filepath);
  const { dependents, totalUsageCount } = buildDependentsList(
    chunksByFile, symbol, normalizedTarget, normalizePathCached, allChunks, filepath, log, reExporterPaths
  );

  // Sort dependents: production files first, then test files
  dependents.sort((a, b) => {
    if (a.isTestFile === b.isTestFile) return 0;
    return a.isTestFile ? 1 : -1;
  });

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
 * 
 * Uses both:
 * - `imports` array (raw import statements for TS/JS)
 * - `importedSymbols` keys (parsed module paths for Python/PHP)
 */
function buildImportIndex(
  allChunks: SearchResult[],
  normalizePathCached: (path: string) => string
): Map<string, SearchResult[]> {
  const importIndex = new Map<string, SearchResult[]>();

  const addToIndex = (importPath: string, chunk: SearchResult) => {
    const normalizedImport = normalizePathCached(importPath);
    if (!importIndex.has(normalizedImport)) {
      importIndex.set(normalizedImport, []);
    }
    importIndex.get(normalizedImport)!.push(chunk);
  };

  for (const chunk of allChunks) {
    // Index raw imports (TS/JS style: "./utils/logger")
    const imports = chunk.metadata.imports || [];
    for (const imp of imports) {
      addToIndex(imp, chunk);
    }
    
    // Index importedSymbols keys (Python/PHP style: "django.http", "App\Models\User")
    // This provides the parsed module paths that match file paths better
    const importedSymbols = chunk.metadata.importedSymbols;
    if (importedSymbols && typeof importedSymbols === 'object') {
      for (const modulePath of Object.keys(importedSymbols)) {
        addToIndex(modulePath, chunk);
      }
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
 * 1. Files that import the symbol from the target file or re-exporter paths
 * 2. Chunks within those files that have call sites for the symbol
 *
 * **Known Limitation - Namespace Imports:**
 * Files with namespace imports (e.g., `import * as utils from './module'`) are included
 * in results if they have call sites matching the symbol name. However, call sites are
 * tracked without namespace prefixes (e.g., `utils.foo()` → tracked as `'foo'`), which
 * can cause false positives when the same symbol name exists in multiple namespaced modules.
 * This is rare in practice due to namespace isolation in well-structured codebases.
 */
function findSymbolUsages(
  chunksByFile: Map<string, SearchResult[]>,
  targetSymbol: string,
  normalizedTarget: string,
  normalizePathCached: (path: string) => string,
  reExporterPaths: string[] = []
): { dependents: DependentInfo[]; totalUsageCount: number } {
  const dependents: DependentInfo[] = [];
  let totalUsageCount = 0;
  const allTargetPaths = [normalizedTarget, ...reExporterPaths];

  for (const [filepath, chunks] of chunksByFile.entries()) {
    // Check if file imports the symbol from either the target or any re-exporter
    if (!fileImportsSymbolFromAny(chunks, targetSymbol, allTargetPaths, normalizePathCached)) {
      continue;
    }

    const usages = extractSymbolUsagesFromChunks(chunks, targetSymbol);
    
    dependents.push({
      filepath,
      isTestFile: isTestFile(filepath),
      usages: usages.length > 0 ? usages : undefined,
    });

    totalUsageCount += usages.length;
  }

  return { dependents, totalUsageCount };
}

/**
 * Extract all usages of a symbol from a file's chunks.
 */
function extractSymbolUsagesFromChunks(chunks: SearchResult[], targetSymbol: string): SymbolUsage[] {
  const usages: SymbolUsage[] = [];
  
  for (const chunk of chunks) {
    const callSites = chunk.metadata.callSites;
    if (!callSites) continue;
    
    // Split content once per chunk for efficiency (avoid repeated splits)
    const lines = chunk.content.split('\n');
    
    for (const call of callSites) {
      if (call.symbol === targetSymbol) {
        usages.push({
          callerSymbol: chunk.metadata.symbolName || 'unknown',
          line: call.line,
          snippet: extractSnippet(lines, call.line, chunk.metadata.startLine, targetSymbol),
        });
      }
    }
  }
  
  return usages;
}

/**
 * Extract a code snippet for a call site with bounds checking.
 * If the target line is blank, searches nearby lines for context.
 */
function extractSnippet(lines: string[], callLine: number, startLine: number, symbolName: string): string {
  const lineIndex = callLine - startLine;
  const placeholder = `${symbolName}(...)`;
  
  if (lineIndex < 0 || lineIndex >= lines.length) {
    // This can happen when call site line is outside chunk boundaries (edge case)
    // Not necessarily an error - could be chunk boundary misalignment
    return placeholder;
  }
  
  // Try the direct line first
  const directLine = lines[lineIndex].trim();
  if (directLine) {
    return directLine;
  }
  
  // If direct line is blank, search for nearby non-blank context
  // Limit search radius to 5 lines to ensure contextual relevance
  const searchRadius = 5;
  
  // Search backwards first (prefer earlier lines)
  for (let i = lineIndex - 1; i >= Math.max(0, lineIndex - searchRadius); i--) {
    const candidate = lines[i].trim();
    if (candidate) {
      return candidate;
    }
  }
  
  // Search forwards
  for (let i = lineIndex + 1; i < Math.min(lines.length, lineIndex + searchRadius + 1); i++) {
    const candidate = lines[i].trim();
    if (candidate) {
      return candidate;
    }
  }
  
  return placeholder;
}

