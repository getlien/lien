import type { SearchResult } from './types.js';
import { SYMBOL_TYPE_MATCHES } from './types.js';
import { EMBEDDING_DIMENSION } from '../embeddings/types.js';
import { MAX_CHUNKS_PER_FILE } from '../constants.js';
import { DatabaseError, wrapError } from '../errors/index.js';
import { calculateRelevance } from './relevance.js';
import { classifyQueryIntent, QueryIntent } from './intent-classifier.js';
import {
  BoostingComposer,
  PathBoostingStrategy,
  FilenameBoostingStrategy,
  FileTypeBoostingStrategy,
} from './boosting/index.js';

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
  return Boolean(r.content && r.content.trim().length > 0 && r.file && r.file.length > 0);
}

/**
 * Check if a string array has valid (non-empty) entries.
 * LanceDB stores empty string arrays as [''] which we need to filter out.
 * This is specifically for string arrays (cf. hasValidNumberEntries for number arrays).
 */
function hasValidStringEntries(arr: string[] | undefined): boolean {
  return Boolean(arr && arr.length > 0 && arr[0] !== '');
}

/**
 * Check if a number array has valid entries (filters out placeholder values).
 *
 * serializeCallSites() uses 0 as a sentinel meaning "no valid line number"
 * (not actual missing data - the array is never truly empty, it contains [0]).
 * This function checks if the array contains real line numbers (> 0).
 *
 * Note: Real line numbers are 1-indexed in source files, so 0 is safe as a placeholder.
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
  symbolType?: 'function' | 'method' | 'class' | 'interface',
): string[] {
  if (symbolType === 'function' || symbolType === 'method')
    return toPlainArray<string>(r.functionNames) || [];
  if (symbolType === 'class') return toPlainArray<string>(r.classNames) || [];
  if (symbolType === 'interface') return toPlainArray<string>(r.interfaceNames) || [];
  return [
    ...(toPlainArray<string>(r.functionNames) || []),
    ...(toPlainArray<string>(r.classNames) || []),
    ...(toPlainArray<string>(r.interfaceNames) || []),
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
 *
 * @param paths - Array of import paths (keys from importedSymbols map)
 * @param names - Array of JSON-encoded symbol arrays (values from importedSymbols map)
 * @returns Record mapping import paths to symbol arrays, or undefined if no valid data
 */
function deserializeImportedSymbols(
  paths?: unknown,
  names?: unknown,
): Record<string, string[]> | undefined {
  const pathsArr = toPlainArray<string>(paths);
  const namesArr = toPlainArray<string>(names);

  if (
    !pathsArr ||
    !namesArr ||
    !hasValidStringEntries(pathsArr) ||
    !hasValidStringEntries(namesArr)
  ) {
    return undefined;
  }

  // Treat mismatched arrays as a hard error (indicates data corruption during serialization)
  if (pathsArr.length !== namesArr.length) {
    throw new DatabaseError(
      `deserializeImportedSymbols: array length mismatch (paths: ${pathsArr.length}, names: ${namesArr.length}). ` +
        `This indicates data corruption. Refusing to deserialize to avoid silent data loss.`,
    );
  }
  const result: Record<string, string[]> = {};
  for (let i = 0; i < pathsArr.length; i++) {
    const path = pathsArr[i];
    const namesJson = namesArr[i];
    if (path && namesJson) {
      try {
        result[path] = JSON.parse(namesJson);
      } catch (err) {
        console.warn(
          `deserializeImportedSymbols: failed to parse JSON for path "${path}". Skipping entry.`,
          err,
        );
      }
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Deserialize callSites from parallel arrays stored in DB.
 *
 * @param symbols - Array of symbol names called at each site
 * @param lines - Array of line numbers for each call site (parallel to symbols)
 * @returns Array of call site objects with symbol and line, or undefined if no valid data
 */
function deserializeCallSites(
  symbols?: unknown,
  lines?: unknown,
): Array<{ symbol: string; line: number }> | undefined {
  const symbolsArr = toPlainArray<string>(symbols);
  const linesArr = toPlainArray<number>(lines);

  if (
    !symbolsArr ||
    !linesArr ||
    !hasValidStringEntries(symbolsArr) ||
    !hasValidNumberEntries(linesArr)
  ) {
    return undefined;
  }

  // Treat mismatched arrays as a hard error (indicates data corruption during serialization)
  if (symbolsArr.length !== linesArr.length) {
    throw new DatabaseError(
      `deserializeCallSites: array length mismatch (symbols: ${symbolsArr.length}, lines: ${linesArr.length}). ` +
        `This indicates data corruption. Refusing to deserialize to avoid silent data loss.`,
    );
  }
  const result: Array<{ symbol: string; line: number }> = [];
  for (let i = 0; i < symbolsArr.length; i++) {
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
  baseScore: number,
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
function dbRecordToSearchResult(r: DBRecord, query?: string): SearchResult {
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
  query?: string,
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
        { originalError: error },
      );
    }

    throw wrapError(error, 'Failed to search vector database');
  }
}

/**
 * Filter records by language (case-insensitive match).
 */
function filterByLanguage(records: DBRecord[], language: string): DBRecord[] {
  return records.filter(
    (r: DBRecord) => r.language && r.language.toLowerCase() === language.toLowerCase(),
  );
}

/**
 * Filter records by regex pattern against content and file path.
 */
function filterByPattern(records: DBRecord[], pattern: string): DBRecord[] {
  const regex = new RegExp(pattern, 'i');
  return records.filter((r: DBRecord) => regex.test(r.content) || regex.test(r.file));
}

/**
 * Filter records by symbol type using SYMBOL_TYPE_MATCHES lookup.
 */
function filterBySymbolType(
  records: DBRecord[],
  symbolType: keyof typeof SYMBOL_TYPE_MATCHES,
): DBRecord[] {
  const allowedTypes = SYMBOL_TYPE_MATCHES[symbolType];
  if (!allowedTypes) {
    return [];
  }
  return records.filter((r: DBRecord) => r.symbolType != null && allowedTypes.has(r.symbolType));
}

/**
 * Convert DB records to unscored SearchResults (for scan/scroll operations).
 * Uses 'not_relevant' relevance to indicate results are unscored, not semantically irrelevant.
 */
function toUnscoredSearchResults(records: DBRecord[], limit: number): SearchResult[] {
  return records.slice(0, limit).map((r: DBRecord) => ({
    content: r.content,
    metadata: buildSearchResultMetadata(r),
    score: 0,
    relevance: 'not_relevant' as const,
  }));
}

/**
 * Scan the database with filters.
 * Scans all records to ensure complete coverage.
 */
/**
 * Escape double quotes in strings for SQL WHERE clause literals.
 * Doubles any `"` so the value is safe inside `"..."` delimiters.
 *
 * Example: `path"to"file.ts` → `path""to""file.ts`
 */
function escapeSqlString(value: string): string {
  return value.replace(/"/g, '""');
}

/**
 * Build a SQL WHERE clause for file path filtering.
 * Single file: file = "path/to/file.ts"
 * Multiple files: file IN ("a.ts", "b.ts")
 *
 * @throws {DatabaseError} if file paths are empty or whitespace-only
 */
function buildFileWhereClause(file: string | string[]): string {
  if (typeof file === 'string') {
    const trimmed = file.trim();
    if (trimmed.length === 0) {
      throw new DatabaseError('Invalid file filter: file path must be non-empty');
    }
    return `file = "${escapeSqlString(trimmed)}"`;
  }
  const cleaned = file.map(f => f.trim()).filter(f => f.length > 0);
  if (cleaned.length === 0) {
    throw new DatabaseError('Invalid file filter: at least one non-empty file path is required');
  }
  const escaped = cleaned.map(f => `"${escapeSqlString(f)}"`).join(', ');
  return `file IN (${escaped})`;
}

export async function scanWithFilter(
  table: LanceDBTable,
  options: {
    file?: string | string[];
    language?: string;
    pattern?: string;
    symbolType?: 'function' | 'method' | 'class' | 'interface';
    limit?: number;
  },
): Promise<SearchResult[]> {
  if (!table) {
    throw new DatabaseError('Vector database not initialized');
  }

  const { file, language, pattern, symbolType, limit = 100 } = options;

  try {
    const zeroVector = Array(EMBEDDING_DIMENSION).fill(0);

    // When file filter is provided, use targeted WHERE clause instead of full scan
    const whereClause = file ? buildFileWhereClause(file) : 'file != ""';

    let queryLimit: number;
    if (file) {
      // No need to scan all rows; use a generous limit relative to expected results
      const fileCount = typeof file === 'string' ? 1 : file.length;
      queryLimit = Math.max(fileCount * MAX_CHUNKS_PER_FILE, 1000);
    } else {
      // Full scan: get total row count to ensure we scan all records
      const totalRows = await table.countRows();
      queryLimit = Math.max(totalRows, 1000);
    }

    const query = table.search(zeroVector).where(whereClause).limit(queryLimit);

    const results = await query.toArray();

    let filtered = (results as unknown as DBRecord[]).filter(isValidRecord);

    if (language) filtered = filterByLanguage(filtered, language);
    if (pattern) filtered = filterByPattern(filtered, pattern);
    if (symbolType) filtered = filterBySymbolType(filtered, symbolType);

    return toUnscoredSearchResults(filtered, limit);
  } catch (error) {
    throw wrapError(error, 'Failed to scan with filter');
  }
}

/**
 * Helper to check if a record matches the requested symbol type
 */
function matchesSymbolType(
  record: DBRecord,
  symbolType: 'function' | 'method' | 'class' | 'interface',
  symbols: string[],
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
  symbolType?: 'function' | 'method' | 'class' | 'interface';
}

/**
 * Check if a record matches the symbol query filters.
 * Extracted to reduce complexity of querySymbols.
 */
function matchesSymbolFilter(
  r: DBRecord,
  { language, pattern, symbolType }: SymbolQueryOptions,
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
  const functions = toPlainArray<string>(r.functionNames);
  const classes = toPlainArray<string>(r.classNames);
  const interfaces = toPlainArray<string>(r.interfaceNames);
  return {
    functions: hasValidStringEntries(functions) ? functions! : [],
    classes: hasValidStringEntries(classes) ? classes! : [],
    interfaces: hasValidStringEntries(interfaces) ? interfaces! : [],
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
    symbolType?: 'function' | 'method' | 'class' | 'interface';
    limit?: number;
  },
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
    const query = table.search(zeroVector).where('file != ""').limit(Math.max(totalRows, 1000));

    const results = await query.toArray();

    const filtered = (results as unknown as DBRecord[]).filter(
      r => isValidRecord(r) && matchesSymbolFilter(r, filterOpts),
    );

    return filtered.slice(0, limit).map((r: DBRecord) => ({
      content: r.content,
      metadata: {
        ...buildSearchResultMetadata(r),
        symbols: buildLegacySymbols(r),
      },
      score: 0,
      relevance: 'not_relevant' as const,
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
  } = {},
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

/**
 * Scan all chunks using paginated queries.
 * Yields pages of SearchResult[] to avoid loading everything into memory.
 */
export async function* scanPaginated(
  table: LanceDBTable,
  options: {
    pageSize?: number;
    filter?: string;
  } = {},
): AsyncGenerator<SearchResult[]> {
  if (!table) {
    throw new DatabaseError('Vector database not initialized');
  }

  const pageSize = options.pageSize ?? 1000;
  if (pageSize <= 0) {
    throw new DatabaseError('pageSize must be a positive number');
  }
  const whereClause = options.filter || 'file != ""';
  let offset = 0;

  while (true) {
    let results: Record<string, unknown>[];
    try {
      results = await table.query().where(whereClause).limit(pageSize).offset(offset).toArray();
    } catch (error) {
      throw wrapError(error, 'Failed to scan paginated chunks', { offset, pageSize });
    }

    if (results.length === 0) break;

    const page = (results as unknown as DBRecord[]).filter(isValidRecord).map((r: DBRecord) => ({
      content: r.content,
      metadata: buildSearchResultMetadata(r),
      score: 0,
      relevance: 'not_relevant' as const,
    }));

    if (page.length > 0) {
      yield page;
    }

    if (results.length < pageSize) break;
    offset += pageSize;
  }
}
