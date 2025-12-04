import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { ListFunctionsSchema } from '../schemas/index.js';
import type { ToolContext, MCPToolResult } from '../types.js';

/**
 * Handle list_functions tool calls.
 * Fast symbol lookup by naming pattern.
 */
export async function handleListFunctions(
  args: unknown,
  ctx: ToolContext
): Promise<MCPToolResult> {
  const { vectorDB, log, checkAndReconnect, getIndexMetadata } = ctx;

  return await wrapToolHandler(
    ListFunctionsSchema,
    async (validatedArgs) => {
      log('Listing functions with symbol metadata...');

      // Check if index has been updated and reconnect if needed
      await checkAndReconnect();

      let results;
      let usedMethod = 'symbols';

      try {
        // Try using symbol-based query first (v0.5.0+)
        results = await vectorDB.querySymbols({
          language: validatedArgs.language,
          pattern: validatedArgs.pattern,
          limit: 50,
        });

        // If no results and pattern was provided, it might be an old index
        // Fall back to content scanning
        if (results.length === 0 && (validatedArgs.language || validatedArgs.pattern)) {
          log('No symbol results, falling back to content scan...');
          results = await vectorDB.scanWithFilter({
            language: validatedArgs.language,
            pattern: validatedArgs.pattern,
            limit: 50,
          });
          usedMethod = 'content';
        }
      } catch (error) {
        // If querySymbols fails (e.g., old index without symbol fields), fall back
        log(`Symbol query failed, falling back to content scan: ${error}`);
        results = await vectorDB.scanWithFilter({
          language: validatedArgs.language,
          pattern: validatedArgs.pattern,
          limit: 50,
        });
        usedMethod = 'content';
      }

      log(`Found ${results.length} matches using ${usedMethod} method`);

      return {
        indexInfo: getIndexMetadata(),
        method: usedMethod,
        results,
        note: usedMethod === 'content'
          ? 'Using content search. Run "lien reindex" to enable faster symbol-based queries.'
          : undefined,
      };
    }
  )(args);
}


