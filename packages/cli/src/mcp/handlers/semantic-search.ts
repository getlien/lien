import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { SemanticSearchSchema } from '../schemas/index.js';
import type { ToolContext, MCPToolResult } from '../types.js';

/**
 * Handle semantic_search tool calls.
 * Searches the codebase by meaning using embeddings.
 */
export async function handleSemanticSearch(
  args: unknown,
  ctx: ToolContext
): Promise<MCPToolResult> {
  const { vectorDB, embeddings, log, checkAndReconnect, getIndexMetadata } = ctx;

  return await wrapToolHandler(
    SemanticSearchSchema,
    async (validatedArgs) => {
      log(`Searching for: "${validatedArgs.query}"`);

      // Check if index has been updated and reconnect if needed
      await checkAndReconnect();

      const queryEmbedding = await embeddings.embed(validatedArgs.query);
      const results = await vectorDB.search(queryEmbedding, validatedArgs.limit, validatedArgs.query);

      log(`Found ${results.length} results`);

      return {
        indexInfo: getIndexMetadata(),
        results,
      };
    }
  )(args);
}


