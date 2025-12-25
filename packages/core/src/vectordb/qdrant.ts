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
 * Qdrant filter types for stronger type-safety when constructing filters.
 */
interface QdrantMatch {
  value?: string | number | boolean;
  text?: string;
  any?: string[];
}

interface QdrantCondition {
  key: string;
  match: QdrantMatch;
}

interface QdrantFilter {
  must: QdrantCondition[];
  should?: QdrantCondition[];
  must_not?: QdrantCondition[];
}

/**
 * Builder class for constructing Qdrant filters.
 * Simplifies filter construction and reduces complexity.
 */
class QdrantFilterBuilder {
  private filter: QdrantFilter;

  constructor(orgId: string) {
    this.filter = {
      must: [{ key: 'orgId', match: { value: orgId } }],
    };
  }

  addRepoContext(repoId: string, branch: string, commitSha: string): this {
    this.filter.must.push(
      { key: 'repoId', match: { value: repoId } },
      { key: 'branch', match: { value: branch } },
      { key: 'commitSha', match: { value: commitSha } }
    );
    return this;
  }

  addRepoIds(repoIds: string[]): this {
    const cleanedRepoIds = repoIds
      .map(id => id.trim())
      .filter(id => id.length > 0);

    // If caller passed repoIds but all were empty/invalid after cleaning,
    // fail fast instead of silently dropping the repoId filter (which would
    // otherwise widen the query to all repos in the org).
    if (repoIds.length > 0 && cleanedRepoIds.length === 0) {
      throw new Error(
        'Invalid repoIds: all provided repoIds are empty or whitespace. ' +
        'Provide at least one non-empty repoId or omit repoIds entirely.'
      );
    }

    if (cleanedRepoIds.length > 0) {
      this.filter.must.push({
        key: 'repoId',
        match: { any: cleanedRepoIds },
      });
    }
    return this;
  }

  addLanguage(language: string): this {
    const cleanedLanguage = language.trim();
    if (cleanedLanguage.length === 0) {
      throw new Error(
        'Invalid language: language must be a non-empty, non-whitespace string.'
      );
    }
    this.filter.must.push({ key: 'language', match: { value: cleanedLanguage } });
    return this;
  }

  addSymbolType(symbolType: string): this {
    const cleanedSymbolType = symbolType.trim();
    if (cleanedSymbolType.length === 0) {
      throw new Error(
        'Invalid symbolType: symbolType must be a non-empty, non-whitespace string.'
      );
    }
    this.filter.must.push({ key: 'symbolType', match: { value: cleanedSymbolType } });
    return this;
  }

  addPattern(pattern: string, key: 'file' | 'symbolName' = 'file'): this {
    const cleanedPattern = pattern.trim();
    if (cleanedPattern.length === 0) {
      throw new Error(
        'Invalid pattern: pattern must be a non-empty, non-whitespace string.'
      );
    }
    this.filter.must.push({ key, match: { text: cleanedPattern } });
    return this;
  }

  addBranch(branch: string): this {
    const cleanedBranch = branch.trim();
    // Prevent constructing a filter for an empty/whitespace-only branch,
    // which would search for `branch == ""` and almost certainly return no results.
    if (cleanedBranch.length === 0) {
      throw new Error(
        'Invalid branch: branch must be a non-empty, non-whitespace string.'
      );
    }
    this.filter.must.push({ key: 'branch', match: { value: cleanedBranch } });
    return this;
  }

  build(): QdrantFilter {
    return this.filter;
  }
}

/**
 * Validate filter options for buildBaseFilter.
 * 
 * This is a separate function to enable unit testing of validation logic.
 * The validations ensure that conflicting options are not used together.
 * 
 * @param options - Filter options to validate
 * @throws Error if conflicting options are detected
 */
export function validateFilterOptions(options: {
  repoIds?: string[];
  branch?: string;
  includeCurrentRepo?: boolean;
}): void {
  // Validate: includeCurrentRepo and repoIds are mutually exclusive
  // Note: `includeCurrentRepo !== false` treats undefined as "enabled" (default behavior).
  // Callers must explicitly pass includeCurrentRepo=false when using repoIds for cross-repo queries.
  if (options.includeCurrentRepo !== false && options.repoIds && options.repoIds.length > 0) {
    throw new Error(
      'Cannot use repoIds when includeCurrentRepo is enabled (the default). ' +
      'These options are mutually exclusive. Set includeCurrentRepo=false to perform cross-repo queries with repoIds.'
    );
  }

  // Validate: branch parameter should only be used when includeCurrentRepo is false.
  // As above, `includeCurrentRepo !== false` treats both undefined and true as "enabled"
  // for the current repo context, so callers must explicitly pass false for cross-repo.
  if (options.branch && options.includeCurrentRepo !== false) {
    throw new Error(
      'Cannot use branch parameter when includeCurrentRepo is enabled (the default). ' +
      'Branch is automatically included via the current repo context. Set includeCurrentRepo=false to specify a branch explicitly.'
    );
  }
}

/**
 * QdrantDB implements VectorDBInterface using Qdrant vector database.
 * 
 * Features:
 * - Multi-tenant support via payload filtering (orgId/repoId)
 * - Branch and commit isolation for PR workflows
 * - Collection naming: `lien_org_{orgId}`
 * - Cross-repo search by omitting repoId filter
 * - Tenant isolation via orgId filtering
 * - Point ID generation includes branch/commit to prevent collisions
 * 
 * Data Isolation:
 * All queries are filtered by orgId, repoId, branch, and commitSha by default.
 * This ensures that different branches and commits have isolated data, preventing
 * PRs from overwriting each other's indices. Use cross-repo methods (searchCrossRepo,
 * scanCrossRepo) to query across repositories within an organization.
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
   * Uses hash of file path + line range + branch + commitSha for stable identification.
   * Includes branch/commit to prevent ID collisions across branches.
   * 
   * **Hash Algorithm Choice:**
   * Uses MD5 for performance and collision likelihood acceptable for this use case.
   * - MD5 is deprecated for cryptographic purposes but suitable for non-security ID generation
   * - Collision probability is extremely low: ~1 in 2^64 for random inputs
   * - Input includes file path, line range, branch, and commit SHA, making collisions
   *   even less likely in practice
   * - For typical codebases (thousands to hundreds of thousands of chunks), collision risk
   *   is negligible
   * - If scaling to millions of chunks across many repos, consider upgrading to SHA-256
   *   for additional collision resistance (at ~10% performance cost)
   */
  private generatePointId(metadata: ChunkMetadata): string {
    const idString = `${metadata.file}:${metadata.startLine}:${metadata.endLine}:${this.branch}:${this.commitSha}`;
    return crypto.createHash('md5').update(idString).digest('hex');
  }

  /**
   * Build base filter for Qdrant queries.
   * Uses builder pattern to simplify filter construction.
   * 
   * **Important constraints:**
   * - `includeCurrentRepo` and `repoIds` are mutually exclusive.
   * - `includeCurrentRepo` defaults to `true` when `undefined` (treats `undefined` as "enabled").
   * - To use `repoIds` for cross-repo queries, you must explicitly pass `includeCurrentRepo: false`.
   * - The `branch` parameter can only be used when `includeCurrentRepo` is explicitly `false`.
   *   When `includeCurrentRepo` is enabled (default), branch is automatically included via
   *   the current repo context (`addRepoContext`).
   * 
   * @param options - Filter options
   * @param options.includeCurrentRepo - Whether to filter by current repo context (default: true when undefined).
   *   Must be explicitly `false` to use `repoIds` or `branch` parameters.
   * @param options.repoIds - Repository IDs to filter by (requires `includeCurrentRepo: false`).
   * @param options.branch - Branch name to filter by (requires `includeCurrentRepo: false`).
   * @returns Qdrant filter object
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
    // Validate filter options (extracted to enable unit testing)
    validateFilterOptions({
      repoIds: options.repoIds,
      branch: options.branch,
      includeCurrentRepo: options.includeCurrentRepo,
    });

    const builder = new QdrantFilterBuilder(this.orgId);

    if (options.includeCurrentRepo !== false) {
      builder.addRepoContext(this.repoId, this.branch, this.commitSha);
    }

    if (options.repoIds) {
      builder.addRepoIds(options.repoIds);
    }

    // Validate language is non-empty if explicitly provided (even if empty string)
    if (options.language !== undefined) {
      builder.addLanguage(options.language);
    }

    // Validate symbolType is non-empty if explicitly provided (even if empty string)
    if (options.symbolType !== undefined) {
      builder.addSymbolType(options.symbolType);
    }

    // Validate pattern is non-empty if explicitly provided (even if empty string)
    if (options.pattern !== undefined) {
      builder.addPattern(options.pattern, options.patternKey);
    }

    // Only add branch filter when includeCurrentRepo is false
    // When includeCurrentRepo is true, branch is already added via addRepoContext
    // Validate branch is non-empty if explicitly provided (even if empty string)
    if (options.branch !== undefined && options.includeCurrentRepo === false) {
      // addBranch will validate that branch is non-empty and non-whitespace
      builder.addBranch(options.branch);
    }

    return builder.build();
  }

  /**
   * Map Qdrant scroll results to SearchResult format.
   *
   * Note: Scroll/scan operations do not compute semantic similarity scores.
   * For these results, score is always 0 and relevance is set to 'not_relevant'
   * to indicate that the results are unscored (not that they are useless).
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

  /**
   * Validate batch input arrays have matching lengths.
   */
  private validateBatchInputs(
    vectors: Float32Array[],
    metadatas: ChunkMetadata[],
    contents: string[]
  ): void {
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
  }

  /**
   * Prepare Qdrant points from vectors, metadatas, and contents.
   */
  private preparePoints(
    vectors: Float32Array[],
    metadatas: ChunkMetadata[],
    contents: string[]
  ): Array<{ id: string; vector: number[]; payload: Record<string, any> }> {
    return vectors.map((vector, i) => {
      const metadata = metadatas[i];
      const payload = this.payloadMapper.toPayload(metadata, contents[i]) as Record<string, any>;
      
      return {
        id: this.generatePointId(metadata),
        vector: Array.from(vector),
        payload,
      };
    });
  }

  async insertBatch(
    vectors: Float32Array[],
    metadatas: ChunkMetadata[],
    contents: string[]
  ): Promise<void> {
    this.validateBatchInputs(vectors, metadatas, contents);

    if (vectors.length === 0) {
      return; // No-op for empty batches
    }

    try {
      const points = this.preparePoints(vectors, metadatas, contents);

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
   *
   * - Omits repoId filter by default to enable true cross-repo queries.
   * - When repoIds are provided, restricts results to those repositories only.
   * - When branch is omitted, returns chunks from all branches and commits
   *   (including historical PR branches and stale commits).
   * - When branch is provided, filters by branch name only and still returns
   *   chunks from all commits on that branch across the selected repos.
   *
   * This is a low-level primitive for cross-repo augmentation. Higher-level
   * workflows (e.g. \"latest commit only\") should be built on top of this API.
   *
   * @param queryVector - Query vector for semantic search
   * @param limit - Maximum number of results to return (default: 5)
   * @param options - Optional search options
   * @param options.repoIds - Repository IDs to filter by (optional)
   * @param options.branch - Branch name to filter by (optional)
   */
  async searchCrossRepo(
    queryVector: Float32Array,
    limit: number = 5,
    options?: {
      repoIds?: string[];
      branch?: string;
    }
  ): Promise<SearchResult[]> {
    if (!this.initialized) {
      throw new DatabaseError('Qdrant database not initialized');
    }

    try {
      // Use buildBaseFilter for consistency with scanCrossRepo and other methods
      // This provides automatic validation for empty repoIds arrays, whitespace-only branches, etc.
      const filter = this.buildBaseFilter({
        includeCurrentRepo: false,
        repoIds: options?.repoIds,
        branch: options?.branch,
      });

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
   *
   * - Omits repoId filter by default to enable true cross-repo scans.
   * - When repoIds are provided, restricts results to those repositories only.
   * - When branch is omitted, returns chunks from all branches and commits
   *   (including historical PR branches and stale commits).
   * - When branch is provided, filters by branch name only and still returns
   *   chunks from all commits on that branch across the selected repos.
   *
   * Like searchCrossRepo, this is a low-level primitive. Higher-level behavior
   * such as \"latest commit only\" should be implemented in orchestrating code.
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

  /**
   * Clear all data for a specific branch (all commits).
   *
   * Qdrant-only helper: this is not part of the generic VectorDBInterface and
   * is intended for cloud/PR workflows where multiple commits exist per branch.
   * LanceDB and other backends do not implement this method.
   *
   * @param branch - Branch name to clear (defaults to current branch)
   */
  async clearBranch(branch?: string): Promise<void> {
    if (!this.initialized) {
      throw new DatabaseError('Qdrant database not initialized');
    }

    const targetBranch = branch ?? this.branch;

    try {
      const collectionCheck = await this.client.collectionExists(this.collectionName);
      if (!collectionCheck.exists) {
        // Collection doesn't exist yet, nothing to clear
        return;
      }

      // Delete all points for this repository and branch (all commits)
      await this.client.delete(this.collectionName, {
        filter: {
          must: [
            { key: 'orgId', match: { value: this.orgId } },
            { key: 'repoId', match: { value: this.repoId } },
            { key: 'branch', match: { value: targetBranch } },
          ],
        },
      });
    } catch (error) {
      throw new DatabaseError(
        `Failed to clear branch from Qdrant: ${error instanceof Error ? error.message : String(error)}`,
        { collectionName: this.collectionName, branch: targetBranch }
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

