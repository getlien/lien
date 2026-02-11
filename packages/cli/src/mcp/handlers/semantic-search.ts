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
  repoIds?: string[];
}

/**
 * Execute the vector search, choosing cross-repo or single-repo strategy.
 */
async function executeSearch(
  vectorDB: VectorDBInterface,
  queryEmbedding: Float32Array,
  params: SearchParams,
  log: LogFn,
): Promise<{ results: SearchResult[]; crossRepoFallback: boolean }> {
  const { query, limit, crossRepo, repoIds } = params;

  if (crossRepo && vectorDB.supportsCrossRepo) {
    const results = await vectorDB.searchCrossRepo(queryEmbedding, limit, { repoIds });
    log(
      `Found ${results.length} results across ${Object.keys(groupResultsByRepo(results)).length} repos`,
    );
    return { results, crossRepoFallback: false };
  }

  if (crossRepo) {
    log(
      'Warning: crossRepo=true requires Qdrant backend. Falling back to single-repo search.',
      'warning',
    );
  }
  const results = await vectorDB.search(queryEmbedding, limit, query);
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
    notes.push('Cross-repo search requires Qdrant backend. Fell back to single-repo search.');
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
 * Searches the codebase by meaning using embeddings.
 * Supports cross-repo search when using Qdrant backend.
 */
export async function handleSemanticSearch(
  args: unknown,
  ctx: ToolContext,
): Promise<MCPToolResult> {
  const { vectorDB, embeddings, log, checkAndReconnect, getIndexMetadata } = ctx;

  return await wrapToolHandler(SemanticSearchSchema, async validatedArgs => {
    const { crossRepo, repoIds, query, limit } = validatedArgs;

    log(`Searching for: "${query}"${crossRepo ? ' (cross-repo)' : ''}`);
    await checkAndReconnect();

    const queryEmbedding = await embeddings.embed(query);
    const { results: rawResults, crossRepoFallback } = await executeSearch(
      vectorDB,
      queryEmbedding,
      { query, limit: limit ?? 5, crossRepo, repoIds },
      log,
    );

    const { results, notes } = processResults(rawResults, crossRepoFallback, log);

    log(`Returning ${results.length} results`);

    const shaped = shapeResults(results, 'semantic_search');

    if (shaped.length === 0) {
      notes.push(
        '0 results. Try rephrasing as a full question (e.g. "How does X work?"), or use grep for exact string matches. If the codebase was recently updated, run "lien reindex".',
      );
    }

    return {
      indexInfo: getIndexMetadata(),
      results: shaped,
      ...(crossRepo &&
        vectorDB.supportsCrossRepo && { groupedByRepo: groupResultsByRepo(shaped) }),
      ...(notes.length > 0 && { note: notes.join(' ') }),
    };
  })(args);
}
