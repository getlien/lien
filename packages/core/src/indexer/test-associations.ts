/**
 * Portable test association discovery from in-memory chunks.
 * Finds test files that import given source files by analyzing chunk metadata.
 */

import { isTestFile, normalizePath, matchesFile } from '../utils/path-matching.js';
import type { CodeChunk } from './types.js';

/**
 * Find test files that import the given source files.
 * Works entirely from in-memory chunks — no VectorDB or filesystem needed.
 *
 * @param filepaths - Source file paths to find tests for
 * @param chunks - All indexed chunks (test + source files)
 * @param workspaceRoot - Workspace root for path normalization (defaults to cwd)
 * @returns Map of source filepath → array of test file paths that import it
 */
export function findTestAssociationsFromChunks(
  filepaths: string[],
  chunks: CodeChunk[],
  workspaceRoot: string = process.cwd(),
): Map<string, string[]> {
  const result = new Map<string, string[]>();

  // Build a path normalization cache for performance
  const cache = new Map<string, string>();
  const normalize = (p: string): string => {
    if (cache.has(p)) return cache.get(p)!;
    const normalized = normalizePath(p, workspaceRoot);
    cache.set(p, normalized);
    return normalized;
  };

  for (const filepath of filepaths) {
    const normalizedTarget = normalize(filepath);
    const testFiles = new Set<string>();

    for (const chunk of chunks) {
      const chunkFile = chunk.metadata.file;

      // Skip non-test files
      if (!isTestFile(chunkFile)) continue;

      // Check if this test file imports the target
      const imports = chunk.metadata.imports || [];
      for (const imp of imports) {
        const normalizedImport = normalize(imp);
        if (matchesFile(normalizedImport, normalizedTarget)) {
          testFiles.add(chunkFile);
          break;
        }
      }
    }

    if (testFiles.size > 0) {
      result.set(filepath, Array.from(testFiles));
    }
  }

  return result;
}
