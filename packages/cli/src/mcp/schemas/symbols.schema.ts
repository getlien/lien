import { z } from 'zod';

/**
 * Schema for list_functions tool input.
 *
 * Validates pattern and language filters for symbol listing.
 */
export const ListFunctionsSchema = z.object({
  pattern: z
    .string()
    .max(200)
    .optional()
    .describe(
      'Regex pattern to match symbol names.\n\n' +
        'Examples:\n' +
        "  - '.*Controller.*' to find all Controllers\n" +
        "  - 'handle.*' to find handlers\n" +
        "  - '.*Service$' to find Services\n\n" +
        'If omitted, returns all symbols.',
    ),

  language: z
    .string()
    .max(50)
    .optional()
    .describe(
      'Filter by programming language.\n\n' +
        "Examples: 'typescript', 'python', 'javascript', 'php'\n\n" +
        'If omitted, searches all languages.',
    ),

  symbolType: z
    .enum(['function', 'method', 'class', 'interface'])
    .optional()
    .describe('Filter by symbol type. If omitted, returns all types.'),

  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(50)
    .describe(
      'Number of results to return.\n\n' +
        'Default: 50\n' +
        'Increase to 200 for broad exploration.',
    ),

  offset: z
    .number()
    .int()
    .min(0)
    .max(10000)
    .default(0)
    .describe(
      'Skip first N results before applying limit, equivalent to pagination offset.\n\n' +
        'Default: 0',
    ),
});

/**
 * Inferred TypeScript type for list functions input
 */
export type ListFunctionsInput = z.infer<typeof ListFunctionsSchema>;
