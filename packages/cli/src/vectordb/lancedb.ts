import * as lancedb from 'vectordb';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { SearchResult, VectorDBInterface } from './types.js';
import { ChunkMetadata } from '../indexer/types.js';
import { EMBEDDING_DIMENSION } from '../embeddings/types.js';
import { readVersionFile, writeVersionFile } from './version.js';

export class VectorDB implements VectorDBInterface {
  private db: any = null;
  private table: any = null;
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
        // Table doesn't exist, create it with empty data (just for schema)
        // LanceDB requires at least one row to infer schema, so we create it empty
        // and will delete this dummy row after first real insertion
        const schema = [
          {
            vector: Array(EMBEDDING_DIMENSION).fill(0),
            content: '__SCHEMA_ROW__', // Mark as schema row for deletion
            file: '',
            startLine: 0,
            endLine: 0,
            type: '',
            language: '',
            isTest: false,
            relatedTests: [''], // Dummy array to establish type
            relatedSources: [''], // Dummy array to establish type
            testFramework: '',
            detectionMethod: '',
          },
        ];
        
        await this.db.createTable(this.tableName, schema);
        this.table = await this.db.openTable(this.tableName);
      }
      
      // Read and cache the current version
      try {
        this.currentVersion = await readVersionFile(this.dbPath);
      } catch {
        // Version file doesn't exist yet, will be created on first index
        this.currentVersion = 0;
      }
    } catch (error) {
      throw new Error(`Failed to initialize vector database: ${error}`);
    }
  }
  
  async insertBatch(
    vectors: Float32Array[],
    metadatas: ChunkMetadata[],
    contents: string[]
  ): Promise<void> {
    if (!this.table) {
      throw new Error('Vector database not initialized');
    }
    
    if (vectors.length !== metadatas.length || vectors.length !== contents.length) {
      throw new Error('Vectors, metadatas, and contents arrays must have the same length');
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
        isTest: metadatas[i].isTest ?? false,
        relatedTests: metadatas[i].relatedTests || [],
        relatedSources: metadatas[i].relatedSources || [],
        testFramework: metadatas[i].testFramework || '',
        detectionMethod: metadatas[i].detectionMethod || '',
      }));
      
      await this.table.add(records);
      
      // On first insertion, clean up the schema row if it exists
      // This is a one-time cleanup after table creation
      try {
        const count = await this.table.countRows();
        if (count > records.length) {
          // Delete rows where content is __SCHEMA_ROW__
          await this.table.delete('content = "__SCHEMA_ROW__"');
        }
      } catch {
        // Ignore cleanup errors - not critical
      }
    } catch (error) {
      throw new Error(`Failed to insert batch into vector database: ${error}`);
    }
  }
  
  async search(
    queryVector: Float32Array,
    limit: number = 5
  ): Promise<SearchResult[]> {
    if (!this.table) {
      throw new Error('Vector database not initialized');
    }
    
    try {
      // Request more results than needed to account for filtering
      const results = await this.table
        .search(Array.from(queryVector))
        .limit(limit + 10) // Get extra in case we filter some out
        .execute();
      
      // Filter out schema rows and empty content, then map to SearchResult
      const filtered = results
        .filter((r: any) => 
          r.content && 
          r.content !== '__SCHEMA_ROW__' && 
          r.content.trim().length > 0 &&
          r.file && 
          r.file.length > 0
        )
        .slice(0, limit) // Take only the requested number after filtering
        .map((r: any) => ({
          content: r.content,
          metadata: {
            file: r.file,
            startLine: r.startLine,
            endLine: r.endLine,
            type: r.type,
            language: r.language,
            isTest: r.isTest,
            relatedTests: r.relatedTests,
            relatedSources: r.relatedSources,
            testFramework: r.testFramework,
            detectionMethod: r.detectionMethod,
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
          
          return results.map((r: any) => ({
            content: r.content,
            metadata: {
              file: r.file,
              startLine: r.startLine,
              endLine: r.endLine,
              type: r.type,
              language: r.language,
              isTest: r.isTest,
              relatedTests: r.relatedTests,
              relatedSources: r.relatedSources,
              testFramework: r.testFramework,
              detectionMethod: r.detectionMethod,
            },
            score: r._distance ?? 0,
          }));
        } catch (retryError) {
          throw new Error(
            `Index appears corrupted or outdated. Please restart the MCP server or run 'lien reindex' in the project directory. Error: ${retryError}`
          );
        }
      }
      
      throw new Error(`Failed to search vector database: ${error}`);
    }
  }
  
  async clear(): Promise<void> {
    if (!this.db) {
      throw new Error('Vector database not initialized');
    }
    
    try {
      await this.db.dropTable(this.tableName);
      await this.initialize();
    } catch (error) {
      throw new Error(`Failed to clear vector database: ${error}`);
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
      throw new Error('Vector database not initialized');
    }
    
    try {
      // Use LanceDB's SQL-like delete with predicate
      await this.table.delete(`file = "${filepath}"`);
    } catch (error) {
      throw new Error(`Failed to delete file from vector database: ${error}`);
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
      throw new Error('Vector database not initialized');
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
      throw new Error(`Failed to update file in vector database: ${error}`);
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
      throw new Error(`Failed to reconnect to vector database: ${error}`);
    }
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
      
      const hasRealData = sample.some((r: any) => 
        r.content && 
        r.content !== '__SCHEMA_ROW__' && 
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

