import { z } from 'zod';

/**
 * Schema for semantic search tool input.
 *
 * Validates query strings and result limits for semantic code search.
 * Includes rich descriptions to guide AI assistants on proper usage.
 */
export const SemanticSearchSchema = z.object({
  query: z
    .string()
    .min(3, 'Query must be at least 3 characters')
    .max(500, 'Query too long (max 500 characters)')
    .describe(
      "Natural language description of what you're looking for.\n\n" +
        'Use full sentences describing functionality, not exact names.\n\n' +
        'Good examples:\n' +
        "  - 'How does the code handle user authentication?'\n" +
        "  - 'Where are email addresses validated?'\n" +
        "  - 'How are payment transactions processed?'\n\n" +
        'Bad examples:\n' +
        "  - 'auth' (too vague)\n" +
        "  - 'validateEmail' (use grep for exact names)",
    ),

  limit: z
    .number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(50, 'Limit cannot exceed 50')
    .default(5)
    .describe(
      'Number of results to return.\n\n' +
        'Default: 5\n' +
        'Increase to 10-15 for broad exploration.',
    ),

  crossRepo: z
    .boolean()
    .default(false)
    .describe(
      'If true, search across all repos in the organization (requires Qdrant backend).\n\n' +
        'Default: false (single-repo search)\n' +
        'When enabled, results are grouped by repository.',
    ),

  repoIds: z
    .array(z.string().max(255))
    .optional()
    .describe(
      'Optional: Filter to specific repos when crossRepo=true.\n\n' +
        'If provided, only searches within the specified repositories.\n' +
        'If omitted and crossRepo=true, searches all repos in the organization.',
    ),
});

/**
 * Inferred TypeScript type for semantic search input
 */
export type SemanticSearchInput = z.infer<typeof SemanticSearchSchema>;
