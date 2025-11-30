import { z } from 'zod';

/**
 * Schema for get_dependents tool input.
 * 
 * Validates file paths and options for finding reverse dependencies
 * (which files import/depend on a given file).
 */
export const GetDependentsSchema = z.object({
  filepath: z.string()
    .min(1, "Filepath cannot be empty")
    .describe(
      "Path to file to find dependents for (relative to workspace root).\n\n" +
      "Example: 'src/utils/validate.ts'\n\n" +
      "Returns all files that import or depend on this file."
    ),
    
  depth: z.number()
    .int()
    .min(1)
    .max(3)
    .default(1)
    .describe(
      "Depth of transitive dependencies (1-3). Default: 1\n\n" +
      "1 = Direct dependents only\n" +
      "2 = Direct + their dependents\n" +
      "3 = Three levels deep"
    ),
});

/**
 * Inferred TypeScript type for get_dependents input
 */
export type GetDependentsInput = z.infer<typeof GetDependentsSchema>;

