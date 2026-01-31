import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { ListFunctionsSchema } from '../schemas/index.js';
import { shapeResults, deduplicateResults } from '../utils/metadata-shaper.js';
import type { ToolContext, MCPToolResult, LogFn } from '../types.js';
import type { VectorDBInterface, SearchResult } from '@liendev/core';

/** Maps symbolType filter values to the set of matching record types */
const SYMBOL_TYPE_MATCHES: Record<string, Set<string>> = {
  function: new Set(['function', 'method']),
  method: new Set(['method']),
  class: new Set(['class']),
  interface: new Set(['interface']),
};

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
  args: { language?: string; pattern?: string; symbolType?: string },
  log: LogFn
): Promise<QueryResult> {
  log('Falling back to content scan...');

  let results = await vectorDB.scanWithFilter({
    language: args.language,
    limit: 200, // Fetch more, we'll filter by symbolName
  });

  // Filter by symbolName (not content) to match only actual functions/symbols
  if (args.pattern) {
    const regex = new RegExp(args.pattern, 'i');
    results = results.filter(r => {
      const symbolName = r.metadata?.symbolName;
      return symbolName && regex.test(symbolName);
    });
  }

  // Filter by symbolType if provided (using same matching logic as primary query path)
  if (args.symbolType) {
    const allowedTypes = SYMBOL_TYPE_MATCHES[args.symbolType];
    results = results.filter(r => {
      const recordType = r.metadata?.symbolType;
      return recordType && allowedTypes?.has(recordType);
    });
  }

  return {
    results: results.slice(0, 50),
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

      let queryResult: QueryResult;

      try {
        // Try symbol-based query first (v0.5.0+)
        const results = await vectorDB.querySymbols({
          language: validatedArgs.language,
          pattern: validatedArgs.pattern,
          symbolType: validatedArgs.symbolType,
          limit: 50,
        });

        // Fall back if no results and filters were provided
        if (results.length === 0 && (validatedArgs.language || validatedArgs.pattern || validatedArgs.symbolType)) {
          log('No symbol results, falling back to content scan...');
          queryResult = await performContentScan(vectorDB, validatedArgs, log);
        } else {
          queryResult = { results, method: 'symbols' };
        }
      } catch (error) {
        log(`Symbol query failed: ${error}`);
        queryResult = await performContentScan(vectorDB, validatedArgs, log);
      }

      const dedupedResults = deduplicateResults(queryResult.results);
      log(`Found ${dedupedResults.length} matches using ${queryResult.method} method`);

      return {
        indexInfo: getIndexMetadata(),
        method: queryResult.method,
        results: shapeResults(dedupedResults, 'list_functions'),
        note: queryResult.method === 'content'
          ? 'Using content search. Run "lien reindex" to enable faster symbol-based queries.'
          : undefined,
      };
    }
  )(args);
}
