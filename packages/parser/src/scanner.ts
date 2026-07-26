import { glob } from 'glob';
import { Minimatch } from 'minimatch';
import ignore from 'ignore';
import fs from 'fs/promises';
import path from 'path';
import type { ScanOptions } from './types.js';
import {
  ALWAYS_IGNORE_PATTERNS,
  NEVER_INDEX_EVEN_IF_TRACKED_PATTERNS,
  getGitTrackedFiles,
} from './gitignore.js';

/**
 * Load .gitignore from the given paths (first match wins) and return an ignore instance.
 */
async function loadGitignore(...dirs: string[]): Promise<ReturnType<typeof ignore>> {
  for (const dir of dirs) {
    try {
      const content = await fs.readFile(path.join(dir, '.gitignore'), 'utf-8');
      return ignore().add(content);
    } catch {
      // Try next path
    }
  }
  return ignore();
}

/**
 * Find git-tracked files that lexical scanning (gitignore rules, hardcoded
 * `ALWAYS_IGNORE_PATTERNS`, ecosystem excludes) dropped, and rescue them.
 *
 * Real git only ever ignores UNTRACKED files -- a hardcoded `build/**`
 * pattern or a stale `.gitignore` line can't tell a generated-output
 * directory apart from a real tracked source directory that happens to
 * share its name (#899, #900). A path git tracks is by definition real,
 * committed source, so it's added back regardless of what lexical rules say,
 * with two exceptions: paths under {@link NEVER_INDEX_EVEN_IF_TRACKED_PATTERNS}
 * (never indexed, tracked or not) and paths that don't match `patterns` at
 * all (a rescue still respects the caller's include-pattern/extension filter
 * -- it does not index every tracked file regardless of type).
 */
function rescueTrackedFiles(
  rootDir: string,
  trackedFiles: Set<string>,
  lexicalFiles: string[],
  patterns: string[],
): string[] {
  if (trackedFiles.size === 0) return [];

  const neverIndexIg = ignore().add(NEVER_INDEX_EVEN_IF_TRACKED_PATTERNS);
  const lexicalRelSet = new Set(
    lexicalFiles.map(file => path.relative(rootDir, file).replace(/\\/g, '/')),
  );
  const includeMatchers = patterns.map(pattern => new Minimatch(pattern, { dot: false }));

  const rescued: string[] = [];
  for (const relPath of trackedFiles) {
    if (lexicalRelSet.has(relPath)) continue;
    if (neverIndexIg.ignores(relPath)) continue;
    if (!includeMatchers.some(matcher => matcher.match(relPath))) continue;
    rescued.push(path.join(rootDir, relPath));
  }
  return rescued;
}

/**
 * Scan codebase for files matching include/exclude patterns.
 *
 * In a git repository, the lexical scan below is unioned with git's
 * tracked-file list ({@link rescueTrackedFiles}) so tracked source is never
 * silently dropped by a hardcoded ignore pattern or a stale `.gitignore`
 * line. Non-git directories are unaffected -- {@link getGitTrackedFiles}
 * returns an empty set and the union is a no-op.
 */
export async function scanCodebase(options: ScanOptions): Promise<string[]> {
  const { rootDir, includePatterns = [], excludePatterns = [] } = options;

  const ig = await loadGitignore(rootDir);
  ig.add([...ALWAYS_IGNORE_PATTERNS, ...excludePatterns]);

  // Determine patterns to search for. The `.github/**` entry is required
  // alongside the brace pattern because glob's default `dot:false` blocks
  // `**` from descending into dot-directories -- a bare `**/*.{...,yml,yaml}`
  // never matches `.github/workflows/*.yml` (see DEFAULT_INDEX_INCLUDE_PATTERNS
  // in constants.ts for the fuller, non-fallback include list).
  const patterns =
    includePatterns.length > 0
      ? includePatterns
      : [
          '**/*.{ts,tsx,js,jsx,py,php,go,rs,java,cpp,c,cs,h,md,mdx,yml,yaml}',
          '.github/**/*.{yml,yaml}',
        ];

  // Combine always-ignored patterns with exclude patterns for glob
  const globIgnorePatterns = [...ALWAYS_IGNORE_PATTERNS, ...excludePatterns];

  // Find all code files
  const allFiles: string[] = [];

  for (const pattern of patterns) {
    const files = await glob(pattern, {
      cwd: rootDir,
      absolute: true,
      nodir: true,
      ignore: globIgnorePatterns,
    });
    allFiles.push(...files);
  }

  // Remove duplicates
  const uniqueFiles = Array.from(new Set(allFiles));

  // Filter using ignore patterns
  const lexicalFiles = uniqueFiles.filter(file => {
    const relativePath = path.relative(rootDir, file);
    return !ig.ignores(relativePath);
  });

  const trackedFiles = await getGitTrackedFiles(rootDir);
  const rescued = rescueTrackedFiles(rootDir, trackedFiles, lexicalFiles, patterns);
  return [...lexicalFiles, ...rescued];
}

/**
 * Detect broad file type from extension (includes non-AST languages like Go, Rust, Markdown, etc.).
 * For AST-supported language detection, use the AST parser's detectLanguage instead.
 */
export function detectFileType(filepath: string): string {
  const ext = path.extname(filepath).toLowerCase();

  const languageMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.vue': 'vue',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.cpp': 'cpp',
    '.cc': 'cpp',
    '.cxx': 'cpp',
    '.c': 'c',
    '.h': 'c',
    '.hpp': 'cpp',
    '.php': 'php',
    '.rb': 'ruby',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.cs': 'csharp',
    '.scala': 'scala',
    '.liquid': 'liquid',
    '.md': 'markdown',
    '.mdx': 'markdown',
    '.markdown': 'markdown',
  };

  return languageMap[ext] || 'unknown';
}

/**
 * @deprecated Use detectFileType instead. This alias exists for backwards
 * compatibility with deep imports.
 */
export const detectLanguage = detectFileType;
