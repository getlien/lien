import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { SemanticSearchSchema } from '../schemas/index.js';
import { shapeResults, deduplicateResults } from '../utils/metadata-shaper.js';
import type { ToolContext, MCPToolResult } from '../types.js';
import { QdrantDB } from '@liendev/core';

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

/**
 * Handle semantic_search tool calls.
 * Searches the codebase by meaning using embeddings.
 * Supports cross-repo search when using Qdrant backend.
 */
export async function handleSemanticSearch(
  args: unknown,
  ctx: ToolContext
): Promise<MCPToolResult> {
  const { vectorDB, embeddings, log, checkAndReconnect, getIndexMetadata } = ctx;

  return await wrapToolHandler(
    SemanticSearchSchema,
    async (validatedArgs) => {
      const { crossRepo, repoIds, query, limit } = validatedArgs;
      
      log(`Searching for: "${query}"${crossRepo ? ' (cross-repo)' : ''}`);

      // Check if index has been updated and reconnect if needed
      await checkAndReconnect();

      const queryEmbedding = await embeddings.embed(query);
      
      // Check if cross-repo search is requested and backend supports it
      let results;
      let crossRepoFallback = false;
      
      if (crossRepo && vectorDB instanceof QdrantDB) {
        // Cross-repo search: omit repoId filter
        results = await vectorDB.searchCrossRepo(queryEmbedding, limit, { repoIds });
        log(`Found ${results.length} results across ${Object.keys(groupResultsByRepo(results)).length} repos`);
      } else {
        // Single-repo search (existing behavior)
        if (crossRepo) {
          log('Warning: crossRepo=true requires Qdrant backend. Falling back to single-repo search.');
          crossRepoFallback = true;
        }
        results = await vectorDB.search(queryEmbedding, limit, query);
        log(`Found ${results.length} results`);
      }

      // Deduplicate results
      results = deduplicateResults(results);

      // Collect notes
      const notes: string[] = [];
      if (crossRepoFallback) {
        notes.push('Cross-repo search requires Qdrant backend. Fell back to single-repo search.');
      }

      // If all results are irrelevant, return empty with a note
      if (results.length > 0 && results.every(r => r.relevance === 'not_relevant')) {
        notes.push('No relevant matches found.');
        log('Returning 0 results (all not_relevant)');
        return {
          indexInfo: getIndexMetadata(),
          results: [],
          note: notes.join(' '),
        };
      }

      log(`Returning ${results.length} results`);

      // Shape metadata for context efficiency
      const shaped = shapeResults(results, 'semantic_search');

      if (shaped.length === 0) {
        notes.push('0 results. Try rephrasing as a full question (e.g. "How does X work?"), or use grep for exact string matches. If the codebase was recently updated, run "lien reindex".');
      }

      // Build response
      return {
        indexInfo: getIndexMetadata(),
        results: shaped,
        ...(crossRepo && vectorDB instanceof QdrantDB && { groupedByRepo: groupResultsByRepo(shaped) }),
        ...(notes.length > 0 && { note: notes.join(' ') }),
      };
    }
  )(args);
}
