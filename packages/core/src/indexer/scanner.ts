import { glob } from 'glob';
import ignore from 'ignore';
import fs from 'fs/promises';
import path from 'path';
import type { ScanOptions } from './types.js';
import { ALWAYS_IGNORE_PATTERNS } from './gitignore.js';

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
 * Scan codebase for files matching include/exclude patterns.
 */
export async function scanCodebase(options: ScanOptions): Promise<string[]> {
  const { rootDir, includePatterns = [], excludePatterns = [] } = options;

  const ig = await loadGitignore(rootDir);
  ig.add([...ALWAYS_IGNORE_PATTERNS, ...excludePatterns]);

  // Determine patterns to search for
  const patterns =
    includePatterns.length > 0
      ? includePatterns
      : ['**/*.{ts,tsx,js,jsx,py,php,go,rs,java,cpp,c,cs,h,md,mdx}'];

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
  return uniqueFiles.filter(file => {
    const relativePath = path.relative(rootDir, file);
    return !ig.ignores(relativePath);
  });
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
