import * as lancedb from 'vectordb';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { SearchResult, VectorDBInterface } from './types.js';
import { ChunkMetadata } from '../indexer/types.js';
import { EMBEDDING_DIMENSION } from '../embeddings/types.js';

export class VectorDB implements VectorDBInterface {
  private db: any = null;
  private table: any = null;
  private dbPath: string;
  private readonly tableName = 'code_chunks';
  
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
        // Table doesn't exist, create it with schema
        const schema = [
          {
            vector: Array(EMBEDDING_DIMENSION).fill(0),
            content: '',
            file: '',
            startLine: 0,
            endLine: 0,
            type: '',
            language: '',
          },
        ];
        
        await this.db.createTable(this.tableName, schema);
        this.table = await this.db.openTable(this.tableName);
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
      }));
      
      await this.table.add(records);
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
        },
        score: r._distance ?? 0,
      }));
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
  
  static async load(projectRoot: string): Promise<VectorDB> {
    const db = new VectorDB(projectRoot);
    await db.initialize();
    return db;
  }
}

