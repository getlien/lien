import path from 'path';
import fs from 'fs/promises';

/**
 * Import analysis for Tier 1 languages (TypeScript/JavaScript, Python, Go, PHP)
 * Uses regex-based parsing for simple, fast import detection
 */

// Language-specific import patterns
const IMPORT_PATTERNS: Record<string, RegExp[]> = {
  typescript: [
    /import\s+(?:type\s+)?(?:{[^}]+}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g, // Side-effect imports
    /require\s*\(['"]([^'"]+)['"]\)/g, // CommonJS
  ],
  javascript: [
    /import\s+(?:{[^}]+}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /require\s*\(['"]([^'"]+)['"]\)/g,
  ],
  python: [
    /from\s+([\w.]+)\s+import/g,
    /import\s+([\w.]+)/g,
  ],
  go: [
    /import\s+['"]([^'"]+)['"]/g,
    /import\s+\w+\s+['"]([^'"]+)['"]/g, // Named imports
    /import\s+\(\s*(?:[\w\s]+['"]([^'"]+)['"][\s\S]*?)+\)/g, // Grouped imports
  ],
  php: [
    /use\s+([\w\\]+)/g,
    /require(?:_once)?\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /include(?:_once)?\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ],
};

/**
 * Extract import paths from source code
 */
export function extractImports(fileContent: string, language: string): string[] {
  const patterns = IMPORT_PATTERNS[language];
  if (!patterns) {
    return [];
  }

  const imports: string[] = [];
  
  for (const pattern of patterns) {
    const matches = fileContent.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        imports.push(match[1]);
      }
    }
  }

  return [...new Set(imports)]; // Remove duplicates
}

/**
 * Resolve an import path to an actual file path
 */
export function resolveImportPath(
  importPath: string,
  fromFile: string,
  rootDir: string,
  language: string
): string | null {
  // Handle absolute/relative paths
  if (importPath.startsWith('.') || importPath.startsWith('/')) {
    return resolveRelativeImport(importPath, fromFile, language);
  }

  // Handle module imports (node_modules, site-packages, etc.)
  // For now, we'll skip these as they're typically not in the codebase
  return null;
}

/**
 * Resolve relative import path (./foo, ../bar)
 */
function resolveRelativeImport(
  importPath: string,
  fromFile: string,
  language: string
): string | null {
  const fromDir = path.dirname(fromFile);
  const resolvedPath = path.resolve(fromDir, importPath);

  // Try different extension possibilities
  const extensions = getImportExtensions(language);
  
  for (const ext of extensions) {
    const candidate = resolvedPath + ext;
    // We can't check file existence here since we're working with a list of files
    // Instead, return the candidate and let the caller check
    return candidate;
  }

  return resolvedPath;
}

/**
 * Get possible file extensions for imports
 */
function getImportExtensions(language: string): string[] {
  const extMap: Record<string, string[]> = {
    typescript: ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'],
    javascript: ['.js', '.jsx', '.mjs', '.cjs', '/index.js', '/index.jsx'],
    python: ['.py', '/__init__.py'],
    go: ['.go'],
    php: ['.php'],
  };
  return extMap[language] || [];
}

/**
 * Analyze test file imports to find related source files
 */
export async function analyzeTestImports(
  testFile: string,
  language: string,
  rootDir: string,
  allSourceFiles: string[]
): Promise<string[]> {
  try {
    const content = await fs.readFile(testFile, 'utf-8');
    const imports = extractImports(content, language);
    const relatedSources: string[] = [];

    for (const importPath of imports) {
      const resolved = resolveImportPath(importPath, testFile, rootDir, language);
      if (resolved) {
        // Check if resolved path matches any source file
        for (const sourceFile of allSourceFiles) {
          if (sourceFile === resolved || sourceFile.startsWith(resolved)) {
            relatedSources.push(sourceFile);
          }
        }
      }
    }

    return [...new Set(relatedSources)];
  } catch (error) {
    // File read error, return empty array
    return [];
  }
}

/**
 * Analyze all imports across multiple test files
 */
export async function analyzeImports(
  files: string[],
  tier1Languages: string[],
  rootDir: string
): Promise<Map<string, string[]>> {
  const associations = new Map<string, string[]>();

  // Separate files by language
  const filesByLanguage = new Map<string, string[]>();
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const language = detectLanguageFromExtension(ext);
    if (tier1Languages.includes(language)) {
      if (!filesByLanguage.has(language)) {
        filesByLanguage.set(language, []);
      }
      filesByLanguage.get(language)!.push(file);
    }
  }

  // Analyze imports for each language
  for (const [language, langFiles] of filesByLanguage) {
    for (const file of langFiles) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const imports = extractImports(content, language);
        const resolved: string[] = [];

        for (const importPath of imports) {
          const resolvedPath = resolveImportPath(importPath, file, rootDir, language);
          if (resolvedPath) {
            // Check if it matches any file in our list
            for (const candidateFile of langFiles) {
              if (
                candidateFile === resolvedPath ||
                candidateFile.startsWith(resolvedPath.replace(/\.[^.]+$/, ''))
              ) {
                resolved.push(candidateFile);
              }
            }
          }
        }

        if (resolved.length > 0) {
          associations.set(file, [...new Set(resolved)]);
        }
      } catch (error) {
        // Skip files that can't be read
        continue;
      }
    }
  }

  return associations;
}

/**
 * Detect language from file extension
 */
function detectLanguageFromExtension(ext: string): string {
  const map: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.go': 'go',
    '.php': 'php',
  };
  return map[ext] || 'unknown';
}

