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
  parameters?: string[];
  signature?: string;
  imports?: string[];
  _distance?: number; // Added by LanceDB for search results
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
    metadata: {
      file: r.file,
      startLine: r.startLine,
      endLine: r.endLine,
      type: r.type as 'function' | 'class' | 'block',
      language: r.language,
      // AST-derived metadata (v0.13.0)
      symbolName: r.symbolName || undefined,
      symbolType: r.symbolType as 'function' | 'method' | 'class' | 'interface' | undefined,
      parentClass: r.parentClass || undefined,
      complexity: r.complexity || undefined,
      parameters: (r.parameters && r.parameters.length > 0 && r.parameters[0] !== '') ? r.parameters : undefined,
      signature: r.signature || undefined,
      imports: (r.imports && r.imports.length > 0 && r.imports[0] !== '') ? r.imports : undefined,
    },
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
      .execute();
    
    const filtered = (results as unknown as DBRecord[])
      .filter((r: DBRecord) => 
        r.content && 
        r.content.trim().length > 0 &&
        r.file && 
        r.file.length > 0
      )
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
 * Scan the database with filters
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
    const zeroVector = Array(EMBEDDING_DIMENSION).fill(0);
    const query = table.search(zeroVector)
      .where('file != ""')
      .limit(Math.max(limit * 5, 200));
    
    const results = await query.execute();
    
    let filtered = (results as unknown as DBRecord[]).filter((r: DBRecord) => 
      r.content && 
      r.content.trim().length > 0 &&
      r.file && 
      r.file.length > 0
    );
    
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
    
    return filtered.slice(0, limit).map((r: DBRecord) => {
      const score = 0;
      return {
        content: r.content,
        metadata: {
          file: r.file,
          startLine: r.startLine,
          endLine: r.endLine,
          type: r.type as 'function' | 'class' | 'block',
          language: r.language,
          // AST-derived metadata (v0.13.0)
          symbolName: r.symbolName || undefined,
          symbolType: r.symbolType as 'function' | 'method' | 'class' | 'interface' | undefined,
          parentClass: r.parentClass || undefined,
          complexity: r.complexity || undefined,
          parameters: (r.parameters && r.parameters.length > 0 && r.parameters[0] !== '') ? r.parameters : undefined,
          signature: r.signature || undefined,
          imports: (r.imports && r.imports.length > 0 && r.imports[0] !== '') ? r.imports : undefined,
        },
        score,
        relevance: calculateRelevance(score),
      };
    });
  } catch (error) {
    throw wrapError(error, 'Failed to scan with filter');
  }
}

/**
 * Helper to check if a record matches the requested symbol type
 */
function matchesSymbolType(
  record: DBRecord,
  symbolType: 'function' | 'class' | 'interface',
  symbols: string[]
): boolean {
  // If AST-based symbolType exists, use it (more accurate)
  if (record.symbolType) {
    if (symbolType === 'function') {
      return record.symbolType === 'function' || record.symbolType === 'method';
    } else if (symbolType === 'class') {
      return record.symbolType === 'class';
    } else if (symbolType === 'interface') {
      return record.symbolType === 'interface';
    }
    return false;
  }
  
  // Fallback: check if pre-AST symbols array has valid entries
  return symbols.length > 0 && symbols.some((s: string) => s.length > 0 && s !== '');
}

/**
 * Query symbols (functions, classes, interfaces)
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
  
  try {
    const zeroVector = Array(EMBEDDING_DIMENSION).fill(0);
    const query = table.search(zeroVector)
      .where('file != ""')
      .limit(Math.max(limit * 10, 500));
    
    const results = await query.execute();
    
    let filtered = (results as unknown as DBRecord[]).filter((r: DBRecord) => {
      if (!r.content || r.content.trim().length === 0) {
        return false;
      }
      if (!r.file || r.file.length === 0) {
        return false;
      }
      
      if (language && (!r.language || r.language.toLowerCase() !== language.toLowerCase())) {
        return false;
      }
      
      const symbols = symbolType === 'function' ? (r.functionNames || []) :
                     symbolType === 'class' ? (r.classNames || []) :
                     symbolType === 'interface' ? (r.interfaceNames || []) :
                     [...(r.functionNames || []), ...(r.classNames || []), ...(r.interfaceNames || [])];
      
      const astSymbolName = r.symbolName || '';
      
      if (symbols.length === 0 && !astSymbolName) {
        return false;
      }
      
      if (pattern) {
        const regex = new RegExp(pattern, 'i');
        const matchesOldSymbols = symbols.some((s: string) => regex.test(s));
        const matchesASTSymbol = regex.test(astSymbolName);
        const nameMatches = matchesOldSymbols || matchesASTSymbol;
        
        if (!nameMatches) return false;
        
        if (symbolType) {
          return matchesSymbolType(r, symbolType, symbols);
        }
        
        return nameMatches;
      }
      
      if (symbolType) {
        return matchesSymbolType(r, symbolType, symbols);
      }
      
      return true;
    });
    
    return filtered.slice(0, limit).map((r: DBRecord) => {
      const score = 0;
      return {
        content: r.content,
        metadata: {
          file: r.file,
          startLine: r.startLine,
          endLine: r.endLine,
          type: r.type as 'function' | 'class' | 'block',
          language: r.language,
          symbols: {
            functions: (r.functionNames && r.functionNames.length > 0 && r.functionNames[0] !== '') ? r.functionNames : [],
            classes: (r.classNames && r.classNames.length > 0 && r.classNames[0] !== '') ? r.classNames : [],
            interfaces: (r.interfaceNames && r.interfaceNames.length > 0 && r.interfaceNames[0] !== '') ? r.interfaceNames : [],
          },
          // AST-derived metadata (v0.13.0)
          symbolName: r.symbolName || undefined,
          symbolType: r.symbolType as 'function' | 'method' | 'class' | 'interface' | undefined,
          parentClass: r.parentClass || undefined,
          complexity: r.complexity || undefined,
          parameters: (r.parameters && r.parameters.length > 0 && r.parameters[0] !== '') ? r.parameters : undefined,
          signature: r.signature || undefined,
          imports: (r.imports && r.imports.length > 0 && r.imports[0] !== '') ? r.imports : undefined,
        },
        score,
        relevance: calculateRelevance(score),
      };
    });
  } catch (error) {
    throw wrapError(error, 'Failed to query symbols');
  }
}

/**
 * Scan all chunks in the database
 * First gets the total count, then fetches all with a single query
 * This is more efficient than pagination for local/embedded databases like LanceDB
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
    // Get total row count to determine limit
    const totalRows = await table.countRows();
    
    // Fetch all rows in one query (LanceDB is local, this is efficient)
    // Note: scanWithFilter internally fetches 5x the limit to handle filtering overhead,
    // then caps output to 'limit'. We pass totalRows so we get all rows back after
    // filtering. The 5x overfetch is acceptable overhead for local DBs.
    const MIN_SCAN_LIMIT = 1000;
    const results = await scanWithFilter(table, {
      ...options,
      limit: Math.max(totalRows, MIN_SCAN_LIMIT),
    });
    
    return results;
  } catch (error) {
    throw wrapError(error, 'Failed to scan all chunks');
  }
}
