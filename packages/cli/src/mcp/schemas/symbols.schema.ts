import { z } from 'zod';

/**
 * Schema for list_functions tool input.
 * 
 * Validates pattern and language filters for symbol listing.
 */
export const ListFunctionsSchema = z.object({
  pattern: z.string()
    .optional()
    .describe(
      "Regex pattern to match symbol names.\n\n" +
      "Examples:\n" +
      "  - '.*Controller.*' to find all Controllers\n" +
      "  - 'handle.*' to find handlers\n" +
      "  - '.*Service$' to find Services\n\n" +
      "If omitted, returns all symbols."
    ),
    
  language: z.string()
    .optional()
    .describe(
      "Filter by programming language.\n\n" +
      "Examples: 'typescript', 'python', 'javascript', 'php'\n\n" +
      "If omitted, searches all languages."
    ),
});

/**
 * Inferred TypeScript type for list functions input
 */
export type ListFunctionsInput = z.infer<typeof ListFunctionsSchema>;

