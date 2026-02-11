import type { ZodSchema} from 'zod';
import { ZodError } from 'zod';
import { LienError, LienErrorCode } from '@liendev/core';
import { applyResponseBudget } from './response-budget.js';

/**
 * Wrap a tool handler with Zod validation and error handling.
 * 
 * This utility provides automatic:
 * - Input validation using Zod schemas
 * - Type-safe handler execution with inferred types
 * - Consistent error formatting for validation, Lien, and unexpected errors
 * - MCP-compatible response structure
 * 
 * @param schema - Zod schema to validate tool inputs against
 * @param handler - Tool handler function that receives validated inputs
 * @returns Wrapped handler that validates inputs and handles errors
 * 
 * @example
 * ```typescript
 * const SearchSchema = z.object({
 *   query: z.string().min(3),
 *   limit: z.number().default(5)
 * });
 * 
 * const searchHandler = wrapToolHandler(
 *   SearchSchema,
 *   async (args) => {
 *     // args is fully typed: { query: string; limit: number }
 *     const results = await search(args.query, args.limit);
 *     return { results };
 *   }
 * );
 * 
 * // Use in MCP server
 * return await searchHandler(request.params.arguments);
 * ```
 */
export function wrapToolHandler<T>(
  schema: ZodSchema<T>,
  handler: (validated: T) => Promise<any>
) {
  return async (args: unknown) => {
    try {
      // Validate input with Zod
      const validated = schema.parse(args);
      
      // Execute handler with validated, typed input
      const rawResult = await handler(validated);

      // Apply response budget to prevent oversized MCP responses
      const { result, truncation } = applyResponseBudget(rawResult);

      // Append truncation note if response was truncated
      if (truncation && typeof result === 'object' && result !== null) {
        const obj = result as Record<string, unknown>;
        obj.note = obj.note
          ? `${obj.note}\n${truncation.message}`
          : truncation.message;
      }

      // Return MCP-compatible success response
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
      
    } catch (error) {
      return formatErrorResponse(error);
    }
  };
}

function formatErrorResponse(error: unknown) {
  if (error instanceof ZodError) {
    return {
      isError: true,
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          error: 'Invalid parameters',
          code: LienErrorCode.INVALID_INPUT,
          details: error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        }, null, 2),
      }],
    };
  }

  if (error instanceof LienError) {
    return {
      isError: true,
      content: [{
        type: 'text' as const,
        text: JSON.stringify(error.toJSON(), null, 2),
      }],
    };
  }

  console.error('Unexpected error in tool handler:', error);
  return {
    isError: true,
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
        code: LienErrorCode.INTERNAL_ERROR,
      }, null, 2),
    }],
  };
}

