import * as lancedb from 'vectordb';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { SearchResult, VectorDBInterface } from './types.js';
import { ChunkMetadata } from '../indexer/types.js';
import { EMBEDDING_DIMENSION } from '../embeddings/types.js';
import { readVersionFile } from './version.js';
import { DatabaseError, wrapError } from '../errors/index.js';
import * as queryOps from './query.js';
import * as batchOps from './batch-insert.js';
import * as maintenanceOps from './maintenance.js';

type LanceDBConnection = Awaited<ReturnType<typeof lancedb.connect>>;
type LanceDBTable = Awaited<ReturnType<LanceDBConnection['openTable']>>;

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
    this.table = await batchOps.insertBatch(
      this.db,
      this.table,
      this.tableName,
      vectors,
      metadatas,
      contents
    );
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
      return await queryOps.search(this.table, queryVector, limit, query);
    } catch (error) {
      const errorMsg = String(error);
      
      // Detect corrupted index or missing data files
      if (errorMsg.includes('Not found:') || errorMsg.includes('.lance')) {
        // Attempt to reconnect - index may have been rebuilt
        try {
          await this.initialize();
          if (!this.table) {
            throw new DatabaseError('Vector database not initialized after reconnection');
          }
          return await queryOps.search(this.table, queryVector, limit, query);
        } catch (retryError: unknown) {
          throw new DatabaseError(
            `Index appears corrupted or outdated. Please restart the MCP server or run 'lien reindex' in the project directory.`,
            { originalError: retryError }
          );
        }
      }
      
      throw error;
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
    return queryOps.scanWithFilter(this.table, options);
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
    return queryOps.querySymbols(this.table, options);
  }
  
  async clear(): Promise<void> {
    if (!this.db) {
      throw new DatabaseError('Vector database not initialized');
    }
    await maintenanceOps.clear(this.db, this.table, this.tableName);
    this.table = null;
  }
  
  async deleteByFile(filepath: string): Promise<void> {
    if (!this.table) {
      throw new DatabaseError('Vector database not initialized');
    }
    await maintenanceOps.deleteByFile(this.table, filepath);
  }
  
  async updateFile(
    filepath: string,
    vectors: Float32Array[],
    metadatas: ChunkMetadata[],
    contents: string[]
  ): Promise<void> {
    if (!this.db) {
      throw new DatabaseError('Vector database not initialized');
    }
    this.table = await maintenanceOps.updateFile(
      this.db,
      this.table,
      this.tableName,
      this.dbPath,
      filepath,
      vectors,
      metadatas,
      contents
    );
  }
  
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
  
  getCurrentVersion(): number {
    return this.currentVersion;
  }
  
  getVersionDate(): string {
    if (this.currentVersion === 0) {
      return 'Unknown';
    }
    return new Date(this.currentVersion).toLocaleString();
  }
  
  async hasData(): Promise<boolean> {
    if (!this.table) {
      return false;
    }
    
    try {
      const count = await this.table.countRows();
      
      if (count === 0) {
        return false;
      }
      
      // Sample a few rows to verify they contain real data
      const sample = await this.table
        .search(Array(EMBEDDING_DIMENSION).fill(0))
        .limit(Math.min(count, 5))
        .execute();
      
      const hasRealData = (sample as unknown as any[]).some((r: any) => 
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
