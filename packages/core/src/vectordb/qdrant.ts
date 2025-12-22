import { QdrantClient } from '@qdrant/js-client-rest';
import crypto from 'crypto';
import path from 'path';
import os from 'os';
import { SearchResult, VectorDBInterface } from './types.js';
import { ChunkMetadata } from '../indexer/types.js';
import { EMBEDDING_DIMENSION } from '../embeddings/types.js';
import { calculateRelevance } from './relevance.js';
import { DatabaseError } from '../errors/index.js';
import { readVersionFile } from './version.js';
import { QdrantPayloadMapper } from './qdrant-payload-mapper.js';

/**
 * QdrantDB implements VectorDBInterface using Qdrant vector database.
 * 
 * Features:
 * - Multi-tenant support via payload filtering (orgId/repoId)
 * - Collection naming: `lien_org_{orgId}`
 * - Cross-repo search by omitting repoId filter
 * - Tenant isolation via orgId filtering
 */
export class QdrantDB implements VectorDBInterface {
  private client: QdrantClient;
  private collectionName: string;
  private orgId: string;
  private repoId: string;
  private branch: string;
  private commitSha: string;
  private initialized: boolean = false;
  public readonly dbPath: string; // For compatibility with manifest/version file operations
  private lastVersionCheck: number = 0;
  private currentVersion: number = 0;
  private payloadMapper: QdrantPayloadMapper;

  constructor(
    url: string,
    apiKey: string | undefined,
    orgId: string,
    projectRoot: string,
    branch: string,
    commitSha: string
  ) {
    this.client = new QdrantClient({
      url,
      apiKey, // Optional, required for Qdrant Cloud
    });
    this.orgId = orgId;
    this.repoId = this.extractRepoId(projectRoot);
    this.branch = branch;
    this.commitSha = commitSha;
    // Collection naming: one per org
    this.collectionName = `lien_org_${orgId}`;
    
    // Initialize payload mapper
    this.payloadMapper = new QdrantPayloadMapper(this.orgId, this.repoId, this.branch, this.commitSha);
    
    // dbPath is used for manifest and version files (stored locally even with Qdrant)
    // Use same path structure as LanceDB for consistency
    const projectName = path.basename(projectRoot);
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

  /**
   * Extract repository identifier from project root.
   * Uses project name + path hash for stable, unique identification.
   */
  private extractRepoId(projectRoot: string): string {
    const projectName = path.basename(projectRoot);
    const pathHash = crypto
      .createHash('md5')
      .update(projectRoot)
      .digest('hex')
      .substring(0, 8);
    return `${projectName}-${pathHash}`;
  }

  /**
   * Generate a unique point ID from chunk metadata.
   * Uses hash of file path + line range for stable identification.
   */
  private generatePointId(metadata: ChunkMetadata): string {
    const idString = `${metadata.file}:${metadata.startLine}:${metadata.endLine}`;
    return crypto.createHash('md5').update(idString).digest('hex');
  }

  /**
   * Build base filter for Qdrant queries.
   * Handles common filtering logic for orgId, repoId, branch, commitSha, and optional filters.
   */
  private buildBaseFilter(options: {
    language?: string;
    pattern?: string;
    symbolType?: 'function' | 'class' | 'interface';
    repoIds?: string[];
    branch?: string;
    includeCurrentRepo?: boolean;
    patternKey?: 'file' | 'symbolName';
  }): any {
    const filter: any = {
      must: [{ key: 'orgId', match: { value: this.orgId } }],
    };

    // Include current repo filters (repoId, branch, commitSha) unless explicitly disabled
    if (options.includeCurrentRepo !== false) {
      filter.must.push(
        { key: 'repoId', match: { value: this.repoId } },
        { key: 'branch', match: { value: this.branch } },
        { key: 'commitSha', match: { value: this.commitSha } }
      );
    }

    // Optionally filter to specific repos (for cross-repo queries)
    if (options.repoIds && options.repoIds.length > 0) {
      filter.must.push({
        key: 'repoId',
        match: { any: options.repoIds },
      });
    }

    // Optional filters
    if (options.language) {
      filter.must.push({ key: 'language', match: { value: options.language } });
    }

    if (options.symbolType) {
      filter.must.push({ key: 'symbolType', match: { value: options.symbolType } });
    }

    if (options.pattern) {
      const key = options.patternKey || 'file';
      filter.must.push({ key, match: { text: options.pattern } });
    }

    // Optional branch filter (for cross-repo queries)
    if (options.branch) {
      filter.must.push({
        key: 'branch',
        match: { value: options.branch },
      });
    }

    return filter;
  }

  /**
   * Map Qdrant scroll results to SearchResult format.
   */
  private mapScrollResults(results: any): SearchResult[] {
    return (results.points || []).map((point: any) => ({
      content: (point.payload?.content as string) || '',
      metadata: this.payloadMapper.fromPayload(point.payload || {}),
      score: 0,
      relevance: 'not_relevant' as const,
    }));
  }

  /**
   * Execute a scroll query with error handling.
   */
  private async executeScrollQuery(
    filter: any,
    limit: number,
    errorContext: string
  ): Promise<SearchResult[]> {
    if (!this.initialized) {
      throw new DatabaseError('Qdrant database not initialized');
    }

    try {
      const results = await this.client.scroll(this.collectionName, {
        filter,
        limit,
        with_payload: true,
        with_vector: false,
      });

      return this.mapScrollResults(results);
    } catch (error) {
      throw new DatabaseError(
        `Failed to ${errorContext}: ${error instanceof Error ? error.message : String(error)}`,
        { collectionName: this.collectionName }
      );
    }
  }


  async initialize(): Promise<void> {
    try {
      // Check if collection exists (returns { exists: boolean })
      const collectionCheck = await this.client.collectionExists(this.collectionName);
      
      if (!collectionCheck.exists) {
        // Create collection with proper vector configuration
        await this.client.createCollection(this.collectionName, {
          vectors: {
            size: EMBEDDING_DIMENSION,
            distance: 'Cosine',
          },
        });
      }
      
      // Read and cache the current version
      try {
        this.currentVersion = await readVersionFile(this.dbPath);
      } catch {
        // Version file doesn't exist yet, will be created on first index
        this.currentVersion = 0;
      }
      
      this.initialized = true;
    } catch (error) {
      throw new DatabaseError(
        `Failed to initialize Qdrant database: ${error instanceof Error ? error.message : String(error)}`,
        { collectionName: this.collectionName }
      );
    }
  }

  async insertBatch(
    vectors: Float32Array[],
    metadatas: ChunkMetadata[],
    contents: string[]
  ): Promise<void> {
    if (!this.initialized) {
      throw new DatabaseError('Qdrant database not initialized');
    }

    if (vectors.length !== metadatas.length || vectors.length !== contents.length) {
      throw new DatabaseError('Vectors, metadatas, and contents arrays must have the same length', {
        vectorsLength: vectors.length,
        metadatasLength: metadatas.length,
        contentsLength: contents.length,
      });
    }

    if (vectors.length === 0) {
      return; // No-op for empty batches
    }

    try {
      // Prepare points for upsert
      const points = vectors.map((vector, i) => {
        const metadata = metadatas[i];
        const payload = this.payloadMapper.toPayload(metadata, contents[i]) as Record<string, any>;
        
        return {
          id: this.generatePointId(metadata),
          vector: Array.from(vector),
          payload,
        };
      });

      // Upsert points in batches (Qdrant recommends batches of 100-1000)
      const batchSize = 100;
      for (let i = 0; i < points.length; i += batchSize) {
        const batch = points.slice(i, Math.min(i + batchSize, points.length));
        await this.client.upsert(this.collectionName, {
          wait: true,
          points: batch,
        });
      }
    } catch (error) {
      throw new DatabaseError(
        `Failed to insert batch into Qdrant: ${error instanceof Error ? error.message : String(error)}`,
        { collectionName: this.collectionName }
      );
    }
  }

  async search(
    queryVector: Float32Array,
    limit: number = 5,
    _query?: string // Optional query string (not used in vector search, but kept for interface compatibility)
  ): Promise<SearchResult[]> {
    if (!this.initialized) {
      throw new DatabaseError('Qdrant database not initialized');
    }

    try {
      // Search with tenant isolation (filter by orgId, repoId, branch, and commitSha)
      const results = await this.client.search(this.collectionName, {
        vector: Array.from(queryVector),
        limit,
        filter: {
          must: [
            { key: 'orgId', match: { value: this.orgId } },
            { key: 'repoId', match: { value: this.repoId } },
            { key: 'branch', match: { value: this.branch } },
            { key: 'commitSha', match: { value: this.commitSha } },
          ],
        },
      });

      return results.map(result => ({
        content: (result.payload?.content as string) || '',
        metadata: this.payloadMapper.fromPayload(result.payload || {}),
        score: result.score || 0,
        relevance: calculateRelevance(result.score || 0),
      }));
    } catch (error) {
      throw new DatabaseError(
        `Failed to search Qdrant: ${error instanceof Error ? error.message : String(error)}`,
        { collectionName: this.collectionName }
      );
    }
  }

  /**
   * Search across all repos in the organization (cross-repo search).
   * Omits repoId filter to enable cross-repo queries.
   * Optionally filters by branch to search specific branch across repos.
   */
  async searchCrossRepo(
    queryVector: Float32Array,
    limit: number = 5,
    repoIds?: string[],
    branch?: string
  ): Promise<SearchResult[]> {
    if (!this.initialized) {
      throw new DatabaseError('Qdrant database not initialized');
    }

    try {
      const filter: any = {
        must: [
          { key: 'orgId', match: { value: this.orgId } },
        ],
      };

      // Optionally filter to specific repos
      if (repoIds && repoIds.length > 0) {
        filter.must.push({
          key: 'repoId',
          match: { any: repoIds },
        });
      }

      // Optionally filter by branch (e.g., only search main branch)
      if (branch) {
        filter.must.push({
          key: 'branch',
          match: { value: branch },
        });
      }

      const results = await this.client.search(this.collectionName, {
        vector: Array.from(queryVector),
        limit,
        filter,
      });

      return results.map(result => ({
        content: (result.payload?.content as string) || '',
        metadata: this.payloadMapper.fromPayload(result.payload || {}),
        score: result.score || 0,
        relevance: calculateRelevance(result.score || 0),
      }));
    } catch (error) {
      throw new DatabaseError(
        `Failed to search Qdrant (cross-repo): ${error instanceof Error ? error.message : String(error)}`,
        { collectionName: this.collectionName }
      );
    }
  }

  async scanWithFilter(options: {
    language?: string;
    pattern?: string;
    limit?: number;
  }): Promise<SearchResult[]> {
    const filter = this.buildBaseFilter({
      language: options.language,
      pattern: options.pattern,
      patternKey: 'file',
      includeCurrentRepo: true,
    });

    return this.executeScrollQuery(filter, options.limit || 100, 'scan Qdrant');
  }

  async scanAll(options: {
    language?: string;
    pattern?: string;
  } = {}): Promise<SearchResult[]> {
    // Use scanWithFilter with a high limit to get all chunks
    return this.scanWithFilter({
      ...options,
      limit: 100000, // High limit for "all" chunks
    });
  }

  /**
   * Scan with filter across all repos in the organization (cross-repo).
   * Omits repoId filter to enable cross-repo queries.
   * Optionally filters by branch to scan specific branch across repos.
   */
  async scanCrossRepo(options: {
    language?: string;
    pattern?: string;
    limit?: number;
    repoIds?: string[];
    branch?: string;
  }): Promise<SearchResult[]> {
    const filter = this.buildBaseFilter({
      language: options.language,
      pattern: options.pattern,
      patternKey: 'file',
      repoIds: options.repoIds,
      branch: options.branch,
      includeCurrentRepo: false, // Cross-repo: don't filter by current repo
    });

    return this.executeScrollQuery(
      filter,
      options.limit || 10000, // Higher default for cross-repo
      'scan Qdrant (cross-repo)'
    );
  }

  async querySymbols(options: {
    language?: string;
    pattern?: string;
    symbolType?: 'function' | 'class' | 'interface';
    limit?: number;
  }): Promise<SearchResult[]> {
    const filter = this.buildBaseFilter({
      language: options.language,
      pattern: options.pattern,
      patternKey: 'symbolName',
      symbolType: options.symbolType,
      includeCurrentRepo: true,
    });

    return this.executeScrollQuery(filter, options.limit || 100, 'query symbols in Qdrant');
  }

  async clear(): Promise<void> {
    if (!this.initialized) {
      throw new DatabaseError('Qdrant database not initialized');
    }

    try {
      // Check if collection exists before trying to clear it (returns { exists: boolean })
      const collectionCheck = await this.client.collectionExists(this.collectionName);
      if (!collectionCheck.exists) {
        // Collection doesn't exist yet, nothing to clear
        return;
      }

      // Delete all points for this repository and branch/commit only
      // This ensures we only clear the current branch's data, not all branches
      await this.client.delete(this.collectionName, {
        filter: {
          must: [
            { key: 'orgId', match: { value: this.orgId } },
            { key: 'repoId', match: { value: this.repoId } },
            { key: 'branch', match: { value: this.branch } },
            { key: 'commitSha', match: { value: this.commitSha } },
          ],
        },
      });
    } catch (error) {
      throw new DatabaseError(
        `Failed to clear Qdrant collection: ${error instanceof Error ? error.message : String(error)}`,
        { collectionName: this.collectionName }
      );
    }
  }

  async deleteByFile(filepath: string): Promise<void> {
    if (!this.initialized) {
      throw new DatabaseError('Qdrant database not initialized');
    }

    try {
      await this.client.delete(this.collectionName, {
        filter: {
          must: [
            { key: 'orgId', match: { value: this.orgId } },
            { key: 'repoId', match: { value: this.repoId } },
            { key: 'branch', match: { value: this.branch } },
            { key: 'commitSha', match: { value: this.commitSha } },
            { key: 'file', match: { value: filepath } },
          ],
        },
      });
    } catch (error) {
      throw new DatabaseError(
        `Failed to delete file from Qdrant: ${error instanceof Error ? error.message : String(error)}`,
        { collectionName: this.collectionName, filepath }
      );
    }
  }

  async updateFile(
    filepath: string,
    vectors: Float32Array[],
    metadatas: ChunkMetadata[],
    contents: string[]
  ): Promise<void> {
    if (!this.initialized) {
      throw new DatabaseError('Qdrant database not initialized');
    }

    if (vectors.length !== metadatas.length || vectors.length !== contents.length) {
      throw new DatabaseError('Vectors, metadatas, and contents arrays must have the same length');
    }

    try {
      // Delete existing chunks for this file
      await this.deleteByFile(filepath);

      // Insert new chunks
      if (vectors.length > 0) {
        await this.insertBatch(vectors, metadatas, contents);
      }
    } catch (error) {
      throw new DatabaseError(
        `Failed to update file in Qdrant: ${error instanceof Error ? error.message : String(error)}`,
        { collectionName: this.collectionName, filepath }
      );
    }
  }

  async hasData(): Promise<boolean> {
    if (!this.initialized) {
      return false;
    }

    try {
      const info = await this.client.getCollection(this.collectionName);
      return (info.points_count || 0) > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get the collection name (useful for debugging).
   */
  getCollectionName(): string {
    return this.collectionName;
  }

  /**
   * Get the organization ID.
   */
  getOrgId(): string {
    return this.orgId;
  }

  /**
   * Get the repository ID.
   */
  getRepoId(): string {
    return this.repoId;
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
      // For Qdrant, reconnection just means re-reading the version
      // The client connection is stateless, so we just need to refresh version cache
      await this.initialize();
    } catch (error) {
      throw new DatabaseError(
        `Failed to reconnect to Qdrant database: ${error instanceof Error ? error.message : String(error)}`,
        { collectionName: this.collectionName }
      );
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
}

