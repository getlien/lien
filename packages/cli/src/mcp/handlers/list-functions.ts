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
      const fetchLimit = limit + offset;

      let queryResult: QueryResult;

      try {
        // Try symbol-based query first (v0.5.0+)
        const results = await vectorDB.querySymbols({
          language: validatedArgs.language,
          pattern: validatedArgs.pattern,
          symbolType: validatedArgs.symbolType,
          limit: fetchLimit,
        });

        // Fall back if no results and filters were provided
        if (results.length === 0 && (validatedArgs.language || validatedArgs.pattern || validatedArgs.symbolType)) {
          log('No symbol results, falling back to content scan...');
          queryResult = await performContentScan(vectorDB, validatedArgs, fetchLimit, log);
        } else {
          queryResult = { results, method: 'symbols' };
        }
      } catch (error) {
        log(`Symbol query failed: ${error}`);
        queryResult = await performContentScan(vectorDB, validatedArgs, fetchLimit, log);
      }

      const dedupedResults = deduplicateResults(queryResult.results);
      const totalBeforePagination = dedupedResults.length;
      const paginatedResults = dedupedResults.slice(offset, offset + limit);
      const hasMore = offset + limit < totalBeforePagination;

      log(`Found ${totalBeforePagination} matches using ${queryResult.method} method (returning ${paginatedResults.length})`);

      return {
        indexInfo: getIndexMetadata(),
        method: queryResult.method,
        totalBeforePagination,
        hasMore,
        ...(hasMore ? { nextOffset: offset + limit } : {}),
        results: shapeResults(paginatedResults, 'list_functions'),
        note: queryResult.method === 'content'
          ? 'Using content search. Run "lien reindex" to enable faster symbol-based queries.'
          : undefined,
      };
    }
  )(args);
}
