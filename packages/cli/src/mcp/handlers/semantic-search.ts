import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { SemanticSearchSchema } from '../schemas/index.js';
import { shapeResults, deduplicateResults } from '../utils/metadata-shaper.js';
import type { ToolContext, MCPToolResult, LogFn } from '../types.js';
import type { VectorDBInterface, SearchResult } from '@liendev/core';

/**
 * Group search results by repository ID.
 */
function groupResultsByRepo(results: Array<{ metadata: { repoId?: string } }>) {
  const grouped: Record<string, typeof results> = {};

  for (const result of results) {
    const repoId = result.metadata.repoId || 'unknown';
    if (!grouped[repoId]) {
      grouped[repoId] = [];
    }
    grouped[repoId].push(result);
  }

  return grouped;
}

interface SearchParams {
  query: string;
  limit: number;
  crossRepo?: boolean;
}

/**
 * Execute the lexical search. Cross-repo search is unsupported by the bundled
 * SQLite backend, so a crossRepo request falls back to a single-repo search.
 */
async function executeSearch(
  vectorDB: VectorDBInterface,
  params: SearchParams,
  log: LogFn,
): Promise<{ results: SearchResult[]; crossRepoFallback: boolean }> {
  const { query, limit, crossRepo } = params;

  if (crossRepo) {
    log(
      'Warning: crossRepo=true requires a cross-repo-capable backend. Falling back to single-repo search.',
      'warning',
    );
  }
  const results = await vectorDB.search(query, limit);
  log(`Found ${results.length} results`);
  return { results, crossRepoFallback: !!crossRepo };
}

/**
 * Deduplicate, filter irrelevant results, and collect diagnostic notes.
 */
function processResults(
  rawResults: SearchResult[],
  crossRepoFallback: boolean,
  log: LogFn,
): { results: SearchResult[]; notes: string[] } {
  const notes: string[] = [];
  if (crossRepoFallback) {
    notes.push(
      'Cross-repo search requires a cross-repo-capable backend. Fell back to single-repo search.',
    );
  }

  const results = deduplicateResults(rawResults);

  if (results.length > 0 && results.every(r => r.relevance === 'not_relevant')) {
    notes.push('No relevant matches found.');
    log('Returning 0 results (all not_relevant)');
    return { results: [], notes };
  }

  return { results, notes };
}

/**
 * Handle semantic_search tool calls.
 *
 * Runs lexical full-text (FTS5/BM25) search over code, docstrings, and
 * camelCase-split identifiers via `vectorDB.search`. Cross-repo search is
 * unsupported by the bundled single-repo SQLite backend.
 */
export async function handleSemanticSearch(
  args: unknown,
  ctx: ToolContext,
): Promise<MCPToolResult> {
  const { vectorDB, log, checkAndReconnect, getIndexMetadata } = ctx;

  return await wrapToolHandler(SemanticSearchSchema, async validatedArgs => {
    const { crossRepo, query, limit } = validatedArgs;

    log(`Searching for: "${query}"${crossRepo ? ' (cross-repo)' : ''}`);
    await checkAndReconnect();

    const { results: rawResults, crossRepoFallback } = await executeSearch(
      vectorDB,
      { query, limit: limit ?? 5, crossRepo },
      log,
    );

    const { results, notes } = processResults(rawResults, crossRepoFallback, log);

    log(`Returning ${results.length} results`);

    const shaped = shapeResults(results, 'semantic_search');

    if (shaped.length === 0) {
      notes.push(
        '0 results. Search is lexical: query with concrete keywords or identifiers that appear in the code (function names, domain terms), not natural-language questions. Or use grep for exact string matches. If the codebase was recently updated, run "lien index".',
      );
    }

    return {
      indexInfo: getIndexMetadata(),
      results: shaped,
      ...(crossRepo && vectorDB.supportsCrossRepo && { groupedByRepo: groupResultsByRepo(shaped) }),
      ...(notes.length > 0 && { note: notes.join(' ') }),
    };
  })(args);
}
