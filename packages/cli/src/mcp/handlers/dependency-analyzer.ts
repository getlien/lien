import type { SearchResult, VectorDBInterface } from '@liendev/core';
import {
  findTransitiveDependents,
  findReExportedSymbolsForFile,
  normalizePath,
  matchesFile,
  getCanonicalPath,
  isTestFile,
  isUnresolvableWholeModuleImport,
  importMatchesTarget,
  hasSingleFileImportSemantics,
  detectLanguage,
  hasEnclosingNamespaceAccess,
  findCSharpTypeReferenceDependents,
  COMPLEXITY_THRESHOLDS,
} from '@liendev/parser';

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

// Complexity thresholds for risk assessment live in @liendev/parser
// (packages/parser/src/dependency-analyzer.ts) — imported above, not
// re-declared here.

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Cached scan results to avoid re-scanning when the index hasn't changed.
 * Keyed by indexVersion — when the index is rebuilt, the version changes
 * and the cache is invalidated automatically.
 */
let scanCache: {
  indexVersion: number;
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
  /** Depth at which this dependent was first discovered (1 = direct). */
  hops?: number;
  /**
   * Present (`'inferred'`) only for a dependent recovered by the C#
   * type-reference-matching fallback (#930's remaining half -- see
   * `findCSharpTypeReferenceDependents`'s module doc) instead of a real
   * import edge: a word-boundary text match against a uniquely-declared
   * type name, not an import-verified association. Absent for every
   * ordinary, import-verified dependent (the default, confident tier) -- a
   * caller that needs to distinguish "verified" from "text-matched, lower
   * confidence" should filter on this field rather than assuming every
   * entry in `dependents` came from the import graph.
   */
  confidence?: 'inferred';
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
  /** True when BFS stopped because it hit the maxNodes cap. */
  truncated: boolean;
  /** Count of production dependents that are NOT imported by any test file. */
  uncoveredProductionDependents: number;
  /**
   * True when `symbol` was requested but couldn't be attributed at the
   * symbol level (it isn't a top-level export of the target file -- the
   * signature of a method or constructor, which no import statement in any
   * language names independently of its class -- see `buildDependentsList`),
   * so `dependents`/`riskLevel` were widened to the full file-level answer
   * instead of asserting an unverifiable symbol-scoped count.
   */
  symbolAttributionDegraded?: boolean;
  /**
   * Only meaningful when `symbolAttributionDegraded` is `true`. Whether
   * `symbol` was found ANYWHERE among the target file's own indexed chunks
   * (as a chunk's own `symbolName` -- methods, constructors, and nested
   * functions/classes each get their own chunk -- or inside that chunk's
   * `symbols` bag), as opposed to a top-level export specifically. `true`
   * backs up the "likely a method or constructor" reading; `false` means the
   * name doesn't appear in this file's indexed chunks at all, which is just
   * as consistent with a typo, a hallucinated symbol, or one that used to
   * exist and was removed -- a caller wording the caveat should hedge
   * instead of asserting the method/constructor cause in that case.
   */
  symbolFoundInFile?: boolean;
  /**
   * True for a FILE-level query (no `symbol` requested) that came back with
   * zero dependents for a language where `hasEnclosingNamespaceAccess` is
   * set (currently only C# -- see that flag's doc comment), EVEN AFTER
   * attempting the type-reference-matching recovery below
   * (`dependentAttributionPartial`). Those languages let a real caller use
   * `filepath`'s types with no per-file import statement naming it at all
   * (C#'s `global using` / implicit enclosing-namespace member access --
   * #930), so the import-graph scan this function runs has no signal for
   * that usage shape. `dependentCount: 0` / `riskLevel: "low"` in this case
   * means "neither scan found anything," not "nothing depends on this
   * file" -- the same false-all-clear risk `symbolAttributionDegraded`
   * guards against for symbol queries, just for the file-level answer
   * instead. Mutually exclusive with `dependentAttributionPartial`: this
   * requires the final `dependents.length` to be zero; that one requires it
   * to be positive.
   */
  dependentAttributionIncomplete?: boolean;
  /**
   * True for a FILE-level query (no `symbol`) where the import graph found
   * zero dependents but the C# type-reference-matching fallback
   * (`findCSharpTypeReferenceDependents`, #930's remaining half) recovered
   * one or more. Those recovered entries are tagged `confidence: 'inferred'`
   * on `DependentInfo` -- a word-boundary text match against a
   * uniquely-declared type name, not an import-verified edge -- so
   * `dependentCount`/`riskLevel` here are a recovered LOWER BOUND, not a
   * verified/complete answer: the heuristic can still miss a real dependent
   * that references the type via an alias, a generic type argument, or
   * reflection, none of which spell the bare type name in a matchable way.
   */
  dependentAttributionPartial?: boolean;
  /**
   * False when the requested target has zero chunks anywhere in the scanned
   * index (#928) — i.e. it isn't a real file the indexer has seen, whether
   * because it was never indexed, is misspelled, or genuinely has no
   * extractable content. `matchesFile`'s fuzzy-matching strategies are tuned
   * to resolve real ambiguous specifiers (relative imports, namespace
   * prefixes, bare crate-root modules); they were never meant to stand in
   * for an existence check, and running them against a target with no
   * chunks of its own risks matching on textual coincidence alone (a
   * fabricated path silently inheriting an unrelated real file's entire
   * dependent graph — see the PHP `Command/Command.php` basename-collision
   * repro in #928). When `false`, `dependents`/`symbolAttributionDegraded`/
   * `dependentAttributionIncomplete` above are moot -- `dependents` is
   * deliberately left empty rather than fuzzy-matched, and callers should
   * treat the whole result as "unresolved", not "confirmed zero dependents".
   */
  targetIndexed: boolean;
}

/**
 * A file that re-exports symbols from another file.
 */
interface ReExporter {
  filepath: string;
  reExportedSymbols: string[];
}

/**
 * Build a graph of re-exporter files for a given target.
 *
 * A re-exporter is a file where a symbol appears in both
 * `importedSymbols[targetPath]` AND `exports`. This identifies barrel files
 * that re-export from the target.
 *
 * No new DB queries needed; uses the already-scanned chunks. The intersection
 * algorithm itself lives in `@liendev/parser` (`findReExportedSymbolsForFile`)
 * — shared with the parser's own `fileIsReExporter` (#532).
 */
function buildReExportGraph(
  allChunksByFile: Map<string, SearchResult[]>,
  normalizedTarget: string,
  normalizePathCached: (path: string) => string,
): ReExporter[] {
  const reExporters: ReExporter[] = [];

  for (const [filepath, chunks] of allChunksByFile.entries()) {
    if (matchesFile(filepath, normalizedTarget)) continue;

    const reExportedSymbols = findReExportedSymbolsForFile(
      chunks,
      normalizedTarget,
      normalizePathCached,
    );
    if (reExportedSymbols.length > 0) {
      reExporters.push({ filepath, reExportedSymbols });
    }
  }

  return reExporters;
}

/**
 * Check if any chunk in the file imports the target symbol from any of the
 * given paths (direct target or re-exporter paths).
 *
 * Uses `importMatchesTarget`, which applies the #884 whole-module guard
 * before `matchesFile` — see its doc comment in path-matching.ts (#886).
 *
 * Qualified-access fallback: no language's import statement names a class's
 * members, or (for Go) a package's individual functions, independently of
 * the class/package itself -- `use Ns\\Cursor;` records `Cursor`, never
 * `__construct`; Go's `import "app/bytesconv"` records the package alias
 * `bytesconv`, never `StringToBytes`. Requiring a literal `targetSymbol`
 * match inside `importedSymbols` for those cases means the check can never
 * pass, even though the call site itself (`bytesconv.StringToBytes(...)`,
 * `$cursor->moveUp()`) is genuine, correctly-attributed evidence -- and a
 * caller mandated to check this before touching a method/constructor/
 * package-level function would see a false "0 dependents, low risk"
 * all-clear on code with real callers. So once a chunk is confirmed to
 * import from the target path at all, a real call site named
 * `targetSymbol` in that same chunk is accepted too -- the same category of
 * trade-off already documented on `findSymbolUsages` below for JS namespace
 * imports (occasional same-name false positives, far better than a
 * guaranteed false negative for every member/qualified symbol).
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

    const entriesFromTarget = Object.entries(importedSymbols).filter(([importPath]) =>
      targetPaths.some(tp =>
        importMatchesTarget(importPath, chunk.metadata.file, tp, normalizePathCached),
      ),
    );
    if (entriesFromTarget.length === 0) return false;

    const namedMatch = entriesFromTarget.some(
      ([, symbols]) => symbols.includes(targetSymbol) || symbols.some(s => s.startsWith('* as ')),
    );
    if (namedMatch) return true;

    return (chunk.metadata.callSites ?? []).some(cs => cs.symbol === targetSymbol);
  });
}

/**
 * Index one (importPath, chunk) pair, unless it's a bare whole-module import
 * (#884): for a `wholeModuleImports` language (Swift), a bare import can only
 * ever match a target through basename coincidence, not a real per-file
 * dependency — see `isUnresolvableWholeModuleImport`'s doc comment. Indexing
 * it anyway would let it win both the direct-lookup and fuzzy-match branches
 * of `findDependentChunks` below purely by coincidence.
 */
function indexImportEntry(
  importPath: string,
  chunk: SearchResult,
  normalizePathCached: (path: string) => string,
  importIndex: Map<string, SearchResult[]>,
): void {
  if (isUnresolvableWholeModuleImport(importPath, chunk.metadata.file)) return;
  const normalizedImport = normalizePathCached(importPath);
  if (!importIndex.has(normalizedImport)) {
    importIndex.set(normalizedImport, []);
  }
  importIndex.get(normalizedImport)!.push(chunk);
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
    indexImportEntry(imp, chunk, normalizePathCached, importIndex);
  }

  const importedSymbols = chunk.metadata.importedSymbols;
  if (importedSymbols && typeof importedSymbols === 'object') {
    for (const modulePath of Object.keys(importedSymbols)) {
      indexImportEntry(modulePath, chunk, normalizePathCached, importIndex);
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
 * Scan chunks from the database and build the import index + per-file
 * chunk groupings. Uses a single full-table read rather than offset-based
 * pagination — offset-based paging cost is O(N²) in chunk count, and a
 * single `.toArray()` is ~24x faster on monorepo-scale indexes (5.3s →
 * 217ms locally). Memory is unchanged in practice since this function
 * already accumulates every chunk into JS-side maps.
 */
async function scanAllChunks(
  vectorDB: VectorDBInterface,
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

  const allChunks = await vectorDB.scanAll();
  for (const chunk of allChunks) {
    addChunkToImportIndex(chunk, normalizePathCached, importIndex);
    addChunkToFileMap(chunk, normalizePathCached, allChunksByFile, seenRanges);
  }

  return { importIndex, allChunksByFile, totalChunks: allChunks.length, hitLimit: false };
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
 *
 * When `symbol` doesn't resolve to any usage AND it isn't one of the target
 * file's own top-level exports, that combination is the structural
 * signature of a method or constructor query (#928-adjacent) -- no
 * language's import statement names a class member independently of its
 * class, so neither the named-import check nor its call-site fallback in
 * `fileImportsSymbolFromAny` had anything to key off. Asserting the
 * symbol-scoped zero in that case would read as "no callers, safe to
 * change" on a file that may have real file-level dependents, so this
 * degrades to the file-level answer instead (`symbolAttributionDegraded`
 * tells the caller the count is a widened floor, not a verified
 * per-symbol count) -- getting the failure mode right beats asserting a
 * precise count we can't actually back up.
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
): {
  dependents: DependentInfo[];
  totalUsageCount?: number;
  symbolAttributionDegraded?: boolean;
  symbolFoundInFile?: boolean;
} {
  if (symbol) {
    const exportsSymbol = validateSymbolExport(targetFileChunks, symbol, filepath, log);

    // Symbol-level analysis — check imports from target AND re-exporter paths
    const symbolResult = findSymbolUsages(
      chunksByFile,
      symbol,
      normalizedTarget,
      normalizePathCached,
      reExporterPaths,
    );

    if (!exportsSymbol && symbolResult.dependents.length === 0 && chunksByFile.size > 0) {
      const foundInFile = symbolFoundInFileChunks(targetFileChunks, symbol);
      log(
        foundInFile
          ? `Note: "${symbol}" isn't a top-level export of ${filepath} (likely a method or ` +
              `constructor) — symbol-level usage could not be confirmed. Falling back to ` +
              `file-level dependents.`
          : `Note: "${symbol}" doesn't appear anywhere in ${filepath}'s indexed chunks — ` +
              `possibly a typo or a removed symbol. Falling back to file-level dependents.`,
        'warning',
      );
      return {
        ...buildFileLevelDependents(chunksByFile),
        symbolAttributionDegraded: true,
        symbolFoundInFile: foundInFile,
      };
    }

    return symbolResult;
  }

  return buildFileLevelDependents(chunksByFile);
}

/** File-level dependents: every file in `chunksByFile`, regardless of symbol. */
function buildFileLevelDependents(chunksByFile: Map<string, SearchResult[]>): {
  dependents: DependentInfo[];
  totalUsageCount?: number;
} {
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
 * or stop execution on a miss. This is intentional because:
 *
 * 1. The export might be dynamic or conditional (not captured by static analysis)
 * 2. False positives are better than false negatives (we want to show potential matches)
 * 3. The user can see the warning and interpret results accordingly
 *
 * The caller continues to search for usages even when this returns false, which may
 * reveal re-exports, dynamic exports, or help diagnose indexing issues. The boolean
 * return additionally lets `buildDependentsList` distinguish "genuinely zero callers"
 * from "not a top-level export at all" (methods/constructors) — see its doc comment.
 */
function validateSymbolExport(
  targetFileChunks: SearchResult[],
  symbol: string,
  filepath: string,
  log: (message: string, level?: 'warning') => void,
): boolean {
  const exportsSymbol = targetFileChunks.some(chunk => chunk.metadata.exports?.includes(symbol));

  if (!exportsSymbol) {
    log(`Warning: Symbol "${symbol}" not found in exports of ${filepath}`, 'warning');
  }

  return exportsSymbol;
}

/**
 * Whether `symbol` shows up anywhere among the target file's OWN chunks --
 * as a chunk's `symbolName` (methods, constructors, and nested
 * functions/classes each get their own chunk with `symbolName` set to their
 * own name, not just the file-level `exports` list) or inside that chunk's
 * `symbols` bag. `validateSymbolExport` above only answers "is this a
 * top-level export"; this answers the different, narrower question "does
 * this name appear in the file AT ALL" -- used to word
 * `symbolAttributionDegraded`'s caveat honestly instead of always guessing
 * "method or constructor". A hit here means that guess is backed by
 * evidence; no hit means `symbol` may just as easily be a typo, a
 * hallucinated name, or a symbol that used to exist and was removed, and the
 * caveat should say so instead of picking one cause with false confidence.
 */
function symbolFoundInFileChunks(targetFileChunks: SearchResult[], symbol: string): boolean {
  return targetFileChunks.some(chunk => {
    const { symbolName, symbols } = chunk.metadata;
    if (symbolName === symbol) return true;
    if (!symbols) return false;
    return (
      symbols.functions.includes(symbol) ||
      symbols.classes.includes(symbol) ||
      symbols.interfaces.includes(symbol)
    );
  });
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
    // Cast is safe: runtime values are SearchResult objects from VectorDB scan
    const transitiveByFile = groupChunksByFile(transitiveChunks as SearchResult[]);
    mergeChunksByFile(chunksByFile, transitiveByFile);
    log(`Found ${transitiveByFile.size} additional dependents via re-export chains`);
  }
}

/**
 * Get scan results from cache or perform a fresh paginated scan.
 */
async function getOrScanChunks(
  vectorDB: VectorDBInterface,
  log: (message: string, level?: 'warning') => void,
  normalizePathCached: (path: string) => string,
  indexVersion?: number,
): Promise<{
  importIndex: Map<string, SearchResult[]>;
  allChunksByFile: Map<string, SearchResult[]>;
  totalChunks: number;
  hitLimit: boolean;
}> {
  if (indexVersion !== undefined && scanCache !== null && scanCache.indexVersion === indexVersion) {
    log(`Using cached import index (${scanCache.totalChunks} chunks, version ${indexVersion})`);
    return scanCache;
  }

  const scanResult = await scanAllChunks(vectorDB, normalizePathCached);

  if (indexVersion !== undefined) {
    scanCache = { indexVersion, ...scanResult };
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

/**
 * Find all files that depend on a target file, including transitive dependents
 * through re-export chains. Optionally tracks usages of a specific symbol.
 *
 * When `depth > 1`, the walk continues outward (BFS) over the import graph
 * using the same in-memory `importIndex`. Each newly discovered file is
 * tagged with the depth (hops) at which it was first reached. BFS stops when
 * `depth` is reached or `chunksByFile.size >= maxNodes` (sets `truncated`).
 *
 * Symbol-level queries (`symbol` set) always behave as depth=1 — transitive
 * symbol tracking through re-renaming chains is out of scope for this tool.
 */
/**
 * Shared context for a single findDependents call. These values always travel
 * together, so grouping them removes parameter noise from helpers.
 */
interface ScanContext {
  importIndex: Map<string, SearchResult[]>;
  allChunksByFile: Map<string, SearchResult[]>;
  normalizePathCached: (p: string) => string;
  log: (message: string, level?: 'warning') => void;
}

/**
 * Resolve the final dependents list for one `findDependents` call: the
 * import-graph answer (`buildDependentsList`), the C# type-reference
 * recovery attempt (`enrichWithCSharpTypeReferenceDependents`, #930 part 2),
 * and hop stamping/sorting -- grouped here so `findDependents` itself stays
 * a thin orchestration shell rather than inlining all three steps.
 */
function resolveDependents(args: {
  ctx: ScanContext;
  chunksByFile: Map<string, SearchResult[]>;
  hopsByFile: Map<string, number>;
  symbol: string | undefined;
  normalizedTarget: string;
  targetFileChunks: SearchResult[];
  filepath: string;
  reExporterPaths: string[];
  targetIndexed: boolean;
}): {
  dependents: DependentInfo[];
  totalUsageCount?: number;
  symbolAttributionDegraded?: boolean;
  symbolFoundInFile?: boolean;
  dependentAttributionPartial?: true;
} {
  const {
    ctx,
    chunksByFile,
    hopsByFile,
    symbol,
    normalizedTarget,
    targetFileChunks,
    filepath,
    reExporterPaths,
    targetIndexed,
  } = args;

  const { dependents, totalUsageCount, symbolAttributionDegraded, symbolFoundInFile } =
    buildDependentsList(
      chunksByFile,
      symbol,
      normalizedTarget,
      ctx.normalizePathCached,
      targetFileChunks,
      filepath,
      ctx.log,
      reExporterPaths,
    );
  const dependentAttributionPartial = enrichWithCSharpTypeReferenceDependents(
    ctx,
    filepath,
    normalizedTarget,
    symbol,
    targetIndexed,
    dependents,
  );
  stampHopsAndSort(dependents, hopsByFile);

  return {
    dependents,
    totalUsageCount,
    symbolAttributionDegraded,
    symbolFoundInFile,
    dependentAttributionPartial,
  };
}

export async function findDependents(
  vectorDB: VectorDBInterface,
  filepath: string,
  log: (message: string, level?: 'warning') => void,
  symbol?: string,
  indexVersion?: number,
  depth: number = 1,
  maxNodes: number = 500,
  /**
   * Surface the full normalized chunk set on the result.
   * Callers opt in by passing `true` only if they need the chunks
   * (e.g., the annotator for test-association + complexity lookups).
   * Default `false` keeps memory cost down for the common MCP path.
   */
  includeAllChunks: boolean = false,
): Promise<DependencyAnalysisResult> {
  const normalizePathCached = createPathNormalizer();
  const normalizedTarget = normalizePathCached(filepath);

  const { importIndex, allChunksByFile, hitLimit } = await getOrScanChunks(
    vectorDB,
    log,
    normalizePathCached,
    indexVersion,
  );
  const ctx: ScanContext = { importIndex, allChunksByFile, normalizePathCached, log };

  const { targetIndexed, chunksByFile, reExporterPaths } = seedIfTargetIndexed(
    ctx,
    normalizedTarget,
    filepath,
  );

  // Stamp depth-1 files, then BFS outward if requested.
  const hopsByFile = new Map<string, number>();
  for (const file of chunksByFile.keys()) hopsByFile.set(file, 1);
  const { truncated } = runBfsIfRequested({
    ctx,
    chunksByFile,
    hopsByFile,
    normalizedTarget,
    symbol,
    depth,
    maxNodes,
  });

  const targetFileChunks = symbol ? (allChunksByFile.get(normalizedTarget) ?? []) : [];
  const {
    dependents,
    totalUsageCount,
    symbolAttributionDegraded,
    symbolFoundInFile,
    dependentAttributionPartial,
  } = resolveDependents({
    ctx,
    chunksByFile,
    hopsByFile,
    symbol,
    normalizedTarget,
    targetFileChunks,
    filepath,
    reExporterPaths,
    targetIndexed,
  });

  // Complexity metrics must be joined against the *resolved* dependents, not
  // the broader import-graph candidate set (`chunksByFile`) considered before
  // symbol filtering. For file-level queries the two are identical, but for
  // symbol queries `chunksByFile` can contain files that import the target
  // file yet don't use the requested symbol — `buildDependentsList` drops
  // those. Reading complexity from `chunksByFile` directly let an unrelated
  // file's complexity leak into `complexityMetrics`/`riskReasoning` even when
  // `dependents` came back empty.
  const dependentChunksByFile = restrictToDependents(chunksByFile, dependents);
  const fileComplexities = calculateFileComplexities(dependentChunksByFile);
  const complexityMetrics = calculateOverallComplexityMetrics(fileComplexities);

  const testDependentCount = dependents.filter(f => f.isTestFile).length;
  const productionDependentCount = dependents.length - testDependentCount;
  const uncoveredProductionDependents = countUncoveredProductionDependents(dependents, ctx);

  // Surface the full normalized chunk set only when the caller asks for it via
  // the `includeAllChunks` flag. Leaving it `[]` for the common case avoids
  // allocating a flat array of every indexed chunk on each MCP get_dependents
  // call.
  const allChunks = includeAllChunks ? Array.from(allChunksByFile.values()).flat() : [];

  const dependentAttributionIncomplete = checkDependentAttributionIncomplete(
    filepath,
    symbol,
    dependents.length,
    targetIndexed,
    log,
  );

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
    truncated,
    uncoveredProductionDependents,
    symbolAttributionDegraded,
    symbolFoundInFile,
    dependentAttributionIncomplete,
    dependentAttributionPartial,
    targetIndexed,
  };
}

/**
 * #930 (part 2): recover REAL production dependents for a C# file when the
 * import graph found none, by scanning for identifier-boundary references
 * to the target's uniquely-declared type name(s) across the corpus -- see
 * `findCSharpTypeReferenceDependents`'s module doc for the full mechanism
 * and why a type-declaration match (unlike a bare method-name match, #869)
 * doesn't need Swift's extra type-shaped-driver gate.
 *
 * Deliberately narrower than the import-graph seed it supplements:
 * - File-level only (`symbol` unset) -- there's no principled way to scope
 *   a text match to one exported member.
 * - Only attempted when the import graph found LITERALLY ZERO dependents --
 *   avoids a corpus-wide content scan on every C# `get_dependents` call,
 *   mirroring `checkDependentAttributionIncomplete`'s existing threshold.
 *   A future PR could widen this to also run when the import graph found
 *   *some* dependents (a mixed old/new-style C# project), but that's out of
 *   scope here.
 * - Only for `hasEnclosingNamespaceAccess` languages (currently C# only).
 *
 * Recovered entries are tagged `confidence: 'inferred'` (see
 * `DependentInfo`) and deliberately NOT joined against `chunksByFile` for
 * complexity-metrics purposes -- unlike a real import edge, there's no
 * associated import-graph chunk set to attribute complexity to, so these
 * dependents contribute to `dependentCount`/`productionDependentCount`/
 * `riskLevel` but not to `complexityMetrics`. `uncoveredProductionDependents`
 * still runs its own genuine import-based "is there a test importer of
 * THIS dependent" check against each recovered file, so that count stays
 * meaningful.
 *
 * Mutates `dependents` in place (pushes new entries); returns `true` when
 * anything was recovered (for `dependentAttributionPartial`) or `undefined`
 * otherwise -- matching this file's existing convention for optional
 * boolean flags (e.g. `symbolAttributionDegraded`,
 * `dependentAttributionIncomplete`), which are only ever `true` or absent,
 * never an explicit `false`.
 */
function enrichWithCSharpTypeReferenceDependents(
  ctx: ScanContext,
  filepath: string,
  normalizedTarget: string,
  symbol: string | undefined,
  targetIndexed: boolean,
  dependents: DependentInfo[],
): true | undefined {
  if (symbol || dependents.length !== 0 || !targetIndexed) return undefined;

  const targetLanguage = detectLanguage(filepath);
  if (targetLanguage === null || !hasEnclosingNamespaceAccess(targetLanguage)) return undefined;

  const targetChunks = ctx.allChunksByFile.get(normalizedTarget) ?? [];
  const targetRawFile = targetChunks[0]?.metadata.file;
  if (!targetRawFile) return undefined;

  const allChunks = Array.from(ctx.allChunksByFile.values()).flat();
  const inferredFiles = findCSharpTypeReferenceDependents(targetRawFile, allChunks);
  if (inferredFiles.length === 0) return undefined;

  const workspaceRoot = process.cwd().replace(/\\/g, '/');
  for (const rawFile of inferredFiles) {
    const canonicalFile = getCanonicalPath(rawFile, workspaceRoot);
    dependents.push({
      filepath: canonicalFile,
      isTestFile: isTestFile(canonicalFile),
      confidence: 'inferred',
    });
  }

  ctx.log(
    `Recovered ${inferredFiles.length} dependent(s) for ${filepath} via C# type-reference ` +
      `matching (inferred from a uniquely-declared type name, not import-verified — #930)`,
  );
  return true;
}

/**
 * True for a file-level query (no `symbol` -- that case has its own
 * `symbolAttributionDegraded` handling above) that found zero dependents in
 * a language where the import graph structurally cannot see every real
 * usage, EVEN AFTER `enrichWithCSharpTypeReferenceDependents` above already
 * had a chance to recover some (see
 * `DependencyAnalysisResult.dependentAttributionIncomplete`'s doc comment).
 * Logs a warning when it fires, matching the logging `buildDependentsList`
 * already does for its own degradation case.
 *
 * Skipped when `targetIndexed` is false (#928): an unresolved target's zero
 * dependents already carries its own, more fundamental "unresolved" signal
 * (see `seedIfTargetIndexed`) -- layering the C#-specific reasoning on top
 * would produce two notes competing to explain the same zero, one of them
 * describing a language nuance that's moot when the file was never found
 * in the index at all.
 */
function checkDependentAttributionIncomplete(
  filepath: string,
  symbol: string | undefined,
  dependentCount: number,
  targetIndexed: boolean,
  log: (message: string, level?: 'warning') => void,
): true | undefined {
  if (symbol || dependentCount !== 0 || !targetIndexed) return undefined;

  const targetLanguage = detectLanguage(filepath);
  if (targetLanguage === null || !hasEnclosingNamespaceAccess(targetLanguage)) return undefined;

  log(
    `No import-based dependents found for ${filepath} -- ${targetLanguage} has enclosing-` +
      `namespace access, so this scan has no signal for a real caller that reaches it ` +
      `without a per-file import (#930)`,
    'warning',
  );
  return true;
}

/**
 * #928: only run the fuzzy dependent search against a target that's actually
 * indexed. `allChunksByFile` is keyed by the same `normalizePathCached` used
 * for `normalizedTarget`, so this check is free (no extra I/O) and precise
 * for "does the index have any chunks for this file at all". Skipping the
 * fuzzy search entirely for an unresolvable target — rather than letting it
 * run and possibly latch onto an unrelated real file's import graph through
 * textual coincidence — trades a possible false negative (a real but oddly-
 * shaped match we don't find) for a guaranteed non-fabrication: an
 * unresolvable target always comes back with zero dependents, never someone
 * else's.
 */
function seedIfTargetIndexed(
  ctx: ScanContext,
  normalizedTarget: string,
  filepath: string,
): {
  targetIndexed: boolean;
  chunksByFile: Map<string, SearchResult[]>;
  reExporterPaths: string[];
} {
  const targetIndexed = ctx.allChunksByFile.has(normalizedTarget);
  if (!targetIndexed) {
    ctx.log(
      `Target not found in index: ${filepath} — returning zero dependents rather than a fuzzy-matched guess`,
      'warning',
    );
    return { targetIndexed, chunksByFile: new Map(), reExporterPaths: [] };
  }
  const { chunksByFile, reExporterPaths } = seedDepth1Dependents(ctx, normalizedTarget);
  return { targetIndexed, chunksByFile, reExporterPaths };
}

/** Depth-1 seed: direct importers plus barrel re-exporters. */
function seedDepth1Dependents(
  ctx: ScanContext,
  normalizedTarget: string,
): { chunksByFile: Map<string, SearchResult[]>; reExporterPaths: string[] } {
  const { importIndex, allChunksByFile, normalizePathCached, log } = ctx;
  const dependentChunks = findDependentChunks(importIndex, normalizedTarget);
  const chunksByFile = groupChunksByFile(dependentChunks);
  const reExporters = resolveTransitiveDependents(
    allChunksByFile,
    normalizedTarget,
    normalizePathCached,
    importIndex,
    chunksByFile,
    log,
  );
  return { chunksByFile, reExporterPaths: reExporters.map(re => re.filepath) };
}

/**
 * Apply the symbol-vs-depth policy and run BFS if applicable. Symbol queries
 * stay at depth 1 — transitive symbol-renaming chains are out of scope.
 */
function runBfsIfRequested(args: {
  ctx: ScanContext;
  chunksByFile: Map<string, SearchResult[]>;
  hopsByFile: Map<string, number>;
  normalizedTarget: string;
  symbol: string | undefined;
  depth: number;
  maxNodes: number;
}): { truncated: boolean } {
  const { ctx, chunksByFile, hopsByFile, normalizedTarget, symbol, depth, maxNodes } = args;
  if (symbol && depth > 1) {
    ctx.log(`Note: depth > 1 is ignored for symbol-level queries (symbol=${symbol})`);
    return { truncated: false };
  }
  return expandBfsDependents(ctx, chunksByFile, hopsByFile, normalizedTarget, depth, maxNodes);
}

/** Fill in `hops` on each dependent and sort shallower-first, prod-before-test. */
function stampHopsAndSort(dependents: DependentInfo[], hopsByFile: Map<string, number>): void {
  for (const d of dependents) {
    d.hops = hopsByFile.get(d.filepath) ?? 1;
  }
  dependents.sort((a, b) => {
    const hopDelta = (a.hops ?? 1) - (b.hops ?? 1);
    if (hopDelta !== 0) return hopDelta;
    if (a.isTestFile === b.isTestFile) return 0;
    return a.isTestFile ? 1 : -1;
  });
}

/**
 * BFS outward from depth-1 frontier. Mutates `chunksByFile` and `hopsByFile`
 * with newly discovered files. `truncated` means the walk was cut short by
 * `maxNodes`; it stays false when no BFS runs.
 */
function expandBfsDependents(
  ctx: ScanContext,
  chunksByFile: Map<string, SearchResult[]>,
  hopsByFile: Map<string, number>,
  normalizedTarget: string,
  depth: number,
  maxNodes: number,
): { truncated: boolean } {
  if (depth <= 1) return { truncated: false };

  let truncated = false;
  let frontier: Set<string> = new Set(chunksByFile.keys());

  for (let level = 2; level <= depth && !truncated && frontier.size > 0; level++) {
    frontier = advanceOneHop({
      ctx,
      chunksByFile,
      hopsByFile,
      normalizedTarget,
      frontier,
      level,
      maxNodes,
      onTruncated: () => {
        truncated = true;
      },
    });
  }

  if (truncated) ctx.log(`BFS stopped at maxNodes=${maxNodes} (dependents truncated)`);
  return { truncated };
}

/**
 * Advance the BFS by one level: for every file in `frontier`, find its
 * dependents and merge any newly-discovered files into `chunksByFile` /
 * `hopsByFile`. Returns the next frontier.
 */
function advanceOneHop(args: {
  ctx: ScanContext;
  chunksByFile: Map<string, SearchResult[]>;
  hopsByFile: Map<string, number>;
  normalizedTarget: string;
  frontier: Set<string>;
  level: number;
  maxNodes: number;
  onTruncated: () => void;
}): Set<string> {
  const {
    ctx,
    chunksByFile,
    hopsByFile,
    normalizedTarget,
    frontier,
    level,
    maxNodes,
    onTruncated,
  } = args;
  const next = new Set<string>();

  for (const frontierFile of frontier) {
    if (chunksByFile.size >= maxNodes) {
      onTruncated();
      return next;
    }
    const normalizedFrontier = ctx.normalizePathCached(frontierFile);
    if (normalizedFrontier === normalizedTarget) continue;

    const discovered = discoverFrontierDependents(ctx, normalizedFrontier);
    const stoppedEarly = mergeDiscovered({
      discovered,
      chunksByFile,
      hopsByFile,
      normalizedTarget,
      normalizedFrontier,
      normalizePathCached: ctx.normalizePathCached,
      level,
      maxNodes,
      next,
    });
    if (stoppedEarly) {
      onTruncated();
      return next;
    }
  }
  return next;
}

/**
 * Direct importers of `normalizedFrontier` plus its barrel re-exporters,
 * grouped by file. No new scan — reuses `importIndex` / `allChunksByFile`.
 */
function discoverFrontierDependents(
  ctx: ScanContext,
  normalizedFrontier: string,
): Map<string, SearchResult[]> {
  const dependentChunks = findDependentChunks(ctx.importIndex, normalizedFrontier);
  if (dependentChunks.length === 0) return new Map();
  const grouped = groupChunksByFile(dependentChunks);
  resolveTransitiveDependents(
    ctx.allChunksByFile,
    normalizedFrontier,
    ctx.normalizePathCached,
    ctx.importIndex,
    grouped,
    ctx.log,
  );
  return grouped;
}

/**
 * Merge discovered files into `chunksByFile` / `hopsByFile` / `next`,
 * skipping the target, the current frontier file, and already-seen files.
 * Returns true if the merge hit the maxNodes cap and stopped early.
 */
function mergeDiscovered(args: {
  discovered: Map<string, SearchResult[]>;
  chunksByFile: Map<string, SearchResult[]>;
  hopsByFile: Map<string, number>;
  normalizedTarget: string;
  normalizedFrontier: string;
  normalizePathCached: (p: string) => string;
  level: number;
  maxNodes: number;
  next: Set<string>;
}): boolean {
  const {
    discovered,
    chunksByFile,
    hopsByFile,
    normalizedTarget,
    normalizedFrontier,
    normalizePathCached,
    level,
    maxNodes,
    next,
  } = args;

  for (const [file, chunks] of discovered.entries()) {
    // `file` uses getCanonicalPath; target/frontier use normalizePath — normalize both.
    const normalizedFile = normalizePathCached(file);
    if (normalizedFile === normalizedTarget) continue;
    if (normalizedFile === normalizedFrontier) continue;
    if (chunksByFile.has(file)) continue;
    if (chunksByFile.size >= maxNodes) return true;
    chunksByFile.set(file, chunks);
    hopsByFile.set(file, level);
    next.add(file);
  }
  return false;
}

/**
 * For each production dependent, check whether any test file imports it.
 * Reuses the existing `importIndex` — no fresh scan.
 */
function countUncoveredProductionDependents(dependents: DependentInfo[], ctx: ScanContext): number {
  let uncovered = 0;
  for (const d of dependents) {
    if (d.isTestFile) continue;
    if (!hasTestImporter(d.filepath, ctx)) uncovered += 1;
  }
  return uncovered;
}

function hasTestImporter(filepath: string, ctx: ScanContext): boolean {
  const importers = findDependentChunks(ctx.importIndex, ctx.normalizePathCached(filepath));
  for (const chunk of importers) {
    if (isTestFile(chunk.metadata.file)) return true;
  }
  return false;
}

/**
 * Add the chunks keyed by `normalizedImport` to the dependent set via
 * `addChunk`, applying the #887 per-chunk language check when the match is
 * ambiguous.
 *
 * A multi-segment specifier that matches `normalizedTarget` ONLY through the
 * permissive (package-directory) path -- not the strict (single-file) path
 * -- is #887's ambiguous shape: a Go-shaped importer legitimately means it
 * (every file in the package directory is a member); a Ruby-shaped importer
 * doesn't (a sibling file under the same directory is a separate, unrelated
 * module). `matchesFile` can't disambiguate that without both a target and
 * an importer's language in scope at once, and this function's `chunks`
 * bucket can span multiple importer files (and in principle languages)
 * sharing the same normalized import key, so the language check runs per
 * chunk rather than once per key -- see `hasSingleFileImportSemantics`'s doc
 * comment. `importMatchesTarget` (used by every match-side call site that
 * *does* have a single importer file) makes the same derivation once,
 * up front.
 */
function addFuzzyMatchChunks(
  normalizedImport: string,
  normalizedTarget: string,
  chunks: SearchResult[],
  addChunk: (chunk: SearchResult) => void,
): void {
  if (!matchesFile(normalizedImport, normalizedTarget)) return;

  const ambiguous =
    normalizedImport.includes('/') && !matchesFile(normalizedImport, normalizedTarget, true);

  for (const chunk of chunks) {
    if (ambiguous && hasSingleFileImportSemantics(chunk.metadata.file)) continue;
    addChunk(chunk);
  }
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
    if (normalizedImport !== normalizedTarget) {
      addFuzzyMatchChunks(normalizedImport, normalizedTarget, chunks, addChunk);
    }
  }

  return dependentChunks;
}

/**
 * Restrict a file-level chunk map down to exactly the resolved dependent
 * filepaths. Used to join complexity metrics against `dependents` rather
 * than the wider pre-symbol-filter candidate set (see `findDependents`).
 */
function restrictToDependents(
  chunksByFile: Map<string, SearchResult[]>,
  dependents: DependentInfo[],
): Map<string, SearchResult[]> {
  const dependentPaths = new Set(dependents.map(d => d.filepath));
  const restricted = new Map<string, SearchResult[]>();
  for (const [filepath, chunks] of chunksByFile.entries()) {
    if (dependentPaths.has(filepath)) {
      restricted.set(filepath, chunks);
    }
  }
  return restricted;
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
