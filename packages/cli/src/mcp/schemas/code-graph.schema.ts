import { z } from 'zod';

/**
 * Schema for code_graph tool input.
 * 
 * Validates file paths and options for generating dependency graphs
 * starting from root file(s). Supports forward, reverse, and both directions.
 */
export const CodeGraphSchema = z.object({
  rootFile: z.string()
    .min(1, "Root file path cannot be empty")
    .optional()
    .describe(
      "Root file to generate graph from (relative to workspace root).\n\n" +
      "Example: 'src/components/Button.tsx'\n\n" +
      "Either rootFile or rootFiles must be provided."
    ),
  rootFiles: z.array(z.string().min(1))
    .optional()
    .describe(
      "Multiple root files to generate combined graph (for PR review).\n\n" +
      "Example: ['src/auth.ts', 'src/user.ts']\n\n" +
      "Either rootFile or rootFiles must be provided."
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
  direction: z.enum(['forward', 'reverse', 'both'])
    .default('forward')
    .describe(
      "Direction of dependency traversal (default: 'forward').\n\n" +
      "- 'forward': What does this file depend on? (dependencies)\n" +
      "- 'reverse': What depends on this file? (impact analysis - most useful for code review)\n" +
      "- 'both': Show both forward and reverse dependencies"
    ),
  moduleLevel: z.boolean()
    .default(false)
    .describe(
      "Group files by module/directory (default: false).\n\n" +
      "When true, shows module-to-module dependencies instead of file-to-file."
    ),
}).refine(
  (data) => data.rootFile || (data.rootFiles && data.rootFiles.length > 0),
  {
    message: "Either rootFile or rootFiles must be provided",
    path: ["rootFile"],
  }
);

/**
 * Inferred TypeScript type for code_graph input
 */
export type CodeGraphInput = z.infer<typeof CodeGraphSchema>;

