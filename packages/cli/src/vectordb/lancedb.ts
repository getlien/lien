import * as lancedb from 'vectordb';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { SearchResult, VectorDBInterface } from './types.js';
import { ChunkMetadata } from '../indexer/types.js';
import { EMBEDDING_DIMENSION } from '../embeddings/types.js';
import { readVersionFile, writeVersionFile } from './version.js';
import { DatabaseError, wrapError } from '../errors/index.js';
import { calculateRelevance } from './relevance.js';
import { QueryIntent, classifyQueryIntent } from './intent-classifier.js';
import { VECTOR_DB_MAX_BATCH_SIZE, VECTOR_DB_MIN_BATCH_SIZE } from '../constants.js';

/**
 * Helper Functions for File Type Detection
 */

/**
 * Check if a file is a documentation file.
 * Matches common documentation patterns across different ecosystems.
 * 
 * @param filepath - Path to check
 * @returns True if file is documentation
 */
function isDocumentationFile(filepath: string): boolean {
  const lower = filepath.toLowerCase();
  const filename = path.basename(filepath).toLowerCase();
  
  // README files
  if (filename.startsWith('readme')) return true;
  
  // CHANGELOG files
  if (filename.startsWith('changelog')) return true;
  
  // Markdown files (common for docs)
  if (filename.endsWith('.md') || filename.endsWith('.mdx') || filename.endsWith('.markdown')) {
    return true;
  }
  
  // Documentation directories
  if (
    lower.includes('/docs/') ||
    lower.includes('/documentation/') ||
    lower.includes('/wiki/') ||
    lower.includes('/.github/')
  ) {
    return true;
  }
  
  // Architecture/workflow documentation
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
 * Matches common test file patterns.
 * 
 * @param filepath - Path to check
 * @returns True if file is a test file
 */
function isTestFile(filepath: string): boolean {
  const lower = filepath.toLowerCase();
  
  // Test directories
  if (
    lower.includes('/test/') ||
    lower.includes('/tests/') ||
    lower.includes('/__tests__/')
  ) {
    return true;
  }
  
  // Test file naming patterns
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
 * Matches common utility file patterns.
 * 
 * @param filepath - Path to check
 * @returns True if file is a utility file
 */
function isUtilityFile(filepath: string): boolean {
  const lower = filepath.toLowerCase();
  
  // Utility directories
  if (
    lower.includes('/utils/') ||
    lower.includes('/utilities/') ||
    lower.includes('/helpers/') ||
    lower.includes('/lib/')
  ) {
    return true;
  }
  
  // Utility file naming patterns
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
 * If query tokens match directory names in the file path, improve the score.
 * 
 * @param query - Original search query
 * @param filepath - Path to the file
 * @param baseScore - Original distance score from vector search
 * @returns Adjusted score (lower is better)
 */
function boostPathRelevance(
  query: string,
  filepath: string,
  baseScore: number
): number {
  const queryTokens = query.toLowerCase().split(/\s+/);
  const pathSegments = filepath.toLowerCase().split('/');
  
  let boostFactor = 1.0;
  
  // Check if query mentions any directory name in the path
  for (const token of queryTokens) {
    // Skip very short tokens (like "is", "a", etc.)
    if (token.length <= 2) continue;
    
    // Check if this token appears in any path segment
    if (pathSegments.some(seg => seg.includes(token))) {
      boostFactor *= 0.9; // 10% boost (reduce distance)
    }
  }
  
  return baseScore * boostFactor;
}

/**
 * Boost relevance score based on filename matching.
 * If query tokens match the filename, significantly improve the score.
 * Exact matches get stronger boost than partial matches.
 * 
 * @param query - Original search query
 * @param filepath - Path to the file
 * @param baseScore - Original distance score from vector search
 * @returns Adjusted score (lower is better)
 */
function boostFilenameRelevance(
  query: string,
  filepath: string,
  baseScore: number
): number {
  const filename = path.basename(filepath, path.extname(filepath)).toLowerCase();
  const queryTokens = query.toLowerCase().split(/\s+/);
  
  let boostFactor = 1.0;
  
  // Check if any query token matches the filename
  for (const token of queryTokens) {
    // Skip very short tokens
    if (token.length <= 2) continue;
    
    // Exact match: 30% boost (stronger signal)
    if (filename === token) {
      boostFactor *= 0.70;
    }
    // Partial match: 20% boost
    else if (filename.includes(token)) {
      boostFactor *= 0.80;
    }
  }
  
  return baseScore * boostFactor;
}

/**
 * Intent-Specific Boosting Strategies
 */

/**
 * Boost relevance for LOCATION intent queries.
 * 
 * LOCATION queries (e.g., "where is the auth handler") need strong
 * filename and path matching with penalties for test files.
 * 
 * Strategy:
 * - Filename exact match: 40% boost
 * - Filename partial match: 30% boost
 * - Path match: 15% boost
 * - Test file penalty: -10%
 * 
 * @param query - Original search query
 * @param filepath - Path to the file
 * @param baseScore - Original distance score from vector search
 * @returns Boosted score (lower is better)
 */
function boostForLocationIntent(
  query: string,
  filepath: string,
  baseScore: number
): number {
  let score = baseScore;
  
  // Apply strong filename boosting
  const filename = path.basename(filepath, path.extname(filepath)).toLowerCase();
  const queryTokens = query.toLowerCase().split(/\s+/);
  
  for (const token of queryTokens) {
    if (token.length <= 2) continue;
    
    // Exact match: 40% boost (very strong for location queries)
    if (filename === token) {
      score *= 0.60;
    }
    // Partial match: 30% boost
    else if (filename.includes(token)) {
      score *= 0.70;
    }
  }
  
  // Apply path boosting
  score = boostPathRelevance(query, filepath, score);
  
  // Penalize test files for location queries
  // Users usually want production code, not tests
  if (isTestFile(filepath)) {
    score *= 1.10; // 10% penalty (higher score = worse)
  }
  
  return score;
}

/**
 * Boost relevance for CONCEPTUAL intent queries.
 * 
 * CONCEPTUAL queries (e.g., "how does authentication work") need
 * documentation and architecture files boosted.
 * 
 * Strategy:
 * - Documentation files: 35% boost
 * - Architecture/flow files: Additional 10% boost
 * - Utility files: 5% penalty
 * - Reduced filename/path boosting: 10% filename, 5% path
 * 
 * @param query - Original search query
 * @param filepath - Path to the file
 * @param baseScore - Original distance score from vector search
 * @returns Boosted score (lower is better)
 */
function boostForConceptualIntent(
  query: string,
  filepath: string,
  baseScore: number
): number {
  let score = baseScore;
  
  // Strong boost for documentation files
  if (isDocumentationFile(filepath)) {
    score *= 0.65; // 35% boost
    
    // Extra boost for architecture/workflow documentation
    const lower = filepath.toLowerCase();
    if (
      lower.includes('architecture') ||
      lower.includes('workflow') ||
      lower.includes('flow')
    ) {
      score *= 0.90; // Additional 10% boost
    }
  }
  
  // Light penalty for utility files (too low-level for conceptual queries)
  if (isUtilityFile(filepath)) {
    score *= 1.05; // 5% penalty
  }
  
  // Apply reduced filename/path boosting (less important for conceptual queries)
  const filename = path.basename(filepath, path.extname(filepath)).toLowerCase();
  const queryTokens = query.toLowerCase().split(/\s+/);
  
  for (const token of queryTokens) {
    if (token.length <= 2) continue;
    
    // Reduced filename boost: 10%
    if (filename.includes(token)) {
      score *= 0.90;
    }
  }
  
  // Reduced path boost: 5%
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
 * 
 * IMPLEMENTATION queries (e.g., "how is authentication implemented")
 * need balanced boosting with moderate test file boost to show usage.
 * 
 * Strategy:
 * - Filename exact match: 30% boost
 * - Filename partial match: 20% boost
 * - Path match: 10% boost
 * - Test files: 10% boost (to show real usage)
 * 
 * This is the default/balanced strategy.
 * 
 * @param query - Original search query
 * @param filepath - Path to the file
 * @param baseScore - Original distance score from vector search
 * @returns Boosted score (lower is better)
 */
function boostForImplementationIntent(
  query: string,
  filepath: string,
  baseScore: number
): number {
  let score = baseScore;
  
  // Apply standard filename boosting
  score = boostFilenameRelevance(query, filepath, score);
  
  // Apply standard path boosting
  score = boostPathRelevance(query, filepath, score);
  
  // Moderate boost for test files (they show real usage patterns)
  if (isTestFile(filepath)) {
    score *= 0.90; // 10% boost
  }
  
  return score;
}

/**
 * Apply all relevance boosting strategies to a search score.
 * 
 * Uses query intent classification to apply appropriate boosting:
 * - LOCATION: Strong filename/path boost, test penalty
 * - CONCEPTUAL: Documentation boost, utility penalty
 * - IMPLEMENTATION: Balanced boost with test file boost
 * 
 * @param query - Original search query (optional)
 * @param filepath - Path to the file
 * @param baseScore - Original distance score from vector search
 * @returns Boosted score (lower is better)
 */
function applyRelevanceBoosting(
  query: string | undefined,
  filepath: string,
  baseScore: number
): number {
  if (!query) {
    return baseScore;
  }
  
  // Classify query intent
  const intent = classifyQueryIntent(query);
  
  // Apply intent-specific boosting
  switch (intent) {
    case QueryIntent.LOCATION:
      return boostForLocationIntent(query, filepath, baseScore);
    
    case QueryIntent.CONCEPTUAL:
      return boostForConceptualIntent(query, filepath, baseScore);
    
    case QueryIntent.IMPLEMENTATION:
      return boostForImplementationIntent(query, filepath, baseScore);
    
    default:
      // Fallback to implementation strategy
      return boostForImplementationIntent(query, filepath, baseScore);
  }
}

type LanceDBConnection = Awaited<ReturnType<typeof lancedb.connect>>;
type LanceDBTable = Awaited<ReturnType<LanceDBConnection['openTable']>>;

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

export class VectorDB implements VectorDBInterface {
  private db: LanceDBConnection | null = null;
  private table: LanceDBTable | null = null;
  public readonly dbPath: string;
  private readonly tableName = 'code_chunks';
  private lastVersionCheck: number = 0;
  private currentVersion: number = 0;
  
  constructor(projectRoot: string) {
    // Store in user's home directory under ~/.lien/indices/{projectName-hash}
    const projectName = path.basename(projectRoot);
    
    // Create unique identifier from full path to prevent collisions
    // This ensures projects with same name in different locations get separate indices
    const pathHash = crypto
      .createHash('md5')
      .update(projectRoot)
      .digest('hex')
      .substring(0, 8);
    
    this.dbPath = path.join(
      os.homedir(),
      '.lien',
      'indices',
      `${projectName}-${pathHash}`
    );
  }
  
  async initialize(): Promise<void> {
    try {
      this.db = await lancedb.connect(this.dbPath);
      
      try {
        this.table = await this.db.openTable(this.tableName);
      } catch {
        // Table doesn't exist yet - will be created on first insert
        // Set table to null to signal it needs creation
        this.table = null;
      }
      
      // Read and cache the current version
      try {
        this.currentVersion = await readVersionFile(this.dbPath);
      } catch {
        // Version file doesn't exist yet, will be created on first index
        this.currentVersion = 0;
      }
    } catch (error: unknown) {
      throw wrapError(error, 'Failed to initialize vector database', { dbPath: this.dbPath });
    }
  }
  
  async insertBatch(
    vectors: Float32Array[],
    metadatas: ChunkMetadata[],
    contents: string[]
  ): Promise<void> {
    if (!this.db) {
      throw new DatabaseError('Vector database not initialized');
    }
    
    if (vectors.length !== metadatas.length || vectors.length !== contents.length) {
      throw new DatabaseError('Vectors, metadatas, and contents arrays must have the same length', {
        vectorsLength: vectors.length,
        metadatasLength: metadatas.length,
        contentsLength: contents.length,
      });
    }
    
    // Handle empty batch gracefully
    if (vectors.length === 0) {
      return;
    }
    
    // Split large batches into smaller chunks for better reliability
    if (vectors.length > VECTOR_DB_MAX_BATCH_SIZE) {
      // Split into smaller batches
      for (let i = 0; i < vectors.length; i += VECTOR_DB_MAX_BATCH_SIZE) {
        const batchVectors = vectors.slice(i, Math.min(i + VECTOR_DB_MAX_BATCH_SIZE, vectors.length));
        const batchMetadata = metadatas.slice(i, Math.min(i + VECTOR_DB_MAX_BATCH_SIZE, vectors.length));
        const batchContents = contents.slice(i, Math.min(i + VECTOR_DB_MAX_BATCH_SIZE, vectors.length));
        
        await this._insertBatchInternal(batchVectors, batchMetadata, batchContents);
      }
    } else {
      await this._insertBatchInternal(vectors, metadatas, contents);
    }
  }
  
  /**
   * Internal method to insert a single batch with iterative retry logic.
   * Uses a queue-based approach to avoid deep recursion on large batch failures.
   */
  private async _insertBatchInternal(
    vectors: Float32Array[],
    metadatas: ChunkMetadata[],
    contents: string[]
  ): Promise<void> {
    // Queue of batches to process (start with the full batch)
    interface BatchToProcess {
      vectors: Float32Array[];
      metadatas: ChunkMetadata[];
      contents: string[];
    }
    
    const queue: BatchToProcess[] = [{ vectors, metadatas, contents }];
    const failedRecords: BatchToProcess[] = [];
    
    // Process batches iteratively
    while (queue.length > 0) {
      const batch = queue.shift()!;
      
      try {
        const records = batch.vectors.map((vector, i) => ({
          vector: Array.from(vector),
          content: batch.contents[i],
          file: batch.metadatas[i].file,
          startLine: batch.metadatas[i].startLine,
          endLine: batch.metadatas[i].endLine,
          type: batch.metadatas[i].type,
          language: batch.metadatas[i].language,
          // Ensure arrays have at least empty string for Arrow type inference
          functionNames: (batch.metadatas[i].symbols?.functions && batch.metadatas[i].symbols.functions.length > 0) ? batch.metadatas[i].symbols.functions : [''],
          classNames: (batch.metadatas[i].symbols?.classes && batch.metadatas[i].symbols.classes.length > 0) ? batch.metadatas[i].symbols.classes : [''],
          interfaceNames: (batch.metadatas[i].symbols?.interfaces && batch.metadatas[i].symbols.interfaces.length > 0) ? batch.metadatas[i].symbols.interfaces : [''],
          // AST-derived metadata (v0.13.0)
          symbolName: batch.metadatas[i].symbolName || '',
          symbolType: batch.metadatas[i].symbolType || '',
          parentClass: batch.metadatas[i].parentClass || '',
          complexity: batch.metadatas[i].complexity || 0,
          parameters: (batch.metadatas[i].parameters && batch.metadatas[i].parameters.length > 0) ? batch.metadatas[i].parameters : [''],
          signature: batch.metadatas[i].signature || '',
          imports: (batch.metadatas[i].imports && batch.metadatas[i].imports.length > 0) ? batch.metadatas[i].imports : [''],
        }));
        
        // Create table if it doesn't exist, otherwise add to existing table
        if (!this.table) {
          // Let LanceDB createTable handle type inference from the data
          this.table = await this.db!.createTable(this.tableName, records) as LanceDBTable;
        } else {
          await this.table.add(records);
        }
      } catch (error) {
        // If batch has more than min size records, split and retry
        if (batch.vectors.length > VECTOR_DB_MIN_BATCH_SIZE) {
          const half = Math.floor(batch.vectors.length / 2);
          
          // Split in half and add back to queue
          queue.push({
            vectors: batch.vectors.slice(0, half),
            metadatas: batch.metadatas.slice(0, half),
            contents: batch.contents.slice(0, half),
          });
          queue.push({
            vectors: batch.vectors.slice(half),
            metadatas: batch.metadatas.slice(half),
            contents: batch.contents.slice(half),
          });
        } else {
          // Small batch failed - collect for final error report
          failedRecords.push(batch);
        }
      }
    }
    
    // If any small batches failed, throw error with details
    if (failedRecords.length > 0) {
      const totalFailed = failedRecords.reduce((sum, batch) => sum + batch.vectors.length, 0);
      throw new DatabaseError(
        `Failed to insert ${totalFailed} record(s) after retry attempts`,
        {
          failedBatches: failedRecords.length,
          totalRecords: totalFailed,
          sampleFile: failedRecords[0].metadatas[0].file,
        }
      );
    }
  }
  
  async search(
    queryVector: Float32Array,
    limit: number = 5,
    query?: string
  ): Promise<SearchResult[]> {
    if (!this.table) {
      throw new DatabaseError('Vector database not initialized');
    }
    
    try {
      // Request more results than needed to account for filtering and re-ranking
      const results = await this.table
        .search(Array.from(queryVector))
        .limit(limit + 20) // Get extra for re-ranking after boosting
        .execute();
      
      // Filter out empty content, apply boosting, then sort by boosted score
      const filtered = (results as unknown as DBRecord[])
        .filter((r: DBRecord) => 
          r.content && 
          r.content.trim().length > 0 &&
          r.file && 
          r.file.length > 0
        )
        .map((r: DBRecord) => {
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
        })
        .sort((a, b) => a.score - b.score) // Re-sort by boosted score
        .slice(0, limit); // Take only the requested number after re-ranking
      
      return filtered;
    } catch (error) {
      const errorMsg = String(error);
      
      // Detect corrupted index or missing data files (common after reindexing)
      if (errorMsg.includes('Not found:') || errorMsg.includes('.lance')) {
        // Attempt to reconnect - index may have been rebuilt
        try {
          await this.initialize();
          
          // Retry search with fresh connection
          const results = await this.table
            .search(Array.from(queryVector))
            .limit(limit + 20)
            .execute();
          
          return (results as unknown as DBRecord[])
            .filter((r: DBRecord) => 
              r.content && 
              r.content.trim().length > 0 &&
              r.file && 
              r.file.length > 0
            )
            .map((r: DBRecord) => {
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
                },
                score: boostedScore,
                relevance: calculateRelevance(boostedScore),
              };
            })
            .sort((a, b) => a.score - b.score)
            .slice(0, limit);
        } catch (retryError: unknown) {
          throw new DatabaseError(
            `Index appears corrupted or outdated. Please restart the MCP server or run 'lien reindex' in the project directory.`,
            { originalError: retryError }
          );
        }
      }
      
      throw wrapError(error, 'Failed to search vector database');
    }
  }
  
  async scanWithFilter(options: {
    language?: string;
    pattern?: string;
    limit?: number;
  }): Promise<SearchResult[]> {
    if (!this.table) {
      throw new DatabaseError('Vector database not initialized');
    }
    
    const { language, pattern, limit = 100 } = options;
    
    try {
      // Use vector search with zero vector to get a large sample
      // This is a workaround since LanceDB doesn't have a direct scan API
      const zeroVector = Array(EMBEDDING_DIMENSION).fill(0);
      const query = this.table.search(zeroVector)
        .where('file != ""')
        .limit(Math.max(limit * 5, 200)); // Get a larger sample to ensure we have enough after filtering
      
      const results = await query.execute();
      
      // Filter in JavaScript for more reliable filtering
      let filtered = (results as unknown as DBRecord[]).filter((r: DBRecord) => 
        r.content && 
        r.content.trim().length > 0 &&
        r.file && 
        r.file.length > 0
      );
      
      // Apply language filter
      if (language) {
        filtered = filtered.filter((r: DBRecord) => 
          r.language && r.language.toLowerCase() === language.toLowerCase()
        );
      }
      
      // Apply regex pattern filter
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
  
  async querySymbols(options: {
    language?: string;
    pattern?: string;
    symbolType?: 'function' | 'class' | 'interface';
    limit?: number;
  }): Promise<SearchResult[]> {
    if (!this.table) {
      throw new DatabaseError('Vector database not initialized');
    }
    
    const { language, pattern, symbolType, limit = 50 } = options;
    
    try {
      // Use vector search with zero vector to get a large sample
      const zeroVector = Array(EMBEDDING_DIMENSION).fill(0);
      const query = this.table.search(zeroVector)
        .where('file != ""')
        .limit(Math.max(limit * 10, 500)); // Get a large sample to ensure we have enough after symbol filtering
      
      const results = await query.execute();
      
      // Filter in JavaScript for more precise control
      let filtered = (results as unknown as DBRecord[]).filter((r: DBRecord) => {
        // Basic validation
        if (!r.content || r.content.trim().length === 0) {
          return false;
        }
        if (!r.file || r.file.length === 0) {
          return false;
        }
        
        // Language filter
        if (language && (!r.language || r.language.toLowerCase() !== language.toLowerCase())) {
          return false;
        }
        
        // Get relevant symbol names based on symbolType
        const symbols = symbolType === 'function' ? (r.functionNames || []) :
                       symbolType === 'class' ? (r.classNames || []) :
                       symbolType === 'interface' ? (r.interfaceNames || []) :
                       [...(r.functionNames || []), ...(r.classNames || []), ...(r.interfaceNames || [])];
        
        // Also check AST-derived symbolName (v0.13.0)
        const astSymbolName = r.symbolName || '';
        
        // Must have at least one symbol from either source
        if (symbols.length === 0 && !astSymbolName) {
          return false;
        }
        
        // Pattern filter on symbol names
        if (pattern) {
          const regex = new RegExp(pattern, 'i');
          const matchesOldSymbols = symbols.some((s: string) => regex.test(s));
          const matchesASTSymbol = regex.test(astSymbolName);
          const nameMatches = matchesOldSymbols || matchesASTSymbol;
          
          // If no name match, reject immediately
          if (!nameMatches) return false;
          
          // If name matches, also check AST symbolType if specified
          // Semantic filtering: 'function' includes methods (arrow functions are typed as 'function')
          if (symbolType) {
            // If AST metadata available, use it for precise filtering
            if (r.symbolType) {
              if (symbolType === 'function') {
                return r.symbolType === 'function' || r.symbolType === 'method';
              } else if (symbolType === 'class') {
                return r.symbolType === 'class';
              } else if (symbolType === 'interface') {
                return r.symbolType === 'interface';
              }
              return false; // symbolType doesn't match filter
            }
            
            // Fallback: For line-based chunks, trust that name matched the right symbol type
            // The 'symbols' array was already filtered by symbolType on line 832-835
            return nameMatches;
          }
          
          return nameMatches;
        }
        
        // If no pattern, check symbolType only
        if (symbolType) {
          // If AST metadata available, use it for precise filtering
          if (r.symbolType) {
            if (symbolType === 'function') {
              return r.symbolType === 'function' || r.symbolType === 'method';
            } else if (symbolType === 'class') {
              return r.symbolType === 'class';
            } else if (symbolType === 'interface') {
              return r.symbolType === 'interface';
            }
            return false; // symbolType doesn't match filter
          }
          
          // Fallback: For line-based chunks without AST metadata, check legacy symbols
          // The 'symbols' array was already filtered by symbolType on line 832-835
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
              functions: r.functionNames || [],
              classes: r.classNames || [],
              interfaces: r.interfaceNames || [],
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
  
  async clear(): Promise<void> {
    if (!this.db) {
      throw new DatabaseError('Vector database not initialized');
    }
    
    try {
      // Drop table if it exists
      if (this.table) {
        await this.db.dropTable(this.tableName);
      }
      // Set table to null - will be recreated on first insert
      this.table = null;
    } catch (error) {
      throw wrapError(error, 'Failed to clear vector database');
    }
  }
  
  /**
   * Deletes all chunks from a specific file.
   * Used for incremental reindexing when a file is deleted or needs to be re-indexed.
   * 
   * @param filepath - Path to the file whose chunks should be deleted
   */
  async deleteByFile(filepath: string): Promise<void> {
    if (!this.table) {
      throw new DatabaseError('Vector database not initialized');
    }
    
    try {
      // Use LanceDB's SQL-like delete with predicate
      await this.table.delete(`file = "${filepath}"`);
    } catch (error) {
      throw wrapError(error, 'Failed to delete file from vector database');
    }
  }
  
  /**
   * Updates a file in the index by atomically deleting old chunks and inserting new ones.
   * This is the primary method for incremental reindexing.
   * 
   * @param filepath - Path to the file being updated
   * @param vectors - New embedding vectors
   * @param metadatas - New chunk metadata
   * @param contents - New chunk contents
   */
  async updateFile(
    filepath: string,
    vectors: Float32Array[],
    metadatas: ChunkMetadata[],
    contents: string[]
  ): Promise<void> {
    if (!this.table) {
      throw new DatabaseError('Vector database not initialized');
    }
    
    try {
      // 1. Delete old chunks from this file
      await this.deleteByFile(filepath);
      
      // 2. Insert new chunks (if any)
      if (vectors.length > 0) {
        await this.insertBatch(vectors, metadatas, contents);
      }
      
      // 3. Update version file to trigger MCP reconnection
      await writeVersionFile(this.dbPath);
    } catch (error) {
      throw wrapError(error, 'Failed to update file in vector database');
    }
  }
  
  /**
   * Checks if the index version has changed since last check.
   * Uses caching to minimize I/O overhead (checks at most once per second).
   * 
   * @returns true if version has changed, false otherwise
   */
  async checkVersion(): Promise<boolean> {
    const now = Date.now();
    
    // Cache version checks for 1 second to minimize I/O
    if (now - this.lastVersionCheck < 1000) {
      return false;
    }
    
    this.lastVersionCheck = now;
    
    try {
      const version = await readVersionFile(this.dbPath);
      
      if (version > this.currentVersion) {
        this.currentVersion = version;
        return true;
      }
      
      return false;
    } catch (error) {
      // If we can't read version file, don't reconnect
      return false;
    }
  }
  
  /**
   * Reconnects to the database by reinitializing the connection.
   * Used when the index has been rebuilt/reindexed.
   * Forces a complete reload from disk by closing existing connections first.
   */
  async reconnect(): Promise<void> {
    try {
      // Close existing connections to force reload from disk
      this.table = null;
      this.db = null;
      
      // Reinitialize with fresh connection
      await this.initialize();
    } catch (error) {
      throw wrapError(error, 'Failed to reconnect to vector database');
    }
  }
  
  /**
   * Gets the current index version (timestamp of last reindex).
   * 
   * @returns Version timestamp, or 0 if unknown
   */
  getCurrentVersion(): number {
    return this.currentVersion;
  }
  
  /**
   * Gets the current index version as a human-readable date string.
   * 
   * @returns Formatted date string, or 'Unknown' if no version
   */
  getVersionDate(): string {
    if (this.currentVersion === 0) {
      return 'Unknown';
    }
    return new Date(this.currentVersion).toLocaleString();
  }
  
  /**
   * Checks if the database contains real indexed data.
   * Used to detect first run and trigger auto-indexing.
   * 
   * @returns true if database has real code chunks, false if empty or only schema rows
   */
  async hasData(): Promise<boolean> {
    if (!this.table) {
      return false;
    }
    
    try {
      const count = await this.table.countRows();
      
      // Check if table is empty
      if (count === 0) {
        return false;
      }
      
      // Check if all rows are empty (schema rows only)
      // Sample a few rows to verify they contain real data
      const sample = await this.table
        .search(Array(EMBEDDING_DIMENSION).fill(0))
        .limit(Math.min(count, 5))
        .execute();
      
      const hasRealData = (sample as unknown as DBRecord[]).some((r: DBRecord) => 
        r.content && 
        r.content.trim().length > 0
      );
      
      return hasRealData;
    } catch {
      // If any error occurs, assume no data
      return false;
    }
  }
  
  static async load(projectRoot: string): Promise<VectorDB> {
    const db = new VectorDB(projectRoot);
    await db.initialize();
    return db;
  }
}

