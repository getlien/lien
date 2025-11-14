import path from 'path';

/**
 * Type-safe path system to prevent mixing absolute/relative paths
 * 
 * Uses TypeScript branded types for compile-time safety.
 * Runtime validation ensures correctness.
 */

// Branded types - compile-time distinction between path formats
export type RelativePath = string & { readonly __brand: 'RelativePath' };
export type AbsolutePath = string & { readonly __brand: 'AbsolutePath' };

/**
 * Create a RelativePath with validation
 * @throws {Error} if path is absolute
 */
export function toRelativePath(pathStr: string): RelativePath {
  if (pathStr.startsWith('/') || pathStr.match(/^[A-Z]:\\/)) {
    throw new Error(`Expected relative path, got absolute: ${pathStr}`);
  }
  return pathStr as RelativePath;
}

/**
 * Create an AbsolutePath with validation
 * @throws {Error} if path is relative
 */
export function toAbsolutePath(pathStr: string): AbsolutePath {
  if (!pathStr.startsWith('/') && !pathStr.match(/^[A-Z]:\\/)) {
    throw new Error(`Expected absolute path, got relative: ${pathStr}`);
  }
  return pathStr as AbsolutePath;
}

/**
 * Convert absolute path to relative (safe)
 */
export function makeRelative(absPath: AbsolutePath, rootDir: AbsolutePath): RelativePath {
  return path.relative(rootDir, absPath) as RelativePath;
}

/**
 * Convert relative path to absolute (safe)
 */
export function makeAbsolute(relPath: RelativePath, rootDir: AbsolutePath): AbsolutePath {
  return path.join(rootDir, relPath) as AbsolutePath;
}

/**
 * Type guard for RelativePath
 */
export function isRelativePath(pathStr: string): pathStr is RelativePath {
  return !pathStr.startsWith('/') && !pathStr.match(/^[A-Z]:\\/);
}

/**
 * Type guard for AbsolutePath
 */
export function isAbsolutePath(pathStr: string): pathStr is AbsolutePath {
  return pathStr.startsWith('/') || !!pathStr.match(/^[A-Z]:\\/);
}

