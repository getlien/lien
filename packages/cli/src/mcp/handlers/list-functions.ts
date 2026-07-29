import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { ListFunctionsSchema } from '../schemas/index.js';
import type { ListFunctionsInput } from '../schemas/index.js';
import { shapeResults, deduplicateResults } from '../utils/metadata-shaper.js';
import type { ToolContext, MCPToolResult, LogFn } from '../types.js';
import { safeRegex } from '@liendev/core';
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
  log: LogFn,
): Promise<QueryResult> {
  log('Falling back to content scan...');

  let results = await vectorDB.scanWithFilter({
    language: args.language,
    symbolType: args.symbolType,
    limit: fetchLimit,
  });

  // Filter by symbolName (not content) to match only actual functions/symbols
  if (args.pattern) {
    const regex = safeRegex(args.pattern);
    if (regex) {
      results = results.filter(r => {
        const symbolName = r.metadata?.symbolName;
        return symbolName && regex.test(symbolName);
      });
    } else {
      // Invalid/unsafe pattern — still filter to entries with a symbolName
      results = results.filter(r => !!r.metadata?.symbolName);
    }
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
  log: LogFn,
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
 *
 * `nextOffset` is included whenever at least one result is shown —
 * deliberately NOT gated on `hasMore`. A page that looks complete here
 * (`hasMore: false`, e.g. exactly `limit` items fetched) can still get
 * items dropped later by applyResponseBudget for response size, which
 * forces `hasMore` true after the fact; that correction needs an existing
 * `nextOffset` field to adjust (see response-budget.ts). Always offset +
 * (what was actually returned), so it's never past the shown items even
 * before any downstream size-cut.
 */
function paginateResults(results: SearchResult[], offset: number, limit: number): PaginationResult {
  const dedupedResults = deduplicateResults(results);
  const hasMore = dedupedResults.length > offset + limit;
  const paginatedResults = dedupedResults.slice(offset, offset + limit);

  return {
    paginatedResults,
    hasMore,
    ...(paginatedResults.length > 0 ? { nextOffset: offset + paginatedResults.length } : {}),
  };
}

/**
 * Handle list_functions tool calls.
 * Fast symbol lookup by naming pattern.
 */
export async function handleListFunctions(args: unknown, ctx: ToolContext): Promise<MCPToolResult> {
  const { vectorDB, log, checkAndReconnect, getIndexMetadata } = ctx;

  return await wrapToolHandler(ListFunctionsSchema, async validatedArgs => {
    log('Listing functions with symbol metadata...');
    await checkAndReconnect();

    const limit = validatedArgs.limit ?? 50;
    const offset = validatedArgs.offset ?? 0;
    // Over-fetch by 1 to detect if more results exist beyond the requested window
    const fetchLimit = limit + offset + 1;

    const queryResult = await queryWithFallback(vectorDB, validatedArgs, fetchLimit, log);
    const { paginatedResults, hasMore, nextOffset } = paginateResults(
      queryResult.results,
      offset,
      limit,
    );

    log(`Found ${paginatedResults.length} matches using ${queryResult.method} method`);

    const notes: string[] = [];
    if (queryResult.results.length === 0) {
      notes.push(
        '0 results. Try a broader regex pattern (e.g. ".*") or omit the symbolType filter. Use search_code for behavior-based queries.',
      );
    } else if (paginatedResults.length === 0 && offset > 0) {
      notes.push(
        'No results for this page. The offset is beyond the available results; try reducing or resetting the offset to 0.',
      );
    } else if (hasMore) {
      // Deliberately no item count OR offset number baked into this string:
      // the true total isn't computed (see paginateResults), and BOTH a
      // count and this nextOffset value can go stale if applyResponseBudget
      // drops further items downstream for response size — it corrects the
      // structured `nextOffset` field when that happens, but can't safely
      // rewrite an arbitrary number embedded in prose. Point at the field
      // instead of repeating its value, so the two can never disagree.
      notes.push(
        'More matches exist beyond this page. See nextOffset to continue, or narrow pattern/symbolType/language.',
      );
    }
    if (queryResult.method === 'content') {
      notes.push('Using content search. Run "lien index" to enable faster symbol-based queries.');
    }

    return {
      indexInfo: getIndexMetadata(),
      method: queryResult.method,
      hasMore,
      ...(nextOffset !== undefined ? { nextOffset } : {}),
      results: shapeResults(paginatedResults, 'list_functions'),
      ...(notes.length > 0 && { note: notes.join(' ') }),
    };
  })(args);
}
