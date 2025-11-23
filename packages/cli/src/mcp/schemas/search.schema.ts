import { z } from 'zod';

/**
 * Schema for semantic search tool input.
 * 
 * Validates query strings and result limits for semantic code search.
 * Includes rich descriptions to guide AI assistants on proper usage.
 */
export const SemanticSearchSchema = z.object({
  query: z.string()
    .min(3, "Query must be at least 3 characters")
    .max(500, "Query too long (max 500 characters)")
    .describe(
      "Natural language description of what you're looking for.\n\n" +
      "Use full sentences describing functionality, not exact names.\n\n" +
      "Good examples:\n" +
      "  - 'handles user authentication'\n" +
      "  - 'validates email format'\n" +
      "  - 'processes payment transactions'\n\n" +
      "Bad examples:\n" +
      "  - 'auth' (too vague)\n" +
      "  - 'validateEmail' (use grep for exact names)"
    ),
    
  limit: z.number()
    .int()
    .min(1, "Limit must be at least 1")
    .max(50, "Limit cannot exceed 50")
    .default(5)
    .describe(
      "Number of results to return.\n\n" +
      "Default: 5\n" +
      "Increase to 10-15 for broad exploration."
    ),
});

/**
 * Inferred TypeScript type for semantic search input
 */
export type SemanticSearchInput = z.infer<typeof SemanticSearchSchema>;

