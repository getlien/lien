import { z } from 'zod';

/**
 * Schema for get_dependents tool input.
 * 
 * Validates file paths and options for finding reverse dependencies
 * (which files import/depend on a given file).
 * 
 * Limitations:
 * - Scans up to 10,000 code chunks. For very large codebases (>1M lines),
 *   results may be incomplete. A warning is returned if the limit is reached.
 */
export const GetDependentsSchema = z.object({
  filepath: z.string()
    .min(1, "Filepath cannot be empty")
    .describe(
      "Path to file to find dependents for (relative to workspace root).\n\n" +
      "Example: 'src/utils/validate.ts'\n\n" +
      "Returns all files that import or depend on this file.\n\n" +
      "Note: Scans up to 10,000 code chunks. For very large codebases,\n" +
      "results may be incomplete (a warning will be included if truncated)."
    ),
    
  depth: z.number()
    .int()
    .min(1)
    .max(1)
    .default(1)
    .describe(
      "Depth of transitive dependencies. Only depth=1 (direct dependents) is currently supported.\n\n" +
      "1 = Direct dependents only"
    ),
});

/**
 * Inferred TypeScript type for get_dependents input
 */
export type GetDependentsInput = z.infer<typeof GetDependentsSchema>;

