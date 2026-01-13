import { z } from 'zod';

/**
 * Schema for find_similar tool input.
 * 
 * Validates code snippets and result limits for similarity search.
 */
export const FindSimilarSchema = z.object({
  code: z.string()
    .min(24, "Code snippet must be at least 24 characters")
    .describe(
      "Code snippet to find similar implementations for.\n\n" +
      "Provide a representative code sample that demonstrates the pattern " +
      "you want to find similar examples of in the codebase."
    ),
    
  limit: z.number()
    .int()
    .min(1, "Limit must be at least 1")
    .max(20, "Limit cannot exceed 20")
    .default(5)
    .describe(
      "Number of similar code blocks to return.\n\n" +
      "Default: 5"
    ),

  language: z.string()
    .optional()
    .describe(
      "Filter by programming language.\n\n" +
      "Examples: 'typescript', 'python', 'javascript', 'php'\n\n" +
      "If omitted, searches all languages."
    ),

  pathHint: z.string()
    .optional()
    .describe(
      "Filter by file path substring.\n\n" +
      "Only returns results where the file path contains this string (case-insensitive).\n\n" +
      "Examples: 'src/api', 'components', 'utils'"
    ),
});

/**
 * Inferred TypeScript type for find similar input
 */
export type FindSimilarInput = z.infer<typeof FindSimilarSchema>;

