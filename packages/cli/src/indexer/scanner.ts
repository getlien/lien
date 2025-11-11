import { glob } from 'glob';
import ignore from 'ignore';
import fs from 'fs/promises';
import path from 'path';
import { ScanOptions } from './types.js';

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

