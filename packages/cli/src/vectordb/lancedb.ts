import * as lancedb from 'vectordb';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { SearchResult, VectorDBInterface } from './types.js';
import { ChunkMetadata } from '../indexer/types.js';
import { EMBEDDING_DIMENSION } from '../embeddings/types.js';
import { readVersionFile, writeVersionFile } from './version.js';
import { DatabaseError, wrapError } from '../errors/index.js';

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
    
    try {
      const records = vectors.map((vector, i) => ({
        vector: Array.from(vector),
        content: contents[i],
        file: metadatas[i].file,
        startLine: metadatas[i].startLine,
        endLine: metadatas[i].endLine,
        type: metadatas[i].type,
        language: metadatas[i].language,
        // Ensure arrays have at least empty string for Arrow type inference
        functionNames: (metadatas[i].symbols?.functions && metadatas[i].symbols.functions.length > 0) ? metadatas[i].symbols.functions : [''],
        classNames: (metadatas[i].symbols?.classes && metadatas[i].symbols.classes.length > 0) ? metadatas[i].symbols.classes : [''],
        interfaceNames: (metadatas[i].symbols?.interfaces && metadatas[i].symbols.interfaces.length > 0) ? metadatas[i].symbols.interfaces : [''],
      }));
      
      // Create table if it doesn't exist, otherwise add to existing table
      if (!this.table) {
        // Let LanceDB createTable handle type inference from the data
        this.table = await this.db.createTable(this.tableName, records) as LanceDBTable;
      } else {
        await this.table.add(records);
      }
    } catch (error) {
      throw wrapError(error, 'Failed to insert batch into vector database');
    }
  }
  
  async search(
    queryVector: Float32Array,
    limit: number = 5
  ): Promise<SearchResult[]> {
    if (!this.table) {
      throw new DatabaseError('Vector database not initialized');
    }
    
    try {
      // Request more results than needed to account for filtering
      const results = await this.table
        .search(Array.from(queryVector))
        .limit(limit + 10) // Get extra in case we filter some out
        .execute();
      
      // Filter out empty content, then map to SearchResult
      const filtered = (results as unknown as DBRecord[])
        .filter((r: DBRecord) => 
          r.content && 
          r.content.trim().length > 0 &&
          r.file && 
          r.file.length > 0
        )
        .slice(0, limit) // Take only the requested number after filtering
        .map((r: DBRecord) => ({
          content: r.content,
          metadata: {
            file: r.file,
            startLine: r.startLine,
            endLine: r.endLine,
            type: r.type as 'function' | 'class' | 'block',
            language: r.language,
          },
          score: r._distance ?? 0,
        }));
      
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
            .limit(limit)
            .execute();
          
          return (results as unknown as DBRecord[]).map((r: DBRecord) => ({
            content: r.content,
            metadata: {
              file: r.file,
              startLine: r.startLine,
              endLine: r.endLine,
              type: r.type as 'function' | 'class' | 'block',
              language: r.language,
            },
            score: r._distance ?? 0,
          }));
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
      
      return filtered.slice(0, limit).map((r: DBRecord) => ({
        content: r.content,
        metadata: {
          file: r.file,
          startLine: r.startLine,
          endLine: r.endLine,
          type: r.type as 'function' | 'class' | 'block',
          language: r.language,
        },
        score: 0,
      }));
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
        
        // Must have at least one symbol
        if (symbols.length === 0) {
          return false;
        }
        
        // Pattern filter on symbol names
        if (pattern) {
          const regex = new RegExp(pattern, 'i');
          return symbols.some((s: string) => regex.test(s));
        }
        
        return true;
      });
      
      return filtered.slice(0, limit).map((r: DBRecord) => ({
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
        },
        score: 0,
      }));
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

