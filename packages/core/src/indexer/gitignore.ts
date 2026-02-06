import ignore from 'ignore';
import fs from 'fs/promises';
import path from 'path';

/**
 * Create a filter function that checks if a file path is gitignored.
 * Loads .gitignore from rootDir and returns a function that tests relative paths.
 *
 * @param rootDir - Project root directory containing .gitignore
 * @returns Function that returns true if a relative path is ignored
 */
export async function createGitignoreFilter(rootDir: string): Promise<(relativePath: string) => boolean> {
  const ig = ignore();

  try {
    const gitignoreContent = await fs.readFile(path.join(rootDir, '.gitignore'), 'utf-8');
    ig.add(gitignoreContent);
  } catch {
    // No .gitignore — nothing to filter
  }

  return (relativePath: string) => ig.ignores(relativePath);
}
