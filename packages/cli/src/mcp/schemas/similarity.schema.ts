import { z } from 'zod';

/**
 * Schema for find_similar tool input.
 * 
 * Validates code snippets and result limits for similarity search.
 */
export const FindSimilarSchema = z.object({
  code: z.string()
    .min(10, "Code snippet must be at least 10 characters")
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
});

/**
 * Inferred TypeScript type for find similar input
 */
export type FindSimilarInput = z.infer<typeof FindSimilarSchema>;

