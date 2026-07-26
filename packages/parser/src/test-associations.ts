/**
 * Portable test association discovery from in-memory chunks.
 * Finds test files that import given source files by analyzing chunk metadata.
 */

import { isTestFile, normalizePath, importMatchesTarget } from './utils/path-matching.js';
import { detectLanguage, hasSameDirectoryTestConvention } from './ast/languages/registry.js';
import {
  buildGoTestDirIndex,
  pairGoBasenameTest,
  type GoTestCandidate,
  type GoTestDirIndex,
} from './go-same-directory-tests.js';
import type { CodeChunk } from './types.js';

/**
 * True when `filepath`'s language sets `sameDirectoryTestConvention` (Go
 * today, #902) -- the per-file convenience wrapper `pairGoBasenameTest`'s
 * callers need, mirroring `isUnresolvableWholeModuleImport`'s
 * `detectLanguage` + registry-predicate shape in path-matching.ts.
 */
function hasGoSameDirectoryConvention(filepath: string): boolean {
  const language = detectLanguage(filepath);
  return language !== null && hasSameDirectoryTestConvention(language);
}

/** Test files among `testChunks` whose imports resolve to `normalizedTarget`. */
function collectImportMatchedTests(
  testChunks: CodeChunk[],
  normalizedTarget: string,
  normalize: (p: string) => string,
): string[] {
  const matched: string[] = [];
  for (const chunk of testChunks) {
    const imports = chunk.metadata.imports || [];
    // importMatchesTarget applies the #884 whole-module guard before
    // matchesFile -- see its doc comment in path-matching.ts (#886).
    if (
      imports.some(imp =>
        importMatchesTarget(imp, chunk.metadata.file, normalizedTarget, normalize),
      )
    ) {
      matched.push(chunk.metadata.file);
    }
  }
  return matched;
}

/**
 * #902 tier 1: same-directory basename-paired Go test(s) for `filepath`, or
 * `[]` for any non-Go target (or a Go target with no basename pair). See
 * `go-same-directory-tests.ts`'s module doc for why this needs no hedging.
 */
function collectGoBasenameTests(
  filepath: string,
  normalizedTarget: string,
  goTestDirIndex: GoTestDirIndex,
): string[] {
  return hasGoSameDirectoryConvention(filepath)
    ? pairGoBasenameTest(normalizedTarget, goTestDirIndex)
    : [];
}

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

  // Pre-filter to only test chunks for performance
  const testChunks = chunks.filter(chunk => isTestFile(chunk.metadata.file));

  // #902: Go's dominant same-package test convention emits no import
  // statement at all, so the import-matching loop below is structurally
  // blind to it. Build a directory index of same-directory-test-convention
  // (Go) test chunks once, reused for every target file below -- tier 1
  // only (basename pairing); tier 2 (package-level fallback) is a
  // `lien annotate`-only honesty fallback, see annotate-cmd.ts.
  const goTestCandidates: GoTestCandidate[] = testChunks
    .filter(chunk => hasGoSameDirectoryConvention(chunk.metadata.file))
    .map(chunk => ({ file: chunk.metadata.file, normalized: normalize(chunk.metadata.file) }));
  const goTestDirIndex = buildGoTestDirIndex(goTestCandidates);

  for (const filepath of filepaths) {
    const normalizedTarget = normalize(filepath);
    const testFiles = new Set<string>([
      ...collectImportMatchedTests(testChunks, normalizedTarget, normalize),
      ...collectGoBasenameTests(filepath, normalizedTarget, goTestDirIndex),
    ]);

    if (testFiles.size > 0) {
      result.set(filepath, Array.from(testFiles));
    }
  }

  return result;
}
