import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { SearchCodeSchema } from '../schemas/index.js';
import { shapeResults, deduplicateResults, type ToolResult } from '../utils/metadata-shaper.js';
import { formatNoIndexNote } from '../utils/unindexed-paths.js';
import { applyDependentCountHonesty } from '../utils/dependent-count-honesty.js';
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
 * Shape the results for the response and apply the `dependentCount` honesty
 * pass (#1072), appending its one possible note to `notes`.
 *
 * Whether the counts are trustworthy is ASKED OF THE BACKEND, never inferred
 * from the results: a corpus whose counts are legitimately all zero and one
 * whose counts were never computed produce identical numbers. See
 * `../utils/dependent-count-honesty.ts` for which of the four indistinguishable
 * zeros gets a note, which gets omission, and which gets deliberate silence.
 */
async function shapeWithDependentCountHonesty(
  results: SearchResult[],
  vectorDB: VectorDBInterface,
  notes: string[],
): Promise<ToolResult[]> {
  const shaped = shapeResults(results, 'search_code');
  // No results means no `dependentCount` to be honest about — and no reason to
  // pay the backend read either.
  if (shaped.length === 0) return shaped;

  const honesty = applyDependentCountHonesty(shaped, await vectorDB.hasDependentCounts());
  if (honesty.note) notes.push(honesty.note);
  return honesty.results;
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

    const shaped = await shapeWithDependentCountHonesty(results, vectorDB, notes);

    if (shaped.length === 0) {
      // Same reasoning as list_functions: only assert the harder "no index at
      // all" fact when `hasData()` actually establishes it. A healthy index
      // that just hasn't caught up with a recent edit produces the exact same
      // 0 results, so the fallback note below must not read as "your query
      // phrasing is the problem" — it's one of several live possibilities.
      if (!(await vectorDB.hasData())) {
        notes.push(formatNoIndexNote());
      } else {
        notes.push(
          "0 results. This doesn't confirm the code doesn't exist — a recent edit may not be " +
            'reindexed yet. If this file changed recently, run "lien index" and retry first. ' +
            'Otherwise, query with concrete keywords or identifiers that appear in the code ' +
            '(function names, domain terms, not natural-language questions), or use grep for ' +
            'exact string matches.',
        );
      }
    }

    return {
      indexInfo: getIndexMetadata(),
      results: shaped,
      ...(notes.length > 0 && { note: notes.join(' ') }),
    };
  })(args);
}
