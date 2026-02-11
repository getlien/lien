import type { SearchResult, VectorDBInterface } from '@liendev/core';
import {
  findTransitiveDependents,
  normalizePath,
  matchesFile,
  getCanonicalPath,
  isTestFile,
} from '@liendev/core';

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
  HIGH_COMPLEXITY_DEPENDENT: 10, // Individual file is complex
  CRITICAL_AVG: 15, // Average complexity indicates systemic complexity
  CRITICAL_MAX: 25, // Peak complexity indicates hotspot
  HIGH_AVG: 10, // Moderately complex on average
  HIGH_MAX: 20, // Some complex functions exist
  MEDIUM_AVG: 6, // Slightly above simple code
  MEDIUM_MAX: 15, // Occasional branching
} as const;

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Cached scan results to avoid re-scanning when the index hasn't changed.
 * Keyed by indexVersion — when the index is rebuilt, the version changes
 * and the cache is invalidated automatically.
 */
let scanCache: {
  indexVersion: number;
  crossRepo: boolean;
  importIndex: Map<string, SearchResult[]>;
  allChunksByFile: Map<string, SearchResult[]>;
  totalChunks: number;
  hitLimit: boolean;
} | null = null;

/**
 * Clear the dependency scan cache. Exported for testing.
 */
export function clearDependencyCache(): void {
  scanCache = null;
}

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
 * A file that re-exports symbols from another file.
 */
interface ReExporter {
  filepath: string;
  reExportedSymbols: string[];
}

/**
 * Collect named symbols from a chunk's importedSymbols that match the target path.
 */
function collectNamedSymbolsFromChunk(
  chunk: SearchResult,
  normalizedTarget: string,
  normalizePathCached: (path: string) => string,
  symbols: Set<string>,
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
  symbols: Set<string>,
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
  symbols: Set<string>,
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
  normalizePathCached: (path: string) => string,
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
function findReExportedSymbols(importsFromTarget: Set<string>, allExports: Set<string>): string[] {
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
  allChunksByFile: Map<string, SearchResult[]>,
  normalizedTarget: string,
  normalizePathCached: (path: string) => string,
): ReExporter[] {
  const reExporters: ReExporter[] = [];

  for (const [filepath, chunks] of allChunksByFile.entries()) {
    if (matchesFile(filepath, normalizedTarget)) continue;

    const importsFromTarget = collectImportedSymbolsFromTarget(
      chunks,
      normalizedTarget,
      normalizePathCached,
    );
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
 * Check if any chunk in the file imports the target symbol from any of the
 * given paths (direct target or re-exporter paths).
 */
function fileImportsSymbolFromAny(
  chunks: SearchResult[],
  targetSymbol: string,
  targetPaths: string[],
  normalizePathCached: (path: string) => string,
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
 * Add a chunk to the import index.
 */
function addChunkToImportIndex(
  chunk: SearchResult,
  normalizePathCached: (path: string) => string,
  importIndex: Map<string, SearchResult[]>,
): void {
  const imports = chunk.metadata.imports || [];
  for (const imp of imports) {
    const normalizedImport = normalizePathCached(imp);
    if (!importIndex.has(normalizedImport)) {
      importIndex.set(normalizedImport, []);
    }
    importIndex.get(normalizedImport)!.push(chunk);
  }

  const importedSymbols = chunk.metadata.importedSymbols;
  if (importedSymbols && typeof importedSymbols === 'object') {
    for (const modulePath of Object.keys(importedSymbols)) {
      const normalizedImport = normalizePathCached(modulePath);
      if (!importIndex.has(normalizedImport)) {
        importIndex.set(normalizedImport, []);
      }
      importIndex.get(normalizedImport)!.push(chunk);
    }
  }
}

/**
 * Add a chunk to the file grouping map.
 */
function addChunkToFileMap(
  chunk: SearchResult,
  normalizePathCached: (path: string) => string,
  fileMap: Map<string, SearchResult[]>,
  seenRanges: Map<string, Set<string>>,
): void {
  const canonical = normalizePathCached(chunk.metadata.file);
  if (!fileMap.has(canonical)) {
    fileMap.set(canonical, []);
    seenRanges.set(canonical, new Set());
  }
  // Skip duplicate chunks (same line range) from abs/relative path variants
  const rangeKey = `${chunk.metadata.startLine}-${chunk.metadata.endLine}`;
  const seen = seenRanges.get(canonical)!;
  if (seen.has(rangeKey)) return;
  seen.add(rangeKey);
  fileMap.get(canonical)!.push(chunk);
}

/**
 * Scan chunks from the database using paginated iteration.
 * Builds import index and file groupings incrementally to avoid loading all chunks at once.
 */
async function scanChunksPaginated(
  vectorDB: VectorDBInterface,
  crossRepo: boolean,
  log: (message: string, level?: 'warning') => void,
  normalizePathCached: (path: string) => string,
): Promise<{
  importIndex: Map<string, SearchResult[]>;
  allChunksByFile: Map<string, SearchResult[]>;
  totalChunks: number;
  hitLimit: boolean;
}> {
  const importIndex = new Map<string, SearchResult[]>();
  const allChunksByFile = new Map<string, SearchResult[]>();
  const seenRanges = new Map<string, Set<string>>();
  let totalChunks = 0;

  // Cross-repo: fall back to bulk scan (scanCrossRepo doesn't have paginated variant)
  if (crossRepo && vectorDB.supportsCrossRepo) {
    const CROSS_REPO_LIMIT = 100000;
    const allChunks = await vectorDB.scanCrossRepo({ limit: CROSS_REPO_LIMIT });
    totalChunks = allChunks.length;
    const hitLimit = totalChunks >= CROSS_REPO_LIMIT;
    if (hitLimit) {
      log(
        `Warning: cross-repo scan hit ${CROSS_REPO_LIMIT} chunk limit. Results may be incomplete.`,
        'warning',
      );
    }
    for (const chunk of allChunks) {
      addChunkToImportIndex(chunk, normalizePathCached, importIndex);
      addChunkToFileMap(chunk, normalizePathCached, allChunksByFile, seenRanges);
    }
    return { importIndex, allChunksByFile, totalChunks, hitLimit };
  }

  if (crossRepo) {
    log(
      'Warning: crossRepo=true requires a cross-repo-capable backend. Falling back to single-repo paginated scan.',
      'warning',
    );
  }

  // Paginated scan: build indexes incrementally
  for await (const page of vectorDB.scanPaginated({ pageSize: 1000 })) {
    totalChunks += page.length;
    for (const chunk of page) {
      addChunkToImportIndex(chunk, normalizePathCached, importIndex);
      addChunkToFileMap(chunk, normalizePathCached, allChunksByFile, seenRanges);
    }
  }

  return { importIndex, allChunksByFile, totalChunks, hitLimit: false };
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
  targetFileChunks: SearchResult[],
  filepath: string,
  log: (message: string, level?: 'warning') => void,
  reExporterPaths: string[] = [],
): { dependents: DependentInfo[]; totalUsageCount?: number } {
  if (symbol) {
    // Validate that the target file exports this symbol
    validateSymbolExport(targetFileChunks, symbol, filepath, log);

    // Symbol-level analysis — check imports from target AND re-exporter paths
    return findSymbolUsages(
      chunksByFile,
      symbol,
      normalizedTarget,
      normalizePathCached,
      reExporterPaths,
    );
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
  targetFileChunks: SearchResult[],
  symbol: string,
  filepath: string,
  log: (message: string, level?: 'warning') => void,
): void {
  const exportsSymbol = targetFileChunks.some(chunk => chunk.metadata.exports?.includes(symbol));

  if (!exportsSymbol) {
    log(`Warning: Symbol "${symbol}" not found in exports of ${filepath}`, 'warning');
  }
}

/**
 * Merge source chunks into the target map, grouping by file path.
 */
function mergeChunksByFile(
  target: Map<string, SearchResult[]>,
  source: Map<string, SearchResult[]>,
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
  allChunksByFile: Map<string, SearchResult[]>,
  chunksByFile: Map<string, SearchResult[]>,
  log: (message: string, level?: 'warning') => void,
): void {
  const existingFiles = new Set(chunksByFile.keys());
  const transitiveChunks = findTransitiveDependents(
    reExporters.map(r => r.filepath),
    importIndex,
    normalizedTarget,
    normalizePathCached,
    allChunksByFile,
    existingFiles,
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
 * @param indexVersion - Optional: index version for cache lookup. When provided and matching
 *   the cached version, the expensive scanChunksPaginated call is skipped.
 */
/**
 * Get scan results from cache or perform a fresh paginated scan.
 */
async function getOrScanChunks(
  vectorDB: VectorDBInterface,
  crossRepo: boolean,
  log: (message: string, level?: 'warning') => void,
  normalizePathCached: (path: string) => string,
  indexVersion?: number,
): Promise<{
  importIndex: Map<string, SearchResult[]>;
  allChunksByFile: Map<string, SearchResult[]>;
  totalChunks: number;
  hitLimit: boolean;
}> {
  if (
    indexVersion !== undefined &&
    scanCache !== null &&
    scanCache.indexVersion === indexVersion &&
    scanCache.crossRepo === crossRepo
  ) {
    log(`Using cached import index (${scanCache.totalChunks} chunks, version ${indexVersion})`);
    return scanCache;
  }

  const scanResult = await scanChunksPaginated(vectorDB, crossRepo, log, normalizePathCached);

  if (indexVersion !== undefined) {
    scanCache = { indexVersion, crossRepo, ...scanResult };
  }
  log(`Scanned ${scanResult.totalChunks} chunks for imports...`);
  return scanResult;
}

/**
 * Find and merge transitive dependents from re-export chains (barrel files).
 */
function resolveTransitiveDependents(
  allChunksByFile: Map<string, SearchResult[]>,
  normalizedTarget: string,
  normalizePathCached: (path: string) => string,
  importIndex: Map<string, SearchResult[]>,
  chunksByFile: Map<string, SearchResult[]>,
  log: (message: string, level?: 'warning') => void,
): ReExporter[] {
  const reExporters = buildReExportGraph(allChunksByFile, normalizedTarget, normalizePathCached);
  if (reExporters.length > 0) {
    mergeTransitiveDependents(
      reExporters,
      importIndex,
      normalizedTarget,
      normalizePathCached,
      allChunksByFile,
      chunksByFile,
      log,
    );
  }
  return reExporters;
}

export async function findDependents(
  vectorDB: VectorDBInterface,
  filepath: string,
  crossRepo: boolean,
  log: (message: string, level?: 'warning') => void,
  symbol?: string,
  indexVersion?: number,
): Promise<DependencyAnalysisResult> {
  const normalizePathCached = createPathNormalizer();
  const normalizedTarget = normalizePathCached(filepath);

  const { importIndex, allChunksByFile, hitLimit } = await getOrScanChunks(
    vectorDB,
    crossRepo,
    log,
    normalizePathCached,
    indexVersion,
  );

  // Find dependent chunks and group by file
  const dependentChunks = findDependentChunks(importIndex, normalizedTarget);
  const chunksByFile = groupChunksByFile(dependentChunks);

  // Find transitive dependents through re-export chains (barrel files)
  const reExporters = resolveTransitiveDependents(
    allChunksByFile,
    normalizedTarget,
    normalizePathCached,
    importIndex,
    chunksByFile,
    log,
  );

  // Calculate metrics
  const fileComplexities = calculateFileComplexities(chunksByFile);
  const complexityMetrics = calculateOverallComplexityMetrics(fileComplexities);

  // Build dependents list (file-level or symbol-level)
  // Only need target file chunks for symbol export validation — avoid flattening all chunks
  const targetFileChunks = symbol ? (allChunksByFile.get(normalizedTarget) ?? []) : [];
  const reExporterPaths = reExporters.map(re => re.filepath);
  const { dependents, totalUsageCount } = buildDependentsList(
    chunksByFile,
    symbol,
    normalizedTarget,
    normalizePathCached,
    targetFileChunks,
    filepath,
    log,
    reExporterPaths,
  );

  // Sort dependents: production files first, then test files
  dependents.sort((a, b) => {
    if (a.isTestFile === b.isTestFile) return 0;
    return a.isTestFile ? 1 : -1;
  });

  // Calculate test/production split
  const testDependentCount = dependents.filter(f => f.isTestFile).length;
  const productionDependentCount = dependents.length - testDependentCount;

  // Only flatten all chunks when needed for cross-repo grouping (groupDependentsByRepo)
  const allChunks = crossRepo ? Array.from(allChunksByFile.values()).flat() : [];

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
 * Find dependent chunks using direct lookup and fuzzy matching.
 */
function findDependentChunks(
  importIndex: Map<string, SearchResult[]>,
  normalizedTarget: string,
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
function calculateFileComplexities(chunksByFile: Map<string, SearchResult[]>): FileComplexity[] {
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
function calculateOverallComplexityMetrics(fileComplexities: FileComplexity[]): ComplexityMetrics {
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
    .map(f => ({
      filepath: f.filepath,
      maxComplexity: f.maxComplexity,
      avgComplexity: f.avgComplexity,
    }));

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
 * Calculate risk level based on dependent count and complexity.
 * @param dependentCount Total number of dependent files
 * @param complexityRiskBoost Risk boost from complexity analysis
 * @param productionDependentCount Optional: if provided, use this for risk calculation instead of dependentCount
 */
export function calculateRiskLevel(
  dependentCount: number,
  complexityRiskBoost: 'low' | 'medium' | 'high' | 'critical',
  productionDependentCount?: number,
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
    effectiveCount === 0
      ? 'low'
      : effectiveCount <= DEPENDENT_COUNT_THRESHOLDS.LOW
        ? 'low'
        : effectiveCount <= DEPENDENT_COUNT_THRESHOLDS.MEDIUM
          ? 'medium'
          : effectiveCount <= DEPENDENT_COUNT_THRESHOLDS.HIGH
            ? 'high'
            : 'critical';

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
  chunks: SearchResult[],
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
  reExporterPaths: string[] = [],
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
function extractSymbolUsagesFromChunks(
  chunks: SearchResult[],
  targetSymbol: string,
): SymbolUsage[] {
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
function extractSnippet(
  lines: string[],
  callLine: number,
  startLine: number,
  symbolName: string,
): string {
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
