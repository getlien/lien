/**
 * Shared path matching utilities for dependency analysis.
 * 
 * These functions handle path normalization and matching logic used by
 * dependency analysis to find reverse dependencies.
 */

/**
 * Normalizes a file path for comparison.
 * 
 * - Removes quotes and trims whitespace
 * - Converts backslashes to forward slashes
 * - Strips file extensions (.ts, .tsx, .js, .jsx)
 * - Converts absolute paths to relative (if within workspace root)
 * 
 * @param path - The path to normalize
 * @param workspaceRoot - The workspace root directory (normalized with forward slashes)
 * @returns Normalized path
 */
export function normalizePath(path: string, workspaceRoot: string): string {
  let normalized = path.replace(/['"]/g, '').trim().replace(/\\/g, '/');
  
  // Normalize extensions: .ts/.tsx/.js/.jsx → all treated as equivalent
  // This handles TypeScript's ESM requirement of .js imports for .ts files
  normalized = normalized.replace(/\.(ts|tsx|js|jsx)$/, '');
  
  // Normalize to relative path if it starts with workspace root
  if (normalized.startsWith(workspaceRoot + '/')) {
    normalized = normalized.substring(workspaceRoot.length + 1);
  }
  
  return normalized;
}

/**
 * Checks if a pattern matches at path component boundaries.
 * 
 * Ensures matches occur at proper boundaries (/, .) to avoid false positives like:
 * - "logger" matching "logger-utils" ❌
 * - "src/logger" matching "src/logger-service" ❌
 * 
 * @param str - The string to search in
 * @param pattern - The pattern to search for
 * @returns True if pattern matches at a boundary
 */
export function matchesAtBoundary(str: string, pattern: string): boolean {
  const index = str.indexOf(pattern);
  if (index === -1) return false;
  
  // Check character before match (must be start or path separator)
  const charBefore = index > 0 ? str[index - 1] : '/';
  if (charBefore !== '/' && index !== 0) return false;
  
  // Check character after match (must be end or path separator)
  // Extensions are already stripped during normalization, so we only need to check for '/' as a valid path separator
  const endIndex = index + pattern.length;
  if (endIndex === str.length) return true;
  const charAfter = str[endIndex];
  return charAfter === '/';
}

/**
 * Determines if an import path matches a target file path.
 * 
 * Handles various matching strategies:
 * 1. Exact match
 * 2. Target path appears in import (at boundaries)
 * 3. Import path appears in target (at boundaries)
 * 4. Relative imports (./logger vs src/utils/logger)
 * 
 * @param normalizedImport - Normalized import path
 * @param normalizedTarget - Normalized target file path
 * @returns True if the import matches the target file
 */
export function matchesFile(normalizedImport: string, normalizedTarget: string): boolean {
  // Exact match
  if (normalizedImport === normalizedTarget) return true;
  
  // Strategy 1: Check if target path appears in import at path boundaries
  if (matchesAtBoundary(normalizedImport, normalizedTarget)) {
    return true;
  }
  
  // Strategy 2: Check if import path appears in target (for longer target paths)
  if (matchesAtBoundary(normalizedTarget, normalizedImport)) {
    return true;
  }
  
  // Strategy 3: Handle relative imports (./logger vs src/utils/logger)
  // Remove leading ./ and ../ from import
  const cleanedImport = normalizedImport.replace(/^(\.\.?\/)+/, '');
  if (matchesAtBoundary(cleanedImport, normalizedTarget) || 
      matchesAtBoundary(normalizedTarget, cleanedImport)) {
    return true;
  }
  
  return false;
}

/**
 * Gets a canonical path representation (relative to workspace, with extension).
 * 
 * @param filepath - The file path to canonicalize
 * @param workspaceRoot - The workspace root directory (normalized with forward slashes)
 * @returns Canonical path
 */
export function getCanonicalPath(filepath: string, workspaceRoot: string): string {
  let canonical = filepath.replace(/\\/g, '/');
  if (canonical.startsWith(workspaceRoot + '/')) {
    canonical = canonical.substring(workspaceRoot.length + 1);
  }
  return canonical;
}

/**
 * Resolves a relative import path to an absolute path based on the source file's location.
 * 
 * Handles:
 * - Relative imports: `./utils` or `../utils/path-matching`
 * - Absolute imports: `packages/core/src/utils` (already absolute)
 * 
 * @param importPath - The import path (may be relative or absolute)
 * @param sourceFile - The file that contains this import (relative to workspace root)
 * @param workspaceRoot - The workspace root directory (normalized with forward slashes)
 * @returns Resolved absolute path (relative to workspace root), or null if invalid
 */
export function resolveRelativeImport(
  importPath: string,
  sourceFile: string,
  workspaceRoot: string
): string | null {
  // Clean the import path
  let cleanImport = importPath.replace(/['"]/g, '').trim().replace(/\\/g, '/');
  
  // Remove file extension for matching
  cleanImport = cleanImport.replace(/\.(ts|tsx|js|jsx)$/, '');
  
  // If already absolute (starts with workspace root or is absolute path), return as-is
  if (cleanImport.startsWith(workspaceRoot + '/')) {
    return cleanImport.substring(workspaceRoot.length + 1);
  }
  
  // If it's an absolute path (starts with /), it's outside workspace - skip
  if (cleanImport.startsWith('/')) {
    return null;
  }
  
  // Get source file directory
  const sourceDir = sourceFile.replace(/\\/g, '/');
  const sourceDirPath = sourceDir.split('/').slice(0, -1).join('/') || '';
  
  // Handle relative imports
  if (cleanImport.startsWith('./')) {
    // Relative to current directory: ./utils → sourceDir/utils
    const resolved = sourceDirPath ? `${sourceDirPath}/${cleanImport.substring(2)}` : cleanImport.substring(2);
    return resolved;
  } else if (cleanImport.startsWith('../')) {
    // Go up directories: ../utils → go up one level from sourceDir
    let currentDir = sourceDirPath;
    let remaining = cleanImport;
    
    while (remaining.startsWith('../')) {
      if (!currentDir) {
        // Can't go up beyond workspace root
        return null;
      }
      currentDir = currentDir.split('/').slice(0, -1).join('/');
      remaining = remaining.substring(3);
    }
    
    const resolved = currentDir ? `${currentDir}/${remaining}` : remaining;
    return resolved;
  } else {
    // Assume it's relative to current directory (no ./ prefix)
    const resolved = sourceDirPath ? `${sourceDirPath}/${cleanImport}` : cleanImport;
    return resolved;
  }
}

/**
 * Determines if a file is a test file based on naming conventions.
 * 
 * Uses precise regex patterns to avoid false positives:
 * - Files with .test. or .spec. extensions (e.g., foo.test.ts, bar.spec.js)
 * - Files in test/, tests/, or __tests__/ directories
 * 
 * Avoids false positives like:
 * - contest.ts (contains ".test." but isn't a test)
 * - latest/config.ts (contains "/test/" but isn't a test)
 * 
 * @param filepath - The file path to check
 * @returns True if the file is a test file
 */
export function isTestFile(filepath: string): boolean {
  return /\.(test|spec)\.[^/]+$/.test(filepath) ||
         /(^|[/\\])(test|tests|__tests__)[/\\]/.test(filepath);
}
