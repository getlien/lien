import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { FindSimilarSchema } from '../schemas/index.js';
import type { ToolContext, MCPToolResult } from '../types.js';
import type { SearchResult } from '@liendev/core';

interface FiltersApplied {
  language?: string;
  pathHint?: string;
  prunedLowRelevance: number;
}

/**
 * Handle find_similar tool calls.
 * Finds code structurally similar to a given snippet.
 */
export async function handleFindSimilar(
  args: unknown,
  ctx: ToolContext
): Promise<MCPToolResult> {
  const { vectorDB, embeddings, log, checkAndReconnect, getIndexMetadata } = ctx;

  return await wrapToolHandler(
    FindSimilarSchema,
    async (validatedArgs) => {
      log(`Finding similar code...`);

      // Check if index has been updated and reconnect if needed
      await checkAndReconnect();

      const codeEmbedding = await embeddings.embed(validatedArgs.code);
      
      // Request extra results to account for filtering
      const limit = validatedArgs.limit ?? 5;
      const extraLimit = limit + 10;
      const rawResults = await vectorDB.search(codeEmbedding, extraLimit, validatedArgs.code);

      // Track what filters were applied
      const filtersApplied: FiltersApplied = { prunedLowRelevance: 0 };
      let filtered: SearchResult[] = rawResults;

      // Filter by language (case-insensitive)
      if (validatedArgs.language) {
        filtersApplied.language = validatedArgs.language;
        const lang = validatedArgs.language.toLowerCase();
        filtered = filtered.filter(r => 
          r.metadata.language?.toLowerCase() === lang
        );
      }

      // Filter by path hint (case-insensitive substring match)
      if (validatedArgs.pathHint) {
        filtersApplied.pathHint = validatedArgs.pathHint;
        const hint = validatedArgs.pathHint.toLowerCase();
        filtered = filtered.filter(r =>
          (r.metadata.file?.toLowerCase() ?? '').includes(hint)
        );
      }

      // Prune low-relevance results (not_relevant = score >= 1.5)
      const beforePrune = filtered.length;
      filtered = filtered.filter(r => r.relevance !== 'not_relevant');
      filtersApplied.prunedLowRelevance = beforePrune - filtered.length;

      // Apply final limit
      const results = filtered.slice(0, limit);

      log(`Found ${results.length} similar chunks`);

      // Only include filtersApplied if any filtering occurred
      const hasFilters = filtersApplied.language || filtersApplied.pathHint || filtersApplied.prunedLowRelevance > 0;

      return {
        indexInfo: getIndexMetadata(),
        results,
        ...(hasFilters && { filtersApplied }),
      };
    }
  )(args);
}
