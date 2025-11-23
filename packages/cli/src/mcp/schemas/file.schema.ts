import { z } from 'zod';

/**
 * Schema for get_file_context tool input.
 * 
 * Validates file paths and context options for retrieving file-specific code chunks.
 */
export const GetFileContextSchema = z.object({
  filepath: z.string()
    .min(1, "Filepath cannot be empty")
    .describe(
      "Relative path to file from workspace root.\n\n" +
      "Example: 'src/components/Button.tsx'"
    ),
    
  includeRelated: z.boolean()
    .default(true)
    .describe(
      "Include semantically related chunks from nearby code.\n\n" +
      "Default: true\n\n" +
      "When enabled, also returns related code from other files that are " +
      "semantically similar to the target file's contents."
    ),
});

/**
 * Inferred TypeScript type for file context input
 */
export type GetFileContextInput = z.infer<typeof GetFileContextSchema>;

