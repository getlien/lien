import { z } from 'zod';

/**
 * Schema for code_graph tool input.
 * 
 * Validates file paths and options for generating dependency graphs
 * starting from a root file.
 */
export const CodeGraphSchema = z.object({
  rootFile: z.string()
    .min(1, "Root file path cannot be empty")
    .describe(
      "Root file to generate graph from (relative to workspace root).\n\n" +
      "Example: 'src/components/Button.tsx'\n\n" +
      "The graph will show all dependencies of this file."
    ),
  depth: z.number()
    .int()
    .min(1)
    .max(5)
    .default(1)
    .describe(
      "How deep to traverse dependencies (default: 1).\n\n" +
      "1 = Direct dependencies only\n" +
      "2 = Dependencies and their dependencies\n" +
      "Higher values show deeper dependency chains"
    ),
});

/**
 * Inferred TypeScript type for code_graph input
 */
export type CodeGraphInput = z.infer<typeof CodeGraphSchema>;

