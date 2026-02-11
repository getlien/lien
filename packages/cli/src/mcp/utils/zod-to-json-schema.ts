import type { ZodSchema } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Convert a Zod schema to an MCP tool schema.
 * 
 * This utility generates JSON Schema from Zod schemas for use in MCP tool definitions.
 * The resulting schema includes all validation rules and descriptions from the Zod schema.
 * 
 * @param zodSchema - The Zod schema to convert
 * @param name - The tool name
 * @param description - The tool description
 * @returns MCP-compatible tool schema object
 * 
 * @example
 * ```typescript
 * const SearchSchema = z.object({
 *   query: z.string().min(3).describe("Search query"),
 *   limit: z.number().default(5)
 * });
 * 
 * const tool = toMCPToolSchema(
 *   SearchSchema,
 *   'semantic_search',
 *   'Search the codebase semantically'
 * );
 * ```
 */
export function toMCPToolSchema(
  zodSchema: ZodSchema,
  name: string,
  description: string
) {
  return {
    name,
    description,
    inputSchema: zodToJsonSchema(zodSchema, {
      target: 'jsonSchema7',
      $refStrategy: 'none',
    }),
  };
}

