import { z } from 'zod';

/**
 * Schema for get_complexity tool input.
 *
 * Validates parameters for complexity analysis queries,
 * enabling tech debt analysis and refactoring prioritization.
 */
export const GetComplexitySchema = z.object({
  files: z
    .array(z.string().min(1, 'Filepath cannot be empty').max(1000))
    .optional()
    .describe(
      'Specific files to analyze. If omitted, analyzes entire codebase.\n\n' +
        "Example: ['src/auth.ts', 'src/api/user.ts']",
    ),

  top: z
    .number()
    .int()
    .min(1, 'Top must be at least 1')
    .max(50, 'Top cannot exceed 50')
    .default(10)
    .describe(
      'Return top N most complex functions. Default: 10\n\n' +
        'Use higher values to see more violations.',
    ),

  threshold: z
    .number()
    .int()
    .min(1, 'Threshold must be at least 1')
    .optional()
    .describe(
      'Only return functions above this complexity threshold.\n\n' +
        'Note: Violations are first identified using the threshold from lien.config.json (default: 15). ' +
        'This parameter filters those violations to show only items above the specified value. ' +
        'Setting threshold below the config threshold will not show additional functions.',
    ),

  crossRepo: z
    .boolean()
    .default(false)
    .describe(
      'If true, analyze complexity across all repos in the organization (requires Qdrant backend).\n\n' +
        'Default: false (single-repo analysis)\n' +
        'When enabled, results are aggregated by repository.',
    ),

  repoIds: z
    .array(z.string().max(255))
    .optional()
    .describe(
      'Optional: Filter to specific repos when crossRepo=true.\n\n' +
        'If provided, only analyzes the specified repositories.\n' +
        'If omitted and crossRepo=true, analyzes all repos in the organization.',
    ),
});

/**
 * Inferred TypeScript type for get_complexity input
 */
export type GetComplexityInput = z.infer<typeof GetComplexitySchema>;
