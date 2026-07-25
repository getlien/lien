import ignore, { type Ignore } from 'ignore';
import fs from 'fs/promises';
import type fsSync from 'fs';
import path from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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
  // Claude Code agent worktrees: full nested repo clones used as scratch
  // space by CC agents. Indexing them duplicates the entire project once
  // per worktree (seen in production: ~30 worktrees -> 21 GB index, 8 CPU
  // cores pegged). Never index these regardless of user config.
  '.claude/worktrees/**',
  '**/.claude/worktrees/**',
  'dist/**',
  '**/dist/**',
  'build/**',
  '**/build/**',
  '*.min.js',
  '**/*.min.js',
  '*.min.css',
  '**/*.min.css',
  // Generated lockfile: huge, no search value.
  'pnpm-lock.yaml',
  '**/pnpm-lock.yaml',
];

/** Directories to skip during .gitignore discovery (no useful .gitignore inside) */
const SKIP_DIRS = new Set(['node_modules', 'vendor', '.git', '.lien', 'dist', 'build']);

/**
 * Paths that are never indexed even when git tracks them. Deliberately much
 * narrower than {@link ALWAYS_IGNORE_PATTERNS}: `dist/**`, `build/**`,
 * `vendor/**`, and minified assets are intentionally NOT here, because a
 * tracked file living under one of those is exactly the case the tracked-file
 * exemption exists to rescue (see #899, #900). What IS here is either Lien's
 * own bookkeeping (`.git`, `.lien`) or a path that would be actively dangerous
 * to index regardless of tracked status: git *can* track `node_modules`
 * (e.g. a vendored/committed dependency tree) or a `.claude/worktrees` nested
 * clone, and indexing either reproduces the exact 21GB-index blowup
 * `ALWAYS_IGNORE_PATTERNS` (below) was introduced to prevent.
 */
export const NEVER_INDEX_EVEN_IF_TRACKED_PATTERNS = [
  '.git/**',
  '**/.git/**',
  '.lien/**',
  '**/.lien/**',
  'node_modules/**',
  '**/node_modules/**',
  '.claude/worktrees/**',
  '**/.claude/worktrees/**',
];

// git ls-files output can be large for repos with hundreds of thousands of
// tracked files; keep the buffer generous so large repos never truncate
// silently rather than raising an error.
const LS_FILES_MAX_BUFFER = 256 * 1024 * 1024;
const LS_FILES_TIMEOUT_MS = 30_000;

/**
 * Returns the set of paths (relative to `rootDir`, forward-slash-normalized)
 * that git tracks, or an empty set if `rootDir` is not inside a git working
 * tree, or git itself isn't available. Never throws.
 *
 * Real git only ever applies `.gitignore` to UNTRACKED files -- a pattern
 * added to silence a local build artifact never hides a file that's already
 * committed. This is the single source of truth for that tracked-file
 * exemption: a file git reports as tracked is by definition real, committed
 * source, regardless of what `.gitignore` or {@link ALWAYS_IGNORE_PATTERNS}
 * say about its path (see #899, #900). One `git ls-files -z` call, cached by
 * the caller for the lifetime of one scan/filter -- never a per-file
 * subprocess.
 */
export async function getGitTrackedFiles(rootDir: string): Promise<Set<string>> {
  try {
    const { stdout } = await execFileAsync('git', ['ls-files', '-z'], {
      cwd: rootDir,
      timeout: LS_FILES_TIMEOUT_MS,
      maxBuffer: LS_FILES_MAX_BUFFER,
    });
    return new Set(
      stdout
        .split('\0')
        .filter(Boolean)
        .map(p => p.replace(/\\/g, '/')),
    );
  } catch {
    // Not a git repo, git not installed, or the command otherwise failed --
    // fall back to pure lexical behavior (empty set = no rescues applied).
    return new Set();
  }
}

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
  let head = 0;

  while (head < queue.length) {
    const relDir = queue[head++];
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
 * Whether a git-tracked path should be exempted from lexical ignore rules.
 * False for paths under {@link NEVER_INDEX_EVEN_IF_TRACKED_PATTERNS} even if
 * git tracks them -- see that constant's doc comment for why.
 */
function isRescuedByGitTracking(
  normalized: string,
  trackedFiles: Set<string>,
  neverIndexIg: Ignore,
): boolean {
  return trackedFiles.has(normalized) && !neverIndexIg.ignores(normalized);
}

/**
 * Create a filter function that checks if a file path is gitignored.
 * Discovers .gitignore files throughout the directory tree and applies
 * each at its appropriate scope, plus built-in exclusions (node_modules,
 * vendor, .git, .lien, .claude/worktrees, dist, build, minified assets) to
 * match the full scan behavior in scanner.ts. In a git repository, a path
 * git tracks is exempted from all of the above (see {@link getGitTrackedFiles})
 * except the narrow {@link NEVER_INDEX_EVEN_IF_TRACKED_PATTERNS} carve-out.
 *
 * Limitation: scoped evaluation is OR across .gitignore files, so a nested
 * .gitignore cannot un-ignore a pattern from a parent. Cross-scope negation
 * (e.g., root ignores `*.log`, child un-ignores `!important.log`) is not
 * supported. Nested .gitignore files in practice almost always ADD patterns.
 *
 * @param rootDir - Project root directory
 * @returns Function that returns true if a relative path is ignored
 */
export async function createGitignoreFilter(
  rootDir: string,
): Promise<(relativePath: string) => boolean> {
  // Always-ignore patterns in a separate instance (cannot be negated)
  const alwaysIg = ignore();
  alwaysIg.add(ALWAYS_IGNORE_PATTERNS);

  const neverIndexIg = ignore();
  neverIndexIg.add(NEVER_INDEX_EVEN_IF_TRACKED_PATTERNS);

  // Discover all .gitignore files and the tracked-file set in parallel --
  // independent I/O, no reason to serialize them.
  const [gitignoreMap, trackedFiles] = await Promise.all([
    discoverGitignoreFiles(rootDir),
    getGitTrackedFiles(rootDir),
  ]);
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
    if (isRescuedByGitTracking(normalized, trackedFiles, neverIndexIg)) return false;
    if (alwaysIg.ignores(normalized)) return true;
    return scopedIgnores.some(({ prefix, ig }) => matchesScopedIgnore(normalized, prefix, ig));
  };
}
