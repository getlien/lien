import { QdrantClient } from '@qdrant/js-client-rest';
import crypto from 'crypto';
import path from 'path';
import os from 'os';
import type { SearchResult, VectorDBInterface } from './types.js';
import type { ChunkMetadata } from '../indexer/types.js';
import { EMBEDDING_DIMENSION } from '../embeddings/types.js';
import { DatabaseError } from '../errors/index.js';
import { readVersionFile } from './version.js';
import { QdrantPayloadMapper } from './qdrant-payload-mapper.js';
import { extractRepoId } from '../utils/repo-id.js';
import {
  QdrantFilterBuilder,
  validateFilterOptions,
  type QdrantFilter,
} from './qdrant-filter-builder.js';
import * as queryOps from './qdrant-query.js';
import * as batchOps from './qdrant-batch-insert.js';
import * as maintenanceOps from './qdrant-maintenance.js';

export { validateFilterOptions } from './qdrant-filter-builder.js';

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
  public readonly supportsCrossRepo = true;
  private lastVersionCheck: number = 0;
  private currentVersion: number = 0;
  private payloadMapper: QdrantPayloadMapper;

  constructor(
    url: string,
    apiKey: string | undefined,
    orgId: string,
    projectRoot: string,
    branch: string,
    commitSha: string,
  ) {
    this.client = new QdrantClient({
      url,
      apiKey, // Optional, required for Qdrant Cloud
    });
    this.orgId = orgId;
    this.repoId = extractRepoId(projectRoot);
    this.branch = branch;
    this.commitSha = commitSha;
    // Collection naming: one per org
    this.collectionName = `lien_org_${orgId}`;

    // Initialize payload mapper
    this.payloadMapper = new QdrantPayloadMapper(
      this.orgId,
      this.repoId,
      this.branch,
      this.commitSha,
    );

    // dbPath is used for manifest and version files (stored locally even with Qdrant)
    // Use same path structure as LanceDB for consistency
    const projectName = path.basename(projectRoot);
    const pathHash = crypto.createHash('md5').update(projectRoot).digest('hex').substring(0, 8);
    this.dbPath = path.join(os.homedir(), '.lien', 'indices', `${projectName}-${pathHash}`);
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
   */
  private buildBaseFilter(options: {
    file?: string | string[];
    language?: string;
    pattern?: string;
    symbolType?: 'function' | 'method' | 'class' | 'interface';
    repoIds?: string[];
    branch?: string;
    includeCurrentRepo?: boolean;
    patternKey?: 'file' | 'symbolName';
  }): QdrantFilter {
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

    if (options.language !== undefined) {
      builder.addLanguage(options.language);
    }

    if (options.symbolType !== undefined) {
      builder.addSymbolTypeFilter(options.symbolType);
    }

    if (options.pattern !== undefined) {
      builder.addPattern(options.pattern, options.patternKey);
    }

    // Only add branch filter when includeCurrentRepo is false
    // When includeCurrentRepo is true, branch is already added via addRepoContext
    if (options.branch !== undefined && options.includeCurrentRepo === false) {
      builder.addBranch(options.branch);
    }

    if (options.file !== undefined) {
      builder.addFileFilter(options.file);
    }

    return builder.build();
  }

  /** Build the query context object shared by query sub-module functions. */
  private get queryCtx(): queryOps.QdrantQueryContext {
    return {
      client: this.client,
      collectionName: this.collectionName,
      orgId: this.orgId,
      repoId: this.repoId,
      branch: this.branch,
      commitSha: this.commitSha,
      initialized: this.initialized,
      payloadMapper: this.payloadMapper,
      buildBaseFilter: this.buildBaseFilter.bind(this),
    };
  }

  /** Build the maintenance context object shared by maintenance sub-module functions. */
  private get maintenanceCtx(): maintenanceOps.QdrantMaintenanceContext {
    return {
      client: this.client,
      collectionName: this.collectionName,
      orgId: this.orgId,
      repoId: this.repoId,
      branch: this.branch,
      commitSha: this.commitSha,
      initialized: this.initialized,
      dbPath: this.dbPath,
    };
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
        { collectionName: this.collectionName },
      );
    }
  }

  async insertBatch(
    vectors: Float32Array[],
    metadatas: ChunkMetadata[],
    contents: string[],
  ): Promise<void> {
    batchOps.validateBatchInputs(this.initialized, vectors, metadatas, contents);

    if (vectors.length === 0) {
      return; // No-op for empty batches
    }

    try {
      const points = batchOps.preparePoints(
        vectors,
        metadatas,
        contents,
        this.payloadMapper,
        this.generatePointId.bind(this),
      );
      await batchOps.insertBatch(this.client, this.collectionName, points);
    } catch (error) {
      throw new DatabaseError(
        `Failed to insert batch into Qdrant: ${error instanceof Error ? error.message : String(error)}`,
        { collectionName: this.collectionName },
      );
    }
  }

  async search(
    queryVector: Float32Array,
    limit: number = 5,
    _query?: string, // Optional query string (not used in vector search, but kept for interface compatibility)
  ): Promise<SearchResult[]> {
    return queryOps.search(this.queryCtx, queryVector, limit);
  }

  async searchCrossRepo(
    queryVector: Float32Array,
    limit: number = 5,
    options?: {
      repoIds?: string[];
      branch?: string;
    },
  ): Promise<SearchResult[]> {
    return queryOps.searchCrossRepo(this.queryCtx, queryVector, limit, options);
  }

  async scanWithFilter(options: {
    file?: string | string[];
    language?: string;
    pattern?: string;
    symbolType?: 'function' | 'method' | 'class' | 'interface';
    limit?: number;
  }): Promise<SearchResult[]> {
    return queryOps.scanWithFilter(this.queryCtx, options);
  }

  async scanAll(
    options: {
      language?: string;
      pattern?: string;
    } = {},
  ): Promise<SearchResult[]> {
    return queryOps.scanAll(this.queryCtx, options);
  }

  async *scanPaginated(
    options: {
      pageSize?: number;
    } = {},
  ): AsyncGenerator<SearchResult[]> {
    yield* queryOps.scanPaginated(this.queryCtx, options);
  }

  async scanCrossRepo(options: {
    language?: string;
    pattern?: string;
    limit?: number;
    repoIds?: string[];
    branch?: string;
  }): Promise<SearchResult[]> {
    return queryOps.scanCrossRepo(this.queryCtx, options);
  }

  async querySymbols(options: {
    language?: string;
    pattern?: string;
    symbolType?: 'function' | 'method' | 'class' | 'interface';
    limit?: number;
  }): Promise<SearchResult[]> {
    return queryOps.querySymbols(this.queryCtx, options);
  }

  async clear(): Promise<void> {
    return maintenanceOps.clear(this.maintenanceCtx);
  }

  async clearBranch(branch?: string): Promise<void> {
    return maintenanceOps.clearBranch(this.maintenanceCtx, branch);
  }

  async deleteByFile(filepath: string): Promise<void> {
    return maintenanceOps.deleteByFile(this.maintenanceCtx, filepath);
  }

  async updateFile(
    filepath: string,
    vectors: Float32Array[],
    metadatas: ChunkMetadata[],
    contents: string[],
  ): Promise<void> {
    return maintenanceOps.updateFile(
      this.maintenanceCtx,
      filepath,
      this.deleteByFile.bind(this),
      this.insertBatch.bind(this),
      vectors,
      metadatas,
      contents,
    );
  }

  async hasData(): Promise<boolean> {
    return maintenanceOps.hasData(this.maintenanceCtx);
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
    const result = await maintenanceOps.checkVersion(
      this.dbPath,
      this.lastVersionCheck,
      this.currentVersion,
    );
    this.lastVersionCheck = result.newLastCheck;
    this.currentVersion = result.newVersion;
    return result.changed;
  }

  async reconnect(): Promise<void> {
    try {
      // For Qdrant, reconnection just means re-reading the version
      // The client connection is stateless, so we just need to refresh version cache
      await this.initialize();
    } catch (error) {
      throw new DatabaseError(
        `Failed to reconnect to Qdrant database: ${error instanceof Error ? error.message : String(error)}`,
        { collectionName: this.collectionName },
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
