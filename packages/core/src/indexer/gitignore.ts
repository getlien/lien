import ignore from 'ignore';
import fs from 'fs/promises';
import path from 'path';

/**
 * Patterns that should always be ignored, matching the full scan behavior in scanner.ts.
 */
const ALWAYS_IGNORE_PATTERNS = [
  'node_modules/**',
  '**/node_modules/**',
  'vendor/**',
  '**/vendor/**',
  '.git/**',
  '**/.git/**',
  '.lien/**',
];

/**
 * Create a filter function that checks if a file path is gitignored.
 * Loads .gitignore from rootDir and applies built-in exclusions (node_modules,
 * vendor, .git, .lien) to match the full scan behavior in scanner.ts.
 *
 * @param rootDir - Project root directory containing .gitignore
 * @returns Function that returns true if a relative path is ignored
 */
export async function createGitignoreFilter(rootDir: string): Promise<(relativePath: string) => boolean> {
  const ig = ignore();

  ig.add(ALWAYS_IGNORE_PATTERNS);

  try {
    const gitignoreContent = await fs.readFile(path.join(rootDir, '.gitignore'), 'utf-8');
    ig.add(gitignoreContent);
  } catch {
    // No .gitignore — nothing to filter
  }

  return (relativePath: string) => ig.ignores(relativePath);
}
