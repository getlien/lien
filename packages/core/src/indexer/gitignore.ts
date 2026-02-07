import ignore, { type Ignore } from 'ignore';
import fs from 'fs/promises';
import fsSync from 'fs';
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

/** Directories to skip during .gitignore discovery (no useful .gitignore inside) */
const SKIP_DIRS = new Set([
  'node_modules',
  'vendor',
  '.git',
  '.lien',
  'dist',
  'build',
]);

/** Whether a directory entry should be traversed during .gitignore discovery */
function shouldTraverseDir(entry: fsSync.Dirent): boolean {
  if (!entry.isDirectory() || entry.isSymbolicLink()) return false;
  if (SKIP_DIRS.has(entry.name)) return false;
  // Skip hidden dirs except .github
  if (entry.name.startsWith('.') && entry.name !== '.github') return false;
  return true;
}

/** Read .gitignore content from a directory, or null if not present */
async function readGitignore(absDir: string, entries: fsSync.Dirent[]): Promise<string | null> {
  if (!entries.some(e => e.name === '.gitignore' && e.isFile())) return null;
  try {
    return await fs.readFile(path.join(absDir, '.gitignore'), 'utf-8');
  } catch {
    return null; // Race condition or permission issue
  }
}

/**
 * Walk the directory tree from rootDir, collecting .gitignore contents.
 * Skips SKIP_DIRS and symlinked directories to avoid cycles.
 *
 * @returns Map of relative dir path ('' for root, 'packages/app' etc.) to .gitignore content
 */
async function discoverGitignoreFiles(rootDir: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const queue: string[] = [''];

  while (queue.length > 0) {
    const relDir = queue.shift()!;
    const absDir = relDir ? path.join(rootDir, relDir) : rootDir;

    let entries: fsSync.Dirent[];
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      continue;
    }

    const content = await readGitignore(absDir, entries);
    if (content !== null) {
      result.set(relDir, content);
    }

    for (const entry of entries) {
      if (!shouldTraverseDir(entry)) continue;
      const childRel = relDir ? `${relDir}/${entry.name}` : entry.name;
      queue.push(childRel);
    }
  }

  return result;
}

/** Check if a path matches a scoped .gitignore (root or nested) */
function matchesScopedIgnore(normalized: string, prefix: string, ig: Ignore): boolean {
  if (prefix === '') return ig.ignores(normalized);

  const prefixWithSlash = prefix + '/';
  if (!normalized.startsWith(prefixWithSlash)) return false;
  const scopedPath = normalized.slice(prefixWithSlash.length);
  return scopedPath !== '' && ig.ignores(scopedPath);
}

/**
 * Create a filter function that checks if a file path is gitignored.
 * Discovers .gitignore files throughout the directory tree and applies
 * each at its appropriate scope, plus built-in exclusions (node_modules,
 * vendor, .git, .lien, dist, build, minified assets) to match the full scan
 * behavior in scanner.ts.
 *
 * @param rootDir - Project root directory
 * @returns Function that returns true if a relative path is ignored
 */
export async function createGitignoreFilter(rootDir: string): Promise<(relativePath: string) => boolean> {
  // Always-ignore patterns in a separate instance (cannot be negated)
  const alwaysIg = ignore();
  alwaysIg.add(ALWAYS_IGNORE_PATTERNS);

  // Discover all .gitignore files and build scoped ignore instances
  const gitignoreMap = await discoverGitignoreFiles(rootDir);
  const scopedIgnores: Array<{ prefix: string; ig: Ignore }> = [];

  for (const [relDir, content] of gitignoreMap) {
    const ig = ignore();
    ig.add(content);
    scopedIgnores.push({ prefix: relDir, ig });
  }

  // Sort by prefix length (root first) for consistent evaluation
  scopedIgnores.sort((a, b) => a.prefix.length - b.prefix.length);

  return (relativePath: string) => {
    const normalized = relativePath.replace(/\\/g, '/');
    if (alwaysIg.ignores(normalized)) return true;
    return scopedIgnores.some(({ prefix, ig }) => matchesScopedIgnore(normalized, prefix, ig));
  };
}
