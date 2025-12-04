import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { FindSimilarSchema } from '../schemas/index.js';
import type { ToolContext, MCPToolResult } from '../types.js';

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
      // Pass code as query for relevance boosting
      const results = await vectorDB.search(codeEmbedding, validatedArgs.limit, validatedArgs.code);

      log(`Found ${results.length} similar chunks`);

      return {
        indexInfo: getIndexMetadata(),
        results,
      };
    }
  )(args);
}
