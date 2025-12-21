import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { SemanticSearchSchema } from '../schemas/index.js';
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
      if (crossRepo && vectorDB instanceof QdrantDB) {
        // Cross-repo search: omit repoId filter
        results = await vectorDB.searchCrossRepo(queryEmbedding, limit, repoIds);
        log(`Found ${results.length} results across ${Object.keys(groupResultsByRepo(results)).length} repos`);
      } else {
        // Single-repo search (existing behavior)
        if (crossRepo) {
          log('Warning: crossRepo=true requires Qdrant backend. Falling back to single-repo search.');
        }
        results = await vectorDB.search(queryEmbedding, limit, query);
        log(`Found ${results.length} results`);
      }

      // Group results by repo if cross-repo search
      const response: any = {
        indexInfo: getIndexMetadata(),
        results,
      };
      
      if (crossRepo && vectorDB instanceof QdrantDB) {
        response.groupedByRepo = groupResultsByRepo(results);
      }

      return response;
    }
  )(args);
}
