import { z } from 'zod';

/**
 * Schema for the lexical code search tool input.
 *
 * Validates query strings and result limits for full-text (BM25) code search.
 * Includes rich descriptions to guide AI assistants on proper usage.
 */
export const SearchCodeSchema = z.object({
  query: z
    .string()
    .min(3, 'Query must be at least 3 characters')
    .max(500, 'Query too long (max 500 characters)')
    .describe(
      'Keywords, identifiers, and domain terms to match — full-text (BM25) search.\n\n' +
        'Use concrete words that actually appear in the code, comments, or docstrings; ' +
        'this is NOT semantic search, so meaning-only paraphrases that share no words will not match.\n\n' +
        'Good examples:\n' +
        "  - 'authenticate user session token'\n" +
        "  - 'validate email address'\n" +
        "  - 'payment transaction charge refund'\n\n" +
        'Bad examples:\n' +
        "  - 'How does the code handle things?' (natural-language question, no matching keywords)\n" +
        "  - 'validateEmail' (a single exact name — use list_functions instead)",
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
});

/**
 * Inferred TypeScript type for code search input
 */
export type SearchCodeInput = z.infer<typeof SearchCodeSchema>;
