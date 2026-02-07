import ignore from 'ignore';
import fs from 'fs/promises';
import path from 'path';

/**
 * Patterns that should always be ignored regardless of user configuration.
 * Single source of truth — imported by scanner.ts and used by createGitignoreFilter.
 */
export const ALWAYS_IGNORE_PATTERNS = [
  'node_modules/**',
  '**/node_modules/**',
  'vendor/**',
  '**/vendor/**',
  '.git/**',
  '**/.git/**',
  '.lien/**',
  'dist/**',
  '**/dist/**',
  'build/**',
  '**/build/**',
  '*.min.js',
  '**/*.min.js',
  '*.min.css',
  '**/*.min.css',
];

/**
 * Create a filter function that checks if a file path is gitignored.
 * Loads .gitignore from rootDir and applies built-in exclusions (node_modules,
 * vendor, .git, .lien, dist, build, minified assets) to match the full scan
 * behavior in scanner.ts.
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
    // No .gitignore — only built-in ignore patterns will apply
  }

  // Added after .gitignore so user negation rules (e.g. !node_modules/) cannot override them
  ig.add(ALWAYS_IGNORE_PATTERNS);

  return (relativePath: string) => {
    // Normalize to POSIX separators — the ignore library expects forward slashes
    const normalized = relativePath.replace(/\\/g, '/');
    return ig.ignores(normalized);
  };
}
