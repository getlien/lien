import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { SearchCodeSchema } from '../schemas/index.js';
import { shapeResults, deduplicateResults } from '../utils/metadata-shaper.js';
import type { ToolContext, MCPToolResult, LogFn } from '../types.js';
import type { VectorDBInterface, SearchResult } from '@liendev/core';

interface SearchParams {
  query: string;
  limit: number;
}

/**
 * Execute the lexical search.
 */
async function executeSearch(
  vectorDB: VectorDBInterface,
  params: SearchParams,
  log: LogFn,
): Promise<SearchResult[]> {
  const { query, limit } = params;
  const results = await vectorDB.search(query, limit);
  log(`Found ${results.length} results`);
  return results;
}

/**
 * Deduplicate, filter irrelevant results, and collect diagnostic notes.
 */
function processResults(
  rawResults: SearchResult[],
  log: LogFn,
): { results: SearchResult[]; notes: string[] } {
  const notes: string[] = [];
  const results = deduplicateResults(rawResults);

  if (results.length > 0 && results.every(r => r.relevance === 'not_relevant')) {
    notes.push('No relevant matches found.');
    log('Returning 0 results (all not_relevant)');
    return { results: [], notes };
  }

  return { results, notes };
}

/**
 * Handle search_code tool calls.
 *
 * Runs lexical full-text (FTS5/BM25) search over code, docstrings, and
 * camelCase-split identifiers via `vectorDB.search`.
 */
export async function handleSearchCode(args: unknown, ctx: ToolContext): Promise<MCPToolResult> {
  const { vectorDB, log, checkAndReconnect, getIndexMetadata } = ctx;

  return await wrapToolHandler(SearchCodeSchema, async validatedArgs => {
    const { query, limit } = validatedArgs;

    log(`Searching for: "${query}"`);
    await checkAndReconnect();

    const rawResults = await executeSearch(vectorDB, { query, limit: limit ?? 5 }, log);

    const { results, notes } = processResults(rawResults, log);

    log(`Returning ${results.length} results`);

    const shaped = shapeResults(results, 'search_code');

    if (shaped.length === 0) {
      notes.push(
        '0 results. Search is lexical: query with concrete keywords or identifiers that appear in the code (function names, domain terms), not natural-language questions. Or use grep for exact string matches. If the codebase was recently updated, run "lien index".',
      );
    }

    return {
      indexInfo: getIndexMetadata(),
      results: shaped,
      ...(notes.length > 0 && { note: notes.join(' ') }),
    };
  })(args);
}
