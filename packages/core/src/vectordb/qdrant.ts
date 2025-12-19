import { QdrantClient } from '@qdrant/js-client-rest';
import crypto from 'crypto';
import path from 'path';
import { SearchResult, VectorDBInterface } from './types.js';
import { ChunkMetadata } from '../indexer/types.js';
import { EMBEDDING_DIMENSION } from '../embeddings/types.js';
import { calculateRelevance } from './relevance.js';
import { DatabaseError } from '../errors/index.js';

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
  private initialized: boolean = false;

  constructor(
    url: string,
    apiKey: string | undefined,
    orgId: string,
    projectRoot: string
  ) {
    this.client = new QdrantClient({
      url,
      apiKey, // Optional, required for Qdrant Cloud
    });
    this.orgId = orgId;
    this.repoId = this.extractRepoId(projectRoot);
    // Collection naming: one per org
    this.collectionName = `lien_org_${orgId}`;
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
   * Transform chunk metadata to Qdrant payload format.
   */
  private metadataToPayload(metadata: ChunkMetadata): Record<string, any> {
    return {
      content: '', // Will be set separately
      file: metadata.file,
      startLine: metadata.startLine,
      endLine: metadata.endLine,
      type: metadata.type,
      language: metadata.language,
      // Symbols
      functionNames: metadata.symbols?.functions || [],
      classNames: metadata.symbols?.classes || [],
      interfaceNames: metadata.symbols?.interfaces || [],
      // AST-derived metadata
      symbolName: metadata.symbolName || '',
      symbolType: metadata.symbolType || '',
      parentClass: metadata.parentClass || '',
      complexity: metadata.complexity || 0,
      cognitiveComplexity: metadata.cognitiveComplexity || 0,
      parameters: metadata.parameters || [],
      signature: metadata.signature || '',
      imports: metadata.imports || [],
      // Halstead metrics
      halsteadVolume: metadata.halsteadVolume || 0,
      halsteadDifficulty: metadata.halsteadDifficulty || 0,
      halsteadEffort: metadata.halsteadEffort || 0,
      halsteadBugs: metadata.halsteadBugs || 0,
      // Multi-tenant fields
      orgId: this.orgId,
      repoId: this.repoId,
    };
  }

  /**
   * Transform Qdrant payload back to ChunkMetadata.
   */
  private payloadToMetadata(payload: Record<string, any>): ChunkMetadata {
    return {
      file: payload.file,
      startLine: payload.startLine,
      endLine: payload.endLine,
      type: payload.type,
      language: payload.language,
      symbols: {
        functions: payload.functionNames || [],
        classes: payload.classNames || [],
        interfaces: payload.interfaceNames || [],
      },
      symbolName: payload.symbolName || undefined,
      symbolType: payload.symbolType || undefined,
      parentClass: payload.parentClass || undefined,
      complexity: payload.complexity || undefined,
      cognitiveComplexity: payload.cognitiveComplexity || undefined,
      parameters: payload.parameters || undefined,
      signature: payload.signature || undefined,
      imports: payload.imports || undefined,
      halsteadVolume: payload.halsteadVolume || undefined,
      halsteadDifficulty: payload.halsteadDifficulty || undefined,
      halsteadEffort: payload.halsteadEffort || undefined,
      halsteadBugs: payload.halsteadBugs || undefined,
      repoId: payload.repoId || undefined,
      orgId: payload.orgId || undefined,
    };
  }

  async initialize(): Promise<void> {
    try {
      // Check if collection exists
      const collectionExists = await this.client.collectionExists(this.collectionName);
      
      if (!collectionExists) {
        // Create collection with proper vector configuration
        await this.client.createCollection(this.collectionName, {
          vectors: {
            size: EMBEDDING_DIMENSION,
            distance: 'Cosine',
          },
        });
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
        const payload = this.metadataToPayload(metadata);
        payload.content = contents[i]; // Add content to payload
        
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
      // Search with tenant isolation (filter by orgId and repoId)
      const results = await this.client.search(this.collectionName, {
        vector: Array.from(queryVector),
        limit,
        filter: {
          must: [
            { key: 'orgId', match: { value: this.orgId } },
            { key: 'repoId', match: { value: this.repoId } },
          ],
        },
      });

      return results.map(result => ({
        content: (result.payload?.content as string) || '',
        metadata: this.payloadToMetadata(result.payload || {}),
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
   */
  async searchCrossRepo(
    queryVector: Float32Array,
    limit: number = 5,
    repoIds?: string[]
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

      const results = await this.client.search(this.collectionName, {
        vector: Array.from(queryVector),
        limit,
        filter,
      });

      return results.map(result => ({
        content: (result.payload?.content as string) || '',
        metadata: this.payloadToMetadata(result.payload || {}),
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
    if (!this.initialized) {
      throw new DatabaseError('Qdrant database not initialized');
    }

    try {
      const filter: any = {
        must: [
          { key: 'orgId', match: { value: this.orgId } },
          { key: 'repoId', match: { value: this.repoId } },
        ],
      };

      if (options.language) {
        filter.must.push({ key: 'language', match: { value: options.language } });
      }

      if (options.pattern) {
        // Qdrant supports regex in match filters
        filter.must.push({ key: 'file', match: { text: options.pattern } });
      }

      const limit = options.limit || 100;
      const results = await this.client.scroll(this.collectionName, {
        filter,
        limit,
        with_payload: true,
        with_vector: false,
      });

      return (results.points || []).map(point => ({
        content: (point.payload?.content as string) || '',
        metadata: this.payloadToMetadata(point.payload || {}),
        score: 0, // No relevance score for filtered scans
        relevance: 'not_relevant' as const,
      }));
    } catch (error) {
      throw new DatabaseError(
        `Failed to scan Qdrant: ${error instanceof Error ? error.message : String(error)}`,
        { collectionName: this.collectionName }
      );
    }
  }

  async querySymbols(options: {
    language?: string;
    pattern?: string;
    symbolType?: 'function' | 'class' | 'interface';
    limit?: number;
  }): Promise<SearchResult[]> {
    if (!this.initialized) {
      throw new DatabaseError('Qdrant database not initialized');
    }

    try {
      const filter: any = {
        must: [
          { key: 'orgId', match: { value: this.orgId } },
          { key: 'repoId', match: { value: this.repoId } },
        ],
      };

      if (options.language) {
        filter.must.push({ key: 'language', match: { value: options.language } });
      }

      if (options.symbolType) {
        filter.must.push({ key: 'symbolType', match: { value: options.symbolType } });
      }

      if (options.pattern) {
        filter.must.push({ key: 'symbolName', match: { text: options.pattern } });
      }

      const limit = options.limit || 100;
      const results = await this.client.scroll(this.collectionName, {
        filter,
        limit,
        with_payload: true,
        with_vector: false,
      });

      return (results.points || []).map(point => ({
        content: (point.payload?.content as string) || '',
        metadata: this.payloadToMetadata(point.payload || {}),
        score: 0,
        relevance: 'not_relevant' as const,
      }));
    } catch (error) {
      throw new DatabaseError(
        `Failed to query symbols in Qdrant: ${error instanceof Error ? error.message : String(error)}`,
        { collectionName: this.collectionName }
      );
    }
  }

  async clear(): Promise<void> {
    if (!this.initialized) {
      throw new DatabaseError('Qdrant database not initialized');
    }

    try {
      // Delete all points in the collection
      await this.client.delete(this.collectionName, {
        filter: {
          must: [
            { key: 'orgId', match: { value: this.orgId } },
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
}

