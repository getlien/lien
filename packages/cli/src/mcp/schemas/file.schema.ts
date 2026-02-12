import { z } from 'zod';
import path from 'path';

const safeFilepath = z
  .string()
  .min(1, 'Filepath cannot be empty')
  .max(1000)
  .refine(p => {
    const normalized = p.replace(/\\/g, '/');
    return !path.isAbsolute(normalized) && !normalized.split('/').includes('..');
  }, 'Path must be relative and cannot contain ".." traversal');

/**
 * Schema for get_files_context tool input.
 *
 * Validates file paths and context options for retrieving file-specific code chunks.
 * Supports both single file and batch operations.
 */
export const GetFilesContextSchema = z.object({
  filepaths: z
    .union([
      safeFilepath,
      z
        .array(safeFilepath)
        .min(1, 'Array must contain at least one filepath')
        .max(50, 'Maximum 50 files per request'),
    ])
    .describe(
      'Single filepath or array of filepaths (relative to workspace root).\n\n' +
        "Single file: 'src/components/Button.tsx'\n" +
        "Multiple files: ['src/auth.ts', 'src/user.ts']\n\n" +
        'Maximum 50 files per request for batch operations.',
    ),

  includeRelated: z
    .boolean()
    .default(true)
    .describe(
      'Include semantically related chunks from nearby code.\n\n' +
        'Default: true\n\n' +
        'When enabled, also returns related code from other files that are ' +
        "semantically similar to the target file's contents.",
    ),
});

/**
 * Inferred TypeScript type for file context input
 */
export type GetFilesContextInput = z.infer<typeof GetFilesContextSchema>;
