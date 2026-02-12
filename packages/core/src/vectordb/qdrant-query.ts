import type { QdrantClient } from '@qdrant/js-client-rest';
import type { SearchResult } from './types.js';
import type { QdrantPayloadMapper } from './qdrant-payload-mapper.js';
import { calculateRelevance } from './relevance.js';
import { DatabaseError } from '../errors/index.js';

/**
 * Shared context passed from QdrantDB to query functions.
 */
export interface QdrantQueryContext {
  client: QdrantClient;
  collectionName: string;
  orgId: string;
  repoId: string;
  branch: string;
  commitSha: string;
  initialized: boolean;
  payloadMapper: QdrantPayloadMapper;
  buildBaseFilter: (options: {
    file?: string | string[];
    language?: string;
    pattern?: string;
    symbolType?: 'function' | 'method' | 'class' | 'interface';
    repoIds?: string[];
    branch?: string;
    includeCurrentRepo?: boolean;
    patternKey?: 'file' | 'symbolName';
  }) => any;
}

/**
 * Map Qdrant scroll results to SearchResult format.
 *
 * Note: Scroll/scan operations do not compute semantic similarity scores.
 * For these results, score is always 0 and relevance is set to 'not_relevant'
 * to indicate that the results are unscored (not that they are useless).
 */
export function mapScrollResults(ctx: QdrantQueryContext, results: any): SearchResult[] {
  return (results.points || []).map((point: any) => ({
    content: (point.payload?.content as string) || '',
    metadata: ctx.payloadMapper.fromPayload(point.payload || {}),
    score: 0,
    relevance: 'not_relevant' as const,
  }));
}

/**
 * Execute a scroll query with error handling.
 */
export async function executeScrollQuery(
  ctx: QdrantQueryContext,
  filter: any,
  limit: number,
  errorContext: string,
): Promise<SearchResult[]> {
  if (!ctx.initialized) {
    throw new DatabaseError('Qdrant database not initialized');
  }

  try {
    const results = await ctx.client.scroll(ctx.collectionName, {
      filter,
      limit,
      with_payload: true,
      with_vector: false,
    });

    return mapScrollResults(ctx, results);
  } catch (error) {
    throw new DatabaseError(
      `Failed to ${errorContext}: ${error instanceof Error ? error.message : String(error)}`,
      { collectionName: ctx.collectionName },
    );
  }
}

/**
 * Search with tenant isolation (filter by orgId, repoId, branch, and commitSha).
 */
export async function search(
  ctx: QdrantQueryContext,
  queryVector: Float32Array,
  limit: number = 5,
): Promise<SearchResult[]> {
  if (!ctx.initialized) {
    throw new DatabaseError('Qdrant database not initialized');
  }

  try {
    const results = await ctx.client.search(ctx.collectionName, {
      vector: Array.from(queryVector),
      limit,
      filter: {
        must: [
          { key: 'orgId', match: { value: ctx.orgId } },
          { key: 'repoId', match: { value: ctx.repoId } },
          { key: 'branch', match: { value: ctx.branch } },
          { key: 'commitSha', match: { value: ctx.commitSha } },
        ],
      },
    });

    return results.map(result => ({
      content: (result.payload?.content as string) || '',
      metadata: ctx.payloadMapper.fromPayload(result.payload || {}),
      score: result.score || 0,
      relevance: calculateRelevance(result.score || 0),
    }));
  } catch (error) {
    throw new DatabaseError(
      `Failed to search Qdrant: ${error instanceof Error ? error.message : String(error)}`,
      { collectionName: ctx.collectionName },
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
 * workflows (e.g. "latest commit only") should be built on top of this API.
 */
export async function searchCrossRepo(
  ctx: QdrantQueryContext,
  queryVector: Float32Array,
  limit: number = 5,
  options?: {
    repoIds?: string[];
    branch?: string;
  },
): Promise<SearchResult[]> {
  if (!ctx.initialized) {
    throw new DatabaseError('Qdrant database not initialized');
  }

  try {
    const filter = ctx.buildBaseFilter({
      includeCurrentRepo: false,
      repoIds: options?.repoIds,
      branch: options?.branch,
    });

    const results = await ctx.client.search(ctx.collectionName, {
      vector: Array.from(queryVector),
      limit,
      filter,
    });

    return results.map(result => ({
      content: (result.payload?.content as string) || '',
      metadata: ctx.payloadMapper.fromPayload(result.payload || {}),
      score: result.score || 0,
      relevance: calculateRelevance(result.score || 0),
    }));
  } catch (error) {
    throw new DatabaseError(
      `Failed to search Qdrant (cross-repo): ${error instanceof Error ? error.message : String(error)}`,
      { collectionName: ctx.collectionName },
    );
  }
}

export async function scanWithFilter(
  ctx: QdrantQueryContext,
  options: {
    file?: string | string[];
    language?: string;
    pattern?: string;
    symbolType?: 'function' | 'method' | 'class' | 'interface';
    limit?: number;
  },
): Promise<SearchResult[]> {
  const filter = ctx.buildBaseFilter({
    file: options.file,
    language: options.language,
    pattern: options.pattern,
    symbolType: options.symbolType,
    patternKey: 'file',
    includeCurrentRepo: true,
  });

  return executeScrollQuery(ctx, filter, options.limit || 100, 'scan Qdrant');
}

export async function scanAll(
  ctx: QdrantQueryContext,
  options: {
    language?: string;
    pattern?: string;
  } = {},
): Promise<SearchResult[]> {
  if (!ctx.initialized) {
    throw new DatabaseError('Qdrant database not initialized');
  }

  const filter = ctx.buildBaseFilter({
    includeCurrentRepo: true,
    language: options.language,
    pattern: options.pattern,
    patternKey: 'file',
  });

  const allResults: SearchResult[] = [];
  for await (const page of scrollPaginated(ctx, filter, 1000)) {
    allResults.push(...page);
  }
  return allResults;
}

export async function* scanPaginated(
  ctx: QdrantQueryContext,
  options: {
    pageSize?: number;
  } = {},
): AsyncGenerator<SearchResult[]> {
  if (!ctx.initialized) {
    throw new DatabaseError('Qdrant database not initialized');
  }

  const pageSize = options.pageSize ?? 1000;
  if (pageSize <= 0) {
    throw new DatabaseError('pageSize must be a positive number');
  }
  const filter = ctx.buildBaseFilter({ includeCurrentRepo: true });
  yield* scrollPaginated(ctx, filter, pageSize);
}

/**
 * Internal paginated scroll helper. Both scanAll and scanPaginated delegate here
 * to keep scroll logic, error handling, and termination in one place.
 */
// Note: filter uses `any` to match buildBaseFilter/executeScrollQuery return type.
// The local QdrantFilter interface doesn't fully align with the @qdrant/js-client-rest SDK types.
async function* scrollPaginated(
  ctx: QdrantQueryContext,
  filter: any,
  pageSize: number,
): AsyncGenerator<SearchResult[]> {
  let offset: string | number | undefined;

  while (true) {
    let results;
    try {
      results = await ctx.client.scroll(ctx.collectionName, {
        filter,
        limit: pageSize,
        with_payload: true,
        with_vector: false,
        ...(offset !== undefined && { offset }),
      });
    } catch (error) {
      throw new DatabaseError(
        `Failed to scroll Qdrant collection: ${error instanceof Error ? error.message : String(error)}`,
        { originalError: error },
      );
    }

    const page = mapScrollResults(ctx, results);
    if (page.length > 0) {
      yield page;
    }

    offset = results.next_page_offset as string | number | undefined;
    if (offset == null) break;
  }
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
 * such as "latest commit only" should be implemented in orchestrating code.
 */
export async function scanCrossRepo(
  ctx: QdrantQueryContext,
  options: {
    language?: string;
    pattern?: string;
    limit?: number;
    repoIds?: string[];
    branch?: string;
  },
): Promise<SearchResult[]> {
  const filter = ctx.buildBaseFilter({
    language: options.language,
    pattern: options.pattern,
    patternKey: 'file',
    repoIds: options.repoIds,
    branch: options.branch,
    includeCurrentRepo: false, // Cross-repo: don't filter by current repo
  });

  return executeScrollQuery(
    ctx,
    filter,
    options.limit || 10000, // Higher default for cross-repo
    'scan Qdrant (cross-repo)',
  );
}

export async function querySymbols(
  ctx: QdrantQueryContext,
  options: {
    language?: string;
    pattern?: string;
    symbolType?: 'function' | 'method' | 'class' | 'interface';
    limit?: number;
  },
): Promise<SearchResult[]> {
  const filter = ctx.buildBaseFilter({
    language: options.language,
    pattern: options.pattern,
    patternKey: 'symbolName',
    symbolType: options.symbolType,
    includeCurrentRepo: true,
  });

  return executeScrollQuery(ctx, filter, options.limit || 100, 'query symbols in Qdrant');
}
