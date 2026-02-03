import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { ListFunctionsSchema } from '../schemas/index.js';
import type { ListFunctionsInput } from '../schemas/index.js';
import { shapeResults, deduplicateResults } from '../utils/metadata-shaper.js';
import type { ToolContext, MCPToolResult, LogFn } from '../types.js';
import type { VectorDBInterface, SearchResult } from '@liendev/core';

interface QueryResult {
  results: SearchResult[];
  method: 'symbols' | 'content';
}

interface PaginationResult {
  paginatedResults: SearchResult[];
  hasMore: boolean;
  nextOffset?: number;
}

/**
 * Perform content scan fallback when symbol query fails or returns no results.
 * Filters by symbolName (not content) to match only actual functions/symbols.
 */
async function performContentScan(
  vectorDB: VectorDBInterface,
  args: Pick<ListFunctionsInput, 'language' | 'pattern' | 'symbolType'>,
  fetchLimit: number,
  log: LogFn
): Promise<QueryResult> {
  log('Falling back to content scan...');

  let results = await vectorDB.scanWithFilter({
    language: args.language,
    symbolType: args.symbolType,
    limit: fetchLimit,
  });

  // Filter by symbolName (not content) to match only actual functions/symbols
  if (args.pattern) {
    const regex = new RegExp(args.pattern, 'i');
    results = results.filter(r => {
      const symbolName = r.metadata?.symbolName;
      return symbolName && regex.test(symbolName);
    });
  }

  return {
    results,
    method: 'content',
  };
}

/**
 * Query symbols with automatic fallback to content scan.
 */
async function queryWithFallback(
  vectorDB: VectorDBInterface,
  args: Pick<ListFunctionsInput, 'language' | 'pattern' | 'symbolType'>,
  fetchLimit: number,
  log: LogFn
): Promise<QueryResult> {
  try {
    const results = await vectorDB.querySymbols({
      language: args.language,
      pattern: args.pattern,
      symbolType: args.symbolType,
      limit: fetchLimit,
    });

    if (results.length === 0 && (args.language || args.pattern || args.symbolType)) {
      log('No symbol results, falling back to content scan...');
      return await performContentScan(vectorDB, args, fetchLimit, log);
    }

    return { results, method: 'symbols' };
  } catch (error) {
    log(`Symbol query failed: ${error}`);
    return await performContentScan(vectorDB, args, fetchLimit, log);
  }
}

/**
 * Deduplicate and paginate results.
 */
function paginateResults(results: SearchResult[], offset: number, limit: number): PaginationResult {
  const dedupedResults = deduplicateResults(results);
  const hasMore = dedupedResults.length > offset + limit;
  const paginatedResults = dedupedResults.slice(offset, offset + limit);

  return {
    paginatedResults,
    hasMore,
    ...(hasMore ? { nextOffset: offset + limit } : {}),
  };
}

/**
 * Handle list_functions tool calls.
 * Fast symbol lookup by naming pattern.
 */
export async function handleListFunctions(
  args: unknown,
  ctx: ToolContext
): Promise<MCPToolResult> {
  const { vectorDB, log, checkAndReconnect, getIndexMetadata } = ctx;

  return await wrapToolHandler(
    ListFunctionsSchema,
    async (validatedArgs) => {
      log('Listing functions with symbol metadata...');
      await checkAndReconnect();

      const limit = validatedArgs.limit ?? 50;
      const offset = validatedArgs.offset ?? 0;
      // Over-fetch by 1 to detect if more results exist beyond the requested window
      const fetchLimit = limit + offset + 1;

      const queryResult = await queryWithFallback(vectorDB, validatedArgs, fetchLimit, log);
      const { paginatedResults, hasMore, nextOffset } = paginateResults(queryResult.results, offset, limit);

      log(`Found ${paginatedResults.length} matches using ${queryResult.method} method`);

      return {
        indexInfo: getIndexMetadata(),
        method: queryResult.method,
        hasMore,
        ...(nextOffset !== undefined ? { nextOffset } : {}),
        results: shapeResults(paginatedResults, 'list_functions'),
        note: paginatedResults.length === 0
          ? '0 results. Try a broader regex pattern (e.g. ".*") or omit the symbolType filter. Use semantic_search for behavior-based queries.'
          : queryResult.method === 'content'
            ? 'Using content search. Run "lien reindex" to enable faster symbol-based queries.'
            : undefined,
      };
    }
  )(args);
}
