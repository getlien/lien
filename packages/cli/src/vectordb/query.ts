import path from 'path';
import { SearchResult } from './types.js';
import { EMBEDDING_DIMENSION } from '../embeddings/types.js';
import { DatabaseError, wrapError } from '../errors/index.js';
import { calculateRelevance } from './relevance.js';
import { QueryIntent, classifyQueryIntent } from './intent-classifier.js';

type LanceDBTable = any;

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
 * Helper Functions for File Type Detection
 */

/**
 * Check if a file is a documentation file.
 */
function isDocumentationFile(filepath: string): boolean {
  const lower = filepath.toLowerCase();
  const filename = path.basename(filepath).toLowerCase();
  
  if (filename.startsWith('readme')) return true;
  if (filename.startsWith('changelog')) return true;
  if (filename.endsWith('.md') || filename.endsWith('.mdx') || filename.endsWith('.markdown')) {
    return true;
  }
  if (
    lower.includes('/docs/') ||
    lower.includes('/documentation/') ||
    lower.includes('/wiki/') ||
    lower.includes('/.github/')
  ) {
    return true;
  }
  if (
    lower.includes('architecture') ||
    lower.includes('workflow') ||
    lower.includes('/flow/')
  ) {
    return true;
  }
  
  return false;
}

/**
 * Check if a file is a test file.
 */
function isTestFile(filepath: string): boolean {
  const lower = filepath.toLowerCase();
  
  if (
    lower.includes('/test/') ||
    lower.includes('/tests/') ||
    lower.includes('/__tests__/')
  ) {
    return true;
  }
  
  if (
    lower.includes('.test.') ||
    lower.includes('.spec.') ||
    lower.includes('_test.') ||
    lower.includes('_spec.')
  ) {
    return true;
  }
  
  return false;
}

/**
 * Check if a file is a utility/helper file.
 */
function isUtilityFile(filepath: string): boolean {
  const lower = filepath.toLowerCase();
  
  if (
    lower.includes('/utils/') ||
    lower.includes('/utilities/') ||
    lower.includes('/helpers/') ||
    lower.includes('/lib/')
  ) {
    return true;
  }
  
  if (
    lower.includes('.util.') ||
    lower.includes('.helper.') ||
    lower.includes('-util.') ||
    lower.includes('-helper.')
  ) {
    return true;
  }
  
  return false;
}

/**
 * Boost relevance score based on path matching.
 */
function boostPathRelevance(
  query: string,
  filepath: string,
  baseScore: number
): number {
  const queryTokens = query.toLowerCase().split(/\s+/);
  const pathSegments = filepath.toLowerCase().split('/');
  
  let boostFactor = 1.0;
  
  for (const token of queryTokens) {
    if (token.length <= 2) continue;
    if (pathSegments.some(seg => seg.includes(token))) {
      boostFactor *= 0.9;
    }
  }
  
  return baseScore * boostFactor;
}

/**
 * Boost relevance score based on filename matching.
 */
function boostFilenameRelevance(
  query: string,
  filepath: string,
  baseScore: number
): number {
  const filename = path.basename(filepath, path.extname(filepath)).toLowerCase();
  const queryTokens = query.toLowerCase().split(/\s+/);
  
  let boostFactor = 1.0;
  
  for (const token of queryTokens) {
    if (token.length <= 2) continue;
    
    if (filename === token) {
      boostFactor *= 0.70;
    } else if (filename.includes(token)) {
      boostFactor *= 0.80;
    }
  }
  
  return baseScore * boostFactor;
}

/**
 * Boost relevance for LOCATION intent queries.
 */
function boostForLocationIntent(
  query: string,
  filepath: string,
  baseScore: number
): number {
  let score = baseScore;
  
  const filename = path.basename(filepath, path.extname(filepath)).toLowerCase();
  const queryTokens = query.toLowerCase().split(/\s+/);
  
  for (const token of queryTokens) {
    if (token.length <= 2) continue;
    
    if (filename === token) {
      score *= 0.60;
    } else if (filename.includes(token)) {
      score *= 0.70;
    }
  }
  
  score = boostPathRelevance(query, filepath, score);
  
  if (isTestFile(filepath)) {
    score *= 1.10;
  }
  
  return score;
}

/**
 * Boost relevance for CONCEPTUAL intent queries.
 */
function boostForConceptualIntent(
  query: string,
  filepath: string,
  baseScore: number
): number {
  let score = baseScore;
  
  if (isDocumentationFile(filepath)) {
    score *= 0.65;
    
    const lower = filepath.toLowerCase();
    if (
      lower.includes('architecture') ||
      lower.includes('workflow') ||
      lower.includes('flow')
    ) {
      score *= 0.90;
    }
  }
  
  if (isUtilityFile(filepath)) {
    score *= 1.05;
  }
  
  const filename = path.basename(filepath, path.extname(filepath)).toLowerCase();
  const queryTokens = query.toLowerCase().split(/\s+/);
  
  for (const token of queryTokens) {
    if (token.length <= 2) continue;
    if (filename.includes(token)) {
      score *= 0.90;
    }
  }
  
  const pathSegments = filepath.toLowerCase().split(path.sep);
  for (const token of queryTokens) {
    if (token.length <= 2) continue;
    
    for (const segment of pathSegments) {
      if (segment.includes(token)) {
        score *= 0.95;
        break;
      }
    }
  }
  
  return score;
}

/**
 * Boost relevance for IMPLEMENTATION intent queries.
 */
function boostForImplementationIntent(
  query: string,
  filepath: string,
  baseScore: number
): number {
  let score = baseScore;
  
  score = boostFilenameRelevance(query, filepath, score);
  score = boostPathRelevance(query, filepath, score);
  
  if (isTestFile(filepath)) {
    score *= 0.90;
  }
  
  return score;
}

/**
 * Apply all relevance boosting strategies to a search score.
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
  
  switch (intent) {
    case QueryIntent.LOCATION:
      return boostForLocationIntent(query, filepath, baseScore);
    
    case QueryIntent.CONCEPTUAL:
      return boostForConceptualIntent(query, filepath, baseScore);
    
    case QueryIntent.IMPLEMENTATION:
      return boostForImplementationIntent(query, filepath, baseScore);
    
    default:
      return boostForImplementationIntent(query, filepath, baseScore);
  }
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
          if (r.symbolType) {
            if (symbolType === 'function') {
              return r.symbolType === 'function' || r.symbolType === 'method';
            } else if (symbolType === 'class') {
              return r.symbolType === 'class';
            } else if (symbolType === 'interface') {
              return r.symbolType === 'interface';
            }
            return false;
          }
          
          return nameMatches;
        }
        
        return nameMatches;
      }
      
      if (symbolType) {
        if (r.symbolType) {
          if (symbolType === 'function') {
            return r.symbolType === 'function' || r.symbolType === 'method';
          } else if (symbolType === 'class') {
            return r.symbolType === 'class';
          } else if (symbolType === 'interface') {
            return r.symbolType === 'interface';
          }
          return false;
        }
        
        return symbols.length > 0 && symbols.some((s: string) => s.length > 0 && s !== '');
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

