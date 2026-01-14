import { SearchResult } from './types.js';
import { EMBEDDING_DIMENSION } from '../embeddings/types.js';
import { DatabaseError, wrapError } from '../errors/index.js';
import { calculateRelevance } from './relevance.js';
import { classifyQueryIntent, QueryIntent } from './intent-classifier.js';
import { BoostingComposer, PathBoostingStrategy, FilenameBoostingStrategy, FileTypeBoostingStrategy } from './boosting/index.js';

// TODO: Replace with proper type from lancedb-types.ts
// Currently using 'any' because tests use incomplete mocks that don't satisfy full LanceDB interface
// See: https://github.com/getlien/lien/issues/XXX
type LanceDBTable = any;

/**
 * Cached strategy instances to avoid repeated instantiation overhead.
 * These strategies are stateless and can be safely reused across queries.
 */
const PATH_STRATEGY = new PathBoostingStrategy();
const FILENAME_STRATEGY = new FilenameBoostingStrategy();

/**
 * Cached FileTypeBoostingStrategy instances for each intent.
 * Since there are only three possible intents, we can cache all three.
 */
const FILE_TYPE_STRATEGIES = {
  [QueryIntent.LOCATION]: new FileTypeBoostingStrategy(QueryIntent.LOCATION),
  [QueryIntent.CONCEPTUAL]: new FileTypeBoostingStrategy(QueryIntent.CONCEPTUAL),
  [QueryIntent.IMPLEMENTATION]: new FileTypeBoostingStrategy(QueryIntent.IMPLEMENTATION),
};

/**
 * Cached BoostingComposer instances for each intent.
 * Pre-configured with the appropriate strategy pipeline for each intent type.
 * This avoids creating a new composer instance on every search result.
 */
const BOOSTING_COMPOSERS = {
  [QueryIntent.LOCATION]: new BoostingComposer()
    .addStrategy(PATH_STRATEGY)
    .addStrategy(FILENAME_STRATEGY)
    .addStrategy(FILE_TYPE_STRATEGIES[QueryIntent.LOCATION]),
  [QueryIntent.CONCEPTUAL]: new BoostingComposer()
    .addStrategy(PATH_STRATEGY)
    .addStrategy(FILENAME_STRATEGY)
    .addStrategy(FILE_TYPE_STRATEGIES[QueryIntent.CONCEPTUAL]),
  [QueryIntent.IMPLEMENTATION]: new BoostingComposer()
    .addStrategy(PATH_STRATEGY)
    .addStrategy(FILENAME_STRATEGY)
    .addStrategy(FILE_TYPE_STRATEGIES[QueryIntent.IMPLEMENTATION]),
};

/**
 * Database record structure as stored in LanceDB
 */
interface DBRecord {
  vector: number[];
  content: string;
  file: string;
  startLine: number;
  endLine: number;
  type: string;
  language: string;
  functionNames: string[];
  classNames: string[];
  interfaceNames: string[];
  // AST-derived metadata (v0.13.0)
  symbolName?: string;
  symbolType?: string;
  parentClass?: string;
  complexity?: number;
  cognitiveComplexity?: number;
  parameters?: string[];
  signature?: string;
  imports?: string[];
  // Halstead metrics (v0.19.0)
  halsteadVolume?: number;
  halsteadDifficulty?: number;
  halsteadEffort?: number;
  halsteadBugs?: number;
  // Symbol-level dependency tracking (v0.23.0)
  exports?: string[];
  importedSymbolPaths?: string[];
  importedSymbolNames?: string[];
  callSiteSymbols?: string[];
  callSiteLines?: number[];
  _distance?: number; // Added by LanceDB for search results
}

/**
 * Check if a DB record has valid content and file path.
 * Used to filter out empty/invalid records from query results.
 */
function isValidRecord(r: DBRecord): boolean {
  return Boolean(
    r.content && 
    r.content.trim().length > 0 &&
    r.file && 
    r.file.length > 0
  );
}

/**
 * Check if a string array field has valid (non-empty) entries.
 * LanceDB stores empty arrays as [''] which we need to filter out.
 */
function hasValidStringEntries(arr: string[] | undefined): boolean {
  return Boolean(arr && arr.length > 0 && arr[0] !== '');
}

/**
 * Check if a number array field has valid (non-zero) entries.
 * LanceDB stores empty arrays as [0] which we need to filter out.
 */
function hasValidNumberEntries(arr: number[] | undefined): boolean {
  return Boolean(arr && arr.length > 0 && arr[0] !== 0);
}

/**
 * Get symbols for a specific type from a DB record.
 * Consolidates the symbol extraction logic used across query functions.
 */
function getSymbolsForType(
  r: DBRecord, 
  symbolType?: 'function' | 'class' | 'interface'
): string[] {
  if (symbolType === 'function') return r.functionNames || [];
  if (symbolType === 'class') return r.classNames || [];
  if (symbolType === 'interface') return r.interfaceNames || [];
  return [
    ...(r.functionNames || []),
    ...(r.classNames || []),
    ...(r.interfaceNames || []),
  ];
}

/**
 * Convert Arrow Vector to plain array if needed.
 * LanceDB returns Arrow Vector objects for array columns.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPlainArray<T>(arr: any): T[] | undefined {
  if (!arr) return undefined;
  // Arrow Vectors have a toArray() method
  if (typeof arr.toArray === 'function') {
    return arr.toArray();
  }
  // Already a plain array
  if (Array.isArray(arr)) {
    return arr;
  }
  return undefined;
}

/**
 * Deserialize importedSymbols from parallel arrays stored in DB.
 */
function deserializeImportedSymbols(
  paths?: unknown,
  names?: unknown
): Record<string, string[]> | undefined {
  const pathsArr = toPlainArray<string>(paths);
  const namesArr = toPlainArray<string>(names);
  
  if (!pathsArr || !namesArr || !hasValidStringEntries(pathsArr) || !hasValidStringEntries(namesArr)) {
    return undefined;
  }
  // Warn if arrays are mismatched (could indicate data corruption)
  if (pathsArr.length !== namesArr.length) {
    const missingCount = Math.abs(pathsArr.length - namesArr.length);
    console.warn(
      `deserializeImportedSymbols: array length mismatch (paths: ${pathsArr.length}, names: ${namesArr.length}). ` +
      `Proceeding with ${Math.min(pathsArr.length, namesArr.length)} entries; ${missingCount} entr${missingCount === 1 ? 'y' : 'ies'} will be skipped.`
    );
  }
  const result: Record<string, string[]> = {};
  for (let i = 0; i < pathsArr.length && i < namesArr.length; i++) {
    const path = pathsArr[i];
    const namesJson = namesArr[i];
    if (path && namesJson) {
      try {
        result[path] = JSON.parse(namesJson);
      } catch (err) {
        console.warn(`deserializeImportedSymbols: failed to parse JSON for path "${path}". Skipping entry.`, err);
      }
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Deserialize callSites from parallel arrays stored in DB.
 */
function deserializeCallSites(
  symbols?: unknown,
  lines?: unknown
): Array<{ symbol: string; line: number }> | undefined {
  const symbolsArr = toPlainArray<string>(symbols);
  const linesArr = toPlainArray<number>(lines);
  
  if (!symbolsArr || !linesArr || !hasValidStringEntries(symbolsArr) || !hasValidNumberEntries(linesArr)) {
    return undefined;
  }
  // Warn if arrays are mismatched (could indicate data corruption)
  if (symbolsArr.length !== linesArr.length) {
    const missingCount = Math.abs(symbolsArr.length - linesArr.length);
    console.warn(
      `deserializeCallSites: array length mismatch (symbols: ${symbolsArr.length}, lines: ${linesArr.length}). ` +
      `Proceeding with ${Math.min(symbolsArr.length, linesArr.length)} entries; ${missingCount} entr${missingCount === 1 ? 'y' : 'ies'} will be skipped.`
    );
  }
  const result: Array<{ symbol: string; line: number }> = [];
  for (let i = 0; i < symbolsArr.length && i < linesArr.length; i++) {
    const symbol = symbolsArr[i];
    const line = linesArr[i];
    // Note: line > 0 is intentional - we use 0 as a placeholder value for missing data
    // in serializeCallSites(). Real line numbers are 1-indexed in source files.
    if (symbol && typeof line === 'number' && line > 0) {
      result.push({ symbol, line });
    }
  }
  return result.length > 0 ? result : undefined;
}

function buildSearchResultMetadata(r: DBRecord): SearchResult['metadata'] {
  return {
    file: r.file,
    startLine: r.startLine,
    endLine: r.endLine,
    type: r.type as 'function' | 'class' | 'block',
    language: r.language,
    symbolName: r.symbolName || undefined,
    symbolType: r.symbolType as 'function' | 'method' | 'class' | 'interface' | undefined,
    parentClass: r.parentClass || undefined,
    complexity: r.complexity || undefined,
    cognitiveComplexity: r.cognitiveComplexity || undefined,
    parameters: hasValidStringEntries(r.parameters) ? r.parameters : undefined,
    signature: r.signature || undefined,
    imports: hasValidStringEntries(r.imports) ? r.imports : undefined,
    // Halstead metrics (v0.19.0) - use explicit null check to preserve valid 0 values
    halsteadVolume: r.halsteadVolume != null ? r.halsteadVolume : undefined,
    halsteadDifficulty: r.halsteadDifficulty != null ? r.halsteadDifficulty : undefined,
    halsteadEffort: r.halsteadEffort != null ? r.halsteadEffort : undefined,
    halsteadBugs: r.halsteadBugs != null ? r.halsteadBugs : undefined,
    // Symbol-level dependency tracking (v0.23.0)
    exports: (() => {
      const arr = toPlainArray<string>(r.exports);
      return hasValidStringEntries(arr) ? arr : undefined;
    })(),
    importedSymbols: deserializeImportedSymbols(r.importedSymbolPaths, r.importedSymbolNames),
    callSites: deserializeCallSites(r.callSiteSymbols, r.callSiteLines),
  };
}

/**
 * Apply relevance boosting strategies to a search score.
 * 
 * Uses composable boosting strategies based on query intent:
 * - Path matching: Boost files with query tokens in path
 * - Filename matching: Boost files with query tokens in filename
 * - File type boosting: Intent-specific boosting (docs for conceptual, etc.)
 */
function applyRelevanceBoosting(
  query: string | undefined,
  filepath: string,
  baseScore: number
): number {
  if (!query) {
    return baseScore;
  }
  
  const intent = classifyQueryIntent(query);
  
  // Use cached composer instance configured for this intent
  return BOOSTING_COMPOSERS[intent].apply(query, filepath, baseScore);
}

/**
 * Convert a DBRecord to a SearchResult
 */
function dbRecordToSearchResult(
  r: DBRecord,
  query?: string
): SearchResult {
  const baseScore = r._distance ?? 0;
  const boostedScore = applyRelevanceBoosting(query, r.file, baseScore);
  
  return {
    content: r.content,
    metadata: buildSearchResultMetadata(r),
    score: boostedScore,
    relevance: calculateRelevance(boostedScore),
  };
}

/**
 * Search the vector database
 */
export async function search(
  table: LanceDBTable,
  queryVector: Float32Array,
  limit: number = 5,
  query?: string
): Promise<SearchResult[]> {
  if (!table) {
    throw new DatabaseError('Vector database not initialized');
  }
  
  try {
    const results = await table
      .search(Array.from(queryVector))
      .limit(limit + 20)
      .toArray();
    
    const filtered = (results as unknown as DBRecord[])
      .filter(isValidRecord)
      .map((r: DBRecord) => dbRecordToSearchResult(r, query))
      .sort((a, b) => a.score - b.score)
      .slice(0, limit);
    
    return filtered;
  } catch (error) {
    const errorMsg = String(error);
    
    // Detect corrupted index
    if (errorMsg.includes('Not found:') || errorMsg.includes('.lance')) {
      throw new DatabaseError(
        `Index appears corrupted or outdated. Please restart the MCP server or run 'lien reindex' in the project directory.`,
        { originalError: error }
      );
    }
    
    throw wrapError(error, 'Failed to search vector database');
  }
}

/**
 * Scan the database with filters.
 * Scans all records to ensure complete coverage.
 */
export async function scanWithFilter(
  table: LanceDBTable,
  options: {
    language?: string;
    pattern?: string;
    limit?: number;
  }
): Promise<SearchResult[]> {
  if (!table) {
    throw new DatabaseError('Vector database not initialized');
  }

  const { language, pattern, limit = 100 } = options;

  try {
    // Get total row count to ensure we scan all records
    const totalRows = await table.countRows();

    const zeroVector = Array(EMBEDDING_DIMENSION).fill(0);
    const query = table.search(zeroVector)
      .where('file != ""')
      .limit(Math.max(totalRows, 1000));

    const results = await query.toArray();

    let filtered = (results as unknown as DBRecord[]).filter(isValidRecord);

    if (language) {
      filtered = filtered.filter((r: DBRecord) =>
        r.language && r.language.toLowerCase() === language.toLowerCase()
      );
    }

    if (pattern) {
      const regex = new RegExp(pattern, 'i');
      filtered = filtered.filter((r: DBRecord) =>
        regex.test(r.content) || regex.test(r.file)
      );
    }

    return filtered.slice(0, limit).map((r: DBRecord) => ({
      content: r.content,
      metadata: buildSearchResultMetadata(r),
      score: 0,
      relevance: calculateRelevance(0),
    }));
  } catch (error) {
    throw wrapError(error, 'Failed to scan with filter');
  }
}

/**
 * Helper to check if a record matches the requested symbol type
 */
/** Maps query symbolType to acceptable AST symbolType values */
const SYMBOL_TYPE_MATCHES: Record<string, Set<string>> = {
  function: new Set(['function', 'method']),
  class: new Set(['class']),
  interface: new Set(['interface']),
};

function matchesSymbolType(
  record: DBRecord,
  symbolType: 'function' | 'class' | 'interface',
  symbols: string[]
): boolean {
  // If AST-based symbolType exists, use lookup table
  if (record.symbolType) {
    return SYMBOL_TYPE_MATCHES[symbolType]?.has(record.symbolType) ?? false;
  }

  // Fallback: check if pre-AST symbols array has valid entries
  return symbols.length > 0 && symbols.some((s: string) => s.length > 0 && s !== '');
}

interface SymbolQueryOptions {
  language?: string;
  pattern?: string;
  symbolType?: 'function' | 'class' | 'interface';
}

/**
 * Check if a record matches the symbol query filters.
 * Extracted to reduce complexity of querySymbols.
 */
function matchesSymbolFilter(
  r: DBRecord, 
  { language, pattern, symbolType }: SymbolQueryOptions
): boolean {
  // Language filter
  if (language && (!r.language || r.language.toLowerCase() !== language.toLowerCase())) {
    return false;
  }
  
  const symbols = getSymbolsForType(r, symbolType);
  const astSymbolName = r.symbolName || '';
  
  // Must have at least one symbol (legacy or AST-based)
  if (symbols.length === 0 && !astSymbolName) {
    return false;
  }
  
  // Pattern filter (if provided)
  if (pattern) {
    const regex = new RegExp(pattern, 'i');
    const nameMatches = symbols.some((s: string) => regex.test(s)) || regex.test(astSymbolName);
    if (!nameMatches) return false;
  }
  
  // Symbol type filter (if provided)
  if (symbolType) {
    return matchesSymbolType(r, symbolType, symbols);
  }
  
  return true;
}

/**
 * Build legacy symbols object for backwards compatibility.
 */
function buildLegacySymbols(r: DBRecord) {
  return {
    functions: hasValidStringEntries(r.functionNames) ? r.functionNames : [],
    classes: hasValidStringEntries(r.classNames) ? r.classNames : [],
    interfaces: hasValidStringEntries(r.interfaceNames) ? r.interfaceNames : [],
  };
}

/**
 * Query symbols (functions, classes, interfaces)
 * Scans all records in the database to find matching symbols.
 */
export async function querySymbols(
  table: LanceDBTable,
  options: {
    language?: string;
    pattern?: string;
    symbolType?: 'function' | 'class' | 'interface';
    limit?: number;
  }
): Promise<SearchResult[]> {
  if (!table) {
    throw new DatabaseError('Vector database not initialized');
  }

  const { language, pattern, symbolType, limit = 50 } = options;
  const filterOpts: SymbolQueryOptions = { language, pattern, symbolType };

  try {
    // Get total row count to ensure we scan all records
    const totalRows = await table.countRows();

    // Use zero-vector search with limit >= totalRows to get all records
    // This is the recommended approach for LanceDB full scans
    const zeroVector = Array(EMBEDDING_DIMENSION).fill(0);
    const query = table.search(zeroVector)
      .where('file != ""')
      .limit(Math.max(totalRows, 1000));

    const results = await query.toArray();

    const filtered = (results as unknown as DBRecord[])
      .filter((r) => isValidRecord(r) && matchesSymbolFilter(r, filterOpts));

    return filtered.slice(0, limit).map((r: DBRecord) => ({
      content: r.content,
      metadata: {
        ...buildSearchResultMetadata(r),
        symbols: buildLegacySymbols(r),
      },
      score: 0,
      relevance: calculateRelevance(0),
    }));
  } catch (error) {
    throw wrapError(error, 'Failed to query symbols');
  }
}

/**
 * Scan all chunks in the database.
 * Returns all records matching the optional filters.
 */
export async function scanAll(
  table: LanceDBTable,
  options: {
    language?: string;
    pattern?: string;
  } = {}
): Promise<SearchResult[]> {
  if (!table) {
    throw new DatabaseError('Vector database not initialized');
  }

  try {
    // Get total row count to use as the output limit
    const totalRows = await table.countRows();

    // scanWithFilter now handles the full scan internally
    return await scanWithFilter(table, {
      ...options,
      limit: Math.max(totalRows, 1000),
    });
  } catch (error) {
    throw wrapError(error, 'Failed to scan all chunks');
  }
}
