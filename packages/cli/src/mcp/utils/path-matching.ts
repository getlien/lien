/**
 * Shared path matching utilities for dependency analysis.
 * 
 * These functions handle path normalization and matching logic used by
 * the get_dependents tool to find reverse dependencies.
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
  
  // Normalize extensions: .ts/.tsx/.js/.jsx/.php → all treated as equivalent
  // This handles TypeScript's ESM requirement of .js imports for .ts files
  // Also handles PHP files where namespaces don't include extensions
  normalized = normalized.replace(/\.(ts|tsx|js|jsx|php)$/, '');
  
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
 * 5. PHP namespace imports (App\Models\User vs app/Models/User.php)
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
  
  // Strategy 4: PHP namespace matching
  // PHP imports use namespaces like "App\Models\User" which should match "app/Models/User.php"
  if (matchesPHPNamespace(normalizedImport, normalizedTarget)) {
    return true;
  }
  
  return false;
}

/**
 * Checks if paths match using case-insensitive component matching.
 * 
 * This handles PHP namespace imports where:
 * - App/Models/User should match app/Models/User (case difference in first component)
 * - Domain/Services/Auth should match web/Domain/Services/Auth (prefix in target)
 * 
 * Also useful for case-insensitive file systems.
 * 
 * @param importPath - The normalized import path
 * @param targetPath - The normalized file path
 * @returns True if paths match case-insensitively at component boundaries
 */
function matchesPHPNamespace(importPath: string, targetPath: string): boolean {
  // Split into path components
  const importComponents = importPath.split('/').filter(Boolean);
  const targetComponents = targetPath.split('/').filter(Boolean);
  
  // Need at least one component to match
  if (importComponents.length === 0 || targetComponents.length === 0) {
    return false;
  }
  
  // Match from the end, case-insensitively
  // This handles prefixes like "web/app" matching "App"
  let matched = 0;
  for (let i = 1; i <= importComponents.length && i <= targetComponents.length; i++) {
    const impComp = importComponents[importComponents.length - i].toLowerCase();
    const targetComp = targetComponents[targetComponents.length - i].toLowerCase();
    
    if (impComp === targetComp) {
      matched++;
    } else {
      break;
    }
  }
  
  // All import components must match (from the end)
  // This ensures App/Models/User matches web/app/Models/User but not app/Services/User
  return matched === importComponents.length;
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

