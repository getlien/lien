import { glob } from 'glob';
import ignore from 'ignore';
import fs from 'fs/promises';
import path from 'path';
import { ScanOptions } from './types.js';
import { LienConfig, FrameworkInstance } from '../config/schema.js';

/**
 * Scan codebase using framework-aware configuration
 * @param rootDir - Project root directory
 * @param config - Lien configuration with frameworks
 * @returns Array of file paths relative to rootDir
 */
export async function scanCodebaseWithFrameworks(
  rootDir: string,
  config: LienConfig
): Promise<string[]> {
  const allFiles: string[] = [];
  
  // Scan each framework
  for (const framework of config.frameworks) {
    if (!framework.enabled) {
      continue;
    }
    
    const frameworkFiles = await scanFramework(rootDir, framework);
    allFiles.push(...frameworkFiles);
  }
  
  return allFiles;
}

/**
 * Scan files for a specific framework instance
 */
async function scanFramework(
  rootDir: string,
  framework: FrameworkInstance
): Promise<string[]> {
  const frameworkPath = path.join(rootDir, framework.path);
  
  // Load .gitignore from framework path
  const gitignorePath = path.join(frameworkPath, '.gitignore');
  let ig = ignore();
  
  try {
    const gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
    ig = ignore().add(gitignoreContent);
  } catch (e) {
    // No .gitignore in framework path, try root
    const rootGitignorePath = path.join(rootDir, '.gitignore');
    try {
      const gitignoreContent = await fs.readFile(rootGitignorePath, 'utf-8');
      ig = ignore().add(gitignoreContent);
    } catch (e) {
      // No .gitignore at all, that's fine
    }
  }
  
  // Add framework-specific exclusions
  ig.add([
    ...framework.config.exclude,
    '.lien/**',
  ]);
  
  // Find all files matching framework patterns
  const allFiles: string[] = [];
  
  for (const pattern of framework.config.include) {
    const files = await glob(pattern, {
      cwd: frameworkPath,
      absolute: false, // Get paths relative to framework path
      nodir: true,
      ignore: framework.config.exclude,
    });
    allFiles.push(...files);
  }
  
  // Remove duplicates
  const uniqueFiles = Array.from(new Set(allFiles));
  
  // Filter using ignore patterns and prefix with framework path
  return uniqueFiles
    .filter(file => !ig.ignores(file))
    .map(file => {
      // Return path relative to root: framework.path/file
      return framework.path === '.' 
        ? file 
        : path.join(framework.path, file);
    });
}

/**
 * Legacy scan function for backwards compatibility
 * @deprecated Use scanCodebaseWithFrameworks instead
 */
export async function scanCodebase(options: ScanOptions): Promise<string[]> {
  const { rootDir, includePatterns = [], excludePatterns = [] } = options;
  
  // Load .gitignore
  const gitignorePath = path.join(rootDir, '.gitignore');
  let ig = ignore();
  
  try {
    const gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
    ig = ignore().add(gitignoreContent);
  } catch (e) {
    // No .gitignore, that's fine
  }
  
  // Add default exclusions
  ig.add([
    'node_modules/**',
    '.git/**',
    'dist/**',
    'build/**',
    '*.min.js',
    '*.min.css',
    '.lien/**',
    ...excludePatterns,
  ]);
  
  // Determine patterns to search for
  const patterns = includePatterns.length > 0 
    ? includePatterns 
    : ['**/*.{ts,tsx,js,jsx,py,go,rs,java,cpp,c,h}'];
  
  // Find all code files
  const allFiles: string[] = [];
  
  for (const pattern of patterns) {
    const files = await glob(pattern, {
      cwd: rootDir,
      absolute: true,
      nodir: true,
      ignore: ['node_modules/**', '.git/**'],
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

export function detectLanguage(filepath: string): string {
  const ext = path.extname(filepath).toLowerCase();
  
  const languageMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
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
  };
  
  return languageMap[ext] || 'unknown';
}

