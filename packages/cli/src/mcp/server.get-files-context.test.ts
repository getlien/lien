import { describe, it, expect, vi } from 'vitest';
import { getCanonicalPath, normalizePath, matchesFile, isTestFile } from '@liendev/parser';
import type { SearchResult } from '@liendev/core';
import {
  searchFileChunks,
  findRelatedChunks,
  findTestAssociations,
  deduplicateChunks,
  buildFilesData,
  createPathCache,
} from './handlers/get-files-context.js';

/**
 * Minimal `SearchResult` builder for `findTestAssociations` tests below —
 * these only exercise import/basename-based matching, so `content` and the
 * scoring fields are irrelevant filler; only `metadata.file`/`imports`
 * matter to the assertions.
 */
function mockSearchResult(file: string, imports?: string[]): SearchResult {
  return {
    content: '',
    metadata: {
      file,
      startLine: 1,
      endLine: 1,
      type: 'block',
      language: 'typescript',
      ...(imports ? { imports } : {}),
    },
    score: 0,
    relevance: 'not_relevant',
  };
}

/**
 * #1040: a real C# type declaration/usage `SearchResult`, optionally
 * namespaced (a `namespace X;` line prefixed into content) -- mirrors
 * `@liendev/parser`'s own `csharp-type-reference-signals.test.ts` helpers,
 * needed here because `findTestAssociations`'s C# tier
 * (`collectCSharpNamespaceTestFiles`) reads `content`/`symbolType`/`symbolName`,
 * not just `metadata.file`/`imports` like the plain `mockSearchResult` above.
 */
function mockCSharpChunk(opts: {
  file: string;
  symbolName: string;
  namespace?: string;
  declares?: boolean;
  references?: string[];
}): SearchResult {
  const nsPrefix = opts.namespace ? `namespace ${opts.namespace};\n\n` : '';
  const body = opts.declares
    ? `public class ${opts.symbolName} { }`
    : (opts.references ?? []).map(name => `var x = new ${name}();`).join('\n');
  return {
    content: `${nsPrefix}${body}`,
    metadata: {
      file: opts.file,
      startLine: 1,
      endLine: 10,
      type: opts.declares ? 'class' : 'function',
      language: 'csharp',
      symbolName: opts.symbolName,
      symbolType: opts.declares ? 'class' : 'method',
    },
    score: 0,
    relevance: 'not_relevant',
  };
}

/**
 * #1005 Phase 2, Item 2: a real Kotlin type declaration/usage `SearchResult`,
 * with a `package X` line in content (Phase 1's content-derived package
 * scan) -- mirrors `mockCSharpChunk` above, needed because
 * `findTestAssociations`'s Kotlin tier (`collectKotlinSamePackageTestFiles`)
 * reads `content`/`symbolType`/`symbolName`, not just
 * `metadata.file`/`imports` like the plain `mockSearchResult` above.
 */
function mockKotlinChunk(opts: {
  file: string;
  symbolName: string;
  pkg?: string;
  declares?: boolean;
  references?: string[];
}): SearchResult {
  const pkgPrefix = opts.pkg ? `package ${opts.pkg}\n\n` : '';
  const body = opts.declares
    ? `class ${opts.symbolName} { }`
    : (opts.references ?? []).map(name => `val x = ${name}()`).join('\n');
  return {
    content: `${pkgPrefix}${body}`,
    metadata: {
      file: opts.file,
      startLine: 1,
      endLine: 10,
      type: opts.declares ? 'class' : 'function',
      language: 'kotlin',
      symbolName: opts.symbolName,
      symbolType: opts.declares ? 'class' : 'method',
    },
    score: 0,
    relevance: 'not_relevant',
  };
}

/**
 * Unit tests for get_files_context handler and helper functions.
 *
 * Tests cover:
 * - Path matching utilities (existing)
 * - Response structure validation (existing)
 * - New extracted helper functions:
 *   - searchFileChunks
 *   - findRelatedChunks
 *   - findTestAssociations
 *   - deduplicateChunks
 *   - buildFilesData
 *   - createPathCache
 */

const workspaceRoot = '/fake/workspace';

// ============================================================================
// Path Matching Utilities (Existing Tests)
// ============================================================================

describe('get_files_context - Path Matching Utilities', () => {
  describe('Path Matching', () => {
    it('should canonicalize paths correctly', () => {
      expect(getCanonicalPath('/fake/workspace/src/auth.ts', workspaceRoot)).toBe('src/auth.ts');
      expect(getCanonicalPath('src/auth.ts', workspaceRoot)).toBe('src/auth.ts');
      expect(getCanonicalPath('src\\auth.ts', workspaceRoot)).toBe('src/auth.ts');
    });

    it('should normalize paths for comparison', () => {
      const normalize = (path: string) => normalizePath(path, workspaceRoot);

      // Extensions are stripped
      expect(normalize('src/auth.ts')).toBe('src/auth');
      expect(normalize('src/auth.js')).toBe('src/auth');

      // Relative paths are converted
      expect(normalize('/fake/workspace/src/auth.ts')).toBe('src/auth');
    });

    it('should match file paths correctly', () => {
      const testMatch = (importPath: string, targetPath: string): boolean => {
        const normalizedImport = normalizePath(importPath, workspaceRoot);
        const normalizedTarget = normalizePath(targetPath, workspaceRoot);
        return matchesFile(normalizedImport, normalizedTarget);
      };

      // Should match
      expect(testMatch('src/auth.ts', 'src/auth.js')).toBe(true);
      expect(testMatch('./auth', 'src/auth.ts')).toBe(true);

      // Should NOT match (avoiding false positives from substring matching)
      expect(testMatch('src/auth-service.ts', 'src/auth.ts')).toBe(false);
      expect(testMatch('src/auth.ts', 'src/auth-service.ts')).toBe(false);
    });
  });

  describe('Test File Detection', () => {
    it('should correctly identify test files', () => {
      expect(isTestFile('src/auth.test.ts')).toBe(true);
      expect(isTestFile('src/auth.spec.ts')).toBe(true);
      expect(isTestFile('tests/unit/auth.ts')).toBe(true);
      expect(isTestFile('__tests__/auth.ts')).toBe(true);
    });

    it('should NOT match false positives', () => {
      expect(isTestFile('src/auth.ts')).toBe(false);
      expect(isTestFile('src/contest.ts')).toBe(false);
      expect(isTestFile('latest/config.ts')).toBe(false);
    });
  });
});

// ============================================================================
// Helper Function Tests (New)
// ============================================================================

describe('get_files_context - Helper Functions', () => {
  describe('createPathCache', () => {
    it('should cache normalized paths', () => {
      const { normalize, cache } = createPathCache(workspaceRoot);

      // First call should add to cache
      const result1 = normalize('src/auth.ts');
      expect(result1).toBe('src/auth');
      expect(cache.has('src/auth.ts')).toBe(true);

      // Second call should return cached value
      const result2 = normalize('src/auth.ts');
      expect(result2).toBe('src/auth');

      // Different path should also be cached
      normalize('src/user.ts');
      expect(cache.size).toBe(2);
    });

    it('should handle multiple unique paths', () => {
      const { normalize, cache } = createPathCache(workspaceRoot);

      normalize('src/auth.ts');
      normalize('src/user.ts');
      normalize('src/api/index.ts');

      expect(cache.size).toBe(3);
    });
  });

  describe('searchFileChunks', () => {
    it('should use scanWithFilter with file paths instead of embeddings', async () => {
      const mockEmbeddings = {
        embed: vi.fn(),
      };

      const mockVectorDB = {
        scanWithFilter: vi.fn().mockResolvedValue([
          {
            content: 'chunk1',
            metadata: { file: 'src/auth.ts', startLine: 1, endLine: 10 },
            score: 0,
          },
        ]),
      };

      const ctx = {
        vectorDB: mockVectorDB as any,
        embeddings: mockEmbeddings as any,
        log: vi.fn(),
        workspaceRoot,
      };

      const result = await searchFileChunks(['src/auth.ts'], ctx);

      // Should use scanWithFilter, not embeddings
      expect(result[0]).toHaveLength(1);
      expect(mockVectorDB.scanWithFilter).toHaveBeenCalledWith(
        expect.objectContaining({
          file: ['src/auth.ts'],
          limit: 100,
        }),
      );
      expect(mockEmbeddings.embed).not.toHaveBeenCalled();
    });

    it('should filter chunks to only matching files', async () => {
      const mockVectorDB = {
        scanWithFilter: vi.fn().mockResolvedValue([
          {
            content: 'chunk1',
            metadata: { file: 'src/auth.ts', startLine: 1, endLine: 10 },
            score: 0,
          },
          {
            content: 'chunk2',
            metadata: { file: 'src/user.ts', startLine: 1, endLine: 10 },
            score: 0,
          },
          {
            content: 'chunk3',
            metadata: { file: 'src/auth.ts', startLine: 11, endLine: 20 },
            score: 0,
          },
        ]),
      };

      const ctx = {
        vectorDB: mockVectorDB as any,
        embeddings: {} as any,
        log: vi.fn(),
        workspaceRoot,
      };

      const result = await searchFileChunks(['src/auth.ts'], ctx);

      // Should only include chunks from auth.ts
      expect(result[0]).toHaveLength(2);
      expect(result[0].every(r => r.metadata.file === 'src/auth.ts')).toBe(true);
    });

    it('should batch query multiple filepaths in a single scanWithFilter call', async () => {
      const mockVectorDB = {
        scanWithFilter: vi.fn().mockResolvedValue([]),
      };

      const ctx = {
        vectorDB: mockVectorDB as any,
        embeddings: {} as any,
        log: vi.fn(),
        workspaceRoot,
      };

      await searchFileChunks(['src/auth.ts', 'src/user.ts', 'src/api.ts'], ctx);

      // Should make a single scanWithFilter call with all filepaths
      expect(mockVectorDB.scanWithFilter).toHaveBeenCalledTimes(1);
      expect(mockVectorDB.scanWithFilter).toHaveBeenCalledWith(
        expect.objectContaining({
          file: ['src/auth.ts', 'src/user.ts', 'src/api.ts'],
          limit: 300,
        }),
      );
    });
  });

  describe('findRelatedChunks', () => {
    it('should return empty arrays when no files have chunks', async () => {
      const ctx = {
        vectorDB: { search: vi.fn() } as any,
        embeddings: { embed: vi.fn() } as any,
        log: vi.fn(),
        workspaceRoot,
      };

      const result = await findRelatedChunks(
        ['src/auth.ts', 'src/user.ts'],
        [[], []], // No chunks found
        ctx,
      );

      expect(result).toEqual([[], []]);
      expect(ctx.embeddings.embed).not.toHaveBeenCalled();
    });

    it('should exclude chunks from the same file', async () => {
      const mockEmbeddings = {
        embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      };

      const mockVectorDB = {
        search: vi.fn().mockResolvedValue([
          {
            content: 'related1',
            metadata: { file: 'src/auth.ts', startLine: 50, endLine: 60 },
            score: 0.85,
          },
          {
            content: 'related2',
            metadata: { file: 'src/utils.ts', startLine: 1, endLine: 10 },
            score: 0.8,
          },
        ]),
      };

      const ctx = {
        vectorDB: mockVectorDB as any,
        embeddings: mockEmbeddings as any,
        log: vi.fn(),
        workspaceRoot,
      };

      const fileChunksMap = [
        [
          {
            content: 'auth chunk',
            metadata: { file: 'src/auth.ts', startLine: 1, endLine: 10 },
            score: 0.9,
          },
        ],
      ];

      const result = await findRelatedChunks(['src/auth.ts'], fileChunksMap as any, ctx);

      // Should exclude src/auth.ts chunk, only include src/utils.ts
      expect(result[0]).toHaveLength(1);
      expect(result[0][0].metadata.file).toBe('src/utils.ts');
    });

    it('should exclude markdown files from related chunks', async () => {
      const mockEmbeddings = {
        embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      };

      const mockVectorDB = {
        search: vi.fn().mockResolvedValue([
          {
            content: 'code chunk',
            metadata: { file: 'src/utils.ts', language: 'typescript', startLine: 1, endLine: 10 },
            score: 0.9,
          },
          {
            content: '# Auth docs',
            metadata: { file: 'docs/auth.md', language: 'markdown', startLine: 1, endLine: 5 },
            score: 0.85,
          },
          {
            content: 'more code',
            metadata: { file: 'src/helper.ts', language: 'typescript', startLine: 1, endLine: 8 },
            score: 0.8,
          },
        ]),
      };

      const ctx = {
        vectorDB: mockVectorDB as any,
        embeddings: mockEmbeddings as any,
        log: vi.fn(),
        workspaceRoot,
      };

      const fileChunksMap = [
        [
          {
            content: 'auth chunk',
            metadata: { file: 'src/auth.ts', startLine: 1, endLine: 10 },
            score: 0.9,
          },
        ],
      ];

      const result = await findRelatedChunks(['src/auth.ts'], fileChunksMap as any, ctx);

      expect(result[0]).toHaveLength(2);
      expect(result[0].map((r: any) => r.metadata.file)).toEqual(['src/utils.ts', 'src/helper.ts']);
    });
  });

  describe('findTestAssociations', () => {
    it('should find test files that import target', () => {
      const mockChunks = [
        mockSearchResult('src/__tests__/auth.test.ts', ['../auth', '../utils']),
        mockSearchResult('src/__tests__/user.test.ts', ['../user', '../auth']),
        mockSearchResult('src/helper.ts', ['./auth']),
      ];

      const ctx = {
        vectorDB: {} as any,
        embeddings: {} as any,
        log: vi.fn(),
        workspaceRoot,
      };

      const result = findTestAssociations(['src/auth.ts'], mockChunks, ctx);

      expect(result[0]).toHaveLength(2);
      expect(result[0]).toContain('src/__tests__/auth.test.ts');
      expect(result[0]).toContain('src/__tests__/user.test.ts');
    });

    it('should not include non-test files', () => {
      const mockChunks = [mockSearchResult('src/helper.ts', ['./auth'])];

      const ctx = {
        vectorDB: {} as any,
        embeddings: {} as any,
        log: vi.fn(),
        workspaceRoot,
      };

      const result = findTestAssociations(['src/auth.ts'], mockChunks, ctx);

      expect(result[0]).toHaveLength(0);
    });

    it('should handle chunks with no imports', () => {
      const mockChunks = [mockSearchResult('src/__tests__/auth.test.ts')];

      const ctx = {
        vectorDB: {} as any,
        embeddings: {} as any,
        log: vi.fn(),
        workspaceRoot,
      };

      const result = findTestAssociations(['src/auth.ts'], mockChunks, ctx);

      expect(result[0]).toHaveLength(0);
    });

    // #1040: C#'s enclosing-namespace test convention has no import
    // statement AND no basename relationship to its subject (unlike Go/Java's
    // tiers above) -- see `collectCSharpNamespaceTestFiles`.
    it('associates a C# test file with its subject via enclosing-namespace access, with no import and no basename match (#1040)', () => {
      const mockChunks = [
        mockCSharpChunk({
          file: 'src/MediatR/IRequestHandler.cs',
          symbolName: 'IRequestHandler',
          namespace: 'MediatR',
          declares: true,
        }),
        mockCSharpChunk({
          file: 'test/MediatR.Tests/PipelineTests.cs',
          symbolName: 'TestMethod',
          namespace: 'MediatR.Tests',
          references: ['IRequestHandler'],
        }),
      ];

      const ctx = {
        vectorDB: {} as any,
        embeddings: {} as any,
        log: vi.fn(),
        workspaceRoot,
      };

      const result = findTestAssociations(['src/MediatR/IRequestHandler.cs'], mockChunks, ctx);

      expect(result[0]).toEqual(['test/MediatR.Tests/PipelineTests.cs']);
    });

    // #1005 Phase 2, Item 2: Kotlin's same-package test convention -- like
    // C#'s above, no import statement AND (unlike Java's) no basename
    // relationship required.
    it('associates a Kotlin test file with its subject via same-package access, with no import at all (#1005 Phase 2)', () => {
      const mockChunks = [
        mockKotlinChunk({
          file: 'src/main/kotlin/a/b/Foo.kt',
          symbolName: 'Foo',
          pkg: 'a.b',
          declares: true,
        }),
        mockKotlinChunk({
          file: 'src/test/kotlin/a/b/FooCoverage.kt',
          symbolName: 'testMethod',
          pkg: 'a.b',
          references: ['Foo'],
        }),
      ];

      const ctx = {
        vectorDB: {} as any,
        embeddings: {} as any,
        log: vi.fn(),
        workspaceRoot,
      };

      const result = findTestAssociations(['src/main/kotlin/a/b/Foo.kt'], mockChunks, ctx);

      expect(result[0]).toEqual(['src/test/kotlin/a/b/FooCoverage.kt']);
    });

    // #1005 Phase 2, Item 2, AC8: `resolveJvmSamePackageDependents` requires
    // an EXACT `chunk.metadata.file` string match. Without canonicalizing
    // both the index-build side and the query side (see
    // `buildJvmTestIndexFromChunks`/`collectKotlinSamePackageTestFiles`),
    // a query filepath in a different (but equivalent, under the same
    // workspaceRoot) form than the chunk's own ABSOLUTE `metadata.file`
    // would silently return zero associations -- exactly the kind of
    // clean-looking-but-wrong zero this repo's index-state-honesty policy
    // forbids. This proves it does not.
    it('does not silently return zero associations when the query filepath form differs from an absolute chunk.metadata.file (#1005 Phase 2 AC8)', () => {
      const mockChunks = [
        mockKotlinChunk({
          file: `${workspaceRoot}/src/main/kotlin/a/b/Foo.kt`,
          symbolName: 'Foo',
          pkg: 'a.b',
          declares: true,
        }),
        mockKotlinChunk({
          file: `${workspaceRoot}/src/test/kotlin/a/b/FooCoverage.kt`,
          symbolName: 'testMethod',
          pkg: 'a.b',
          references: ['Foo'],
        }),
      ];

      const ctx = {
        vectorDB: {} as any,
        embeddings: {} as any,
        log: vi.fn(),
        workspaceRoot,
      };

      // Query with the WORKSPACE-RELATIVE form -- a different raw string
      // than the chunks' absolute `metadata.file` above, but the same file
      // once canonicalized against workspaceRoot. This file's convention
      // (unlike `@liendev/parser`'s `test-associations.ts`) canonicalizes
      // every tier's output, so the expected result is the CANONICAL
      // (workspace-relative) form, not the chunks' raw absolute one.
      const result = findTestAssociations(['src/main/kotlin/a/b/Foo.kt'], mockChunks, ctx);

      expect(result[0]).toEqual(['src/test/kotlin/a/b/FooCoverage.kt']);
    });
  });

  describe('deduplicateChunks', () => {
    it('should remove duplicate chunks by file + line range', () => {
      const chunks = [
        {
          content: 'chunk1',
          metadata: { file: 'src/auth.ts', startLine: 1, endLine: 10 },
          score: 0.9,
        },
        {
          content: 'chunk1',
          metadata: { file: 'src/auth.ts', startLine: 1, endLine: 10 },
          score: 0.85,
        }, // Duplicate
        {
          content: 'chunk2',
          metadata: { file: 'src/auth.ts', startLine: 11, endLine: 20 },
          score: 0.8,
        },
      ];

      const result = deduplicateChunks(chunks as any, []);

      expect(result).toHaveLength(2);
      expect(result[0].metadata.startLine).toBe(1);
      expect(result[1].metadata.startLine).toBe(11);
    });

    it('should merge file chunks and related chunks', () => {
      const fileChunks = [
        {
          content: 'file',
          metadata: { file: 'src/auth.ts', startLine: 1, endLine: 10 },
          score: 0.9,
        },
      ];
      const relatedChunks = [
        {
          content: 'related',
          metadata: { file: 'src/utils.ts', startLine: 1, endLine: 10 },
          score: 0.8,
        },
      ];

      const result = deduplicateChunks(fileChunks as any, relatedChunks as any);

      expect(result).toHaveLength(2);
    });

    it('should deduplicate by file + startLine + endLine', () => {
      const chunks = [
        {
          content: 'chunk1',
          metadata: { file: 'src/auth.ts', startLine: 1, endLine: 10 },
          score: 0.9,
        },
        {
          content: 'chunk1',
          metadata: { file: 'src/auth.ts', startLine: 1, endLine: 10 },
          score: 0.85,
        }, // Same key
      ];

      const result = deduplicateChunks(chunks as any, []);

      expect(result).toHaveLength(1);
    });
  });

  describe('buildFilesData', () => {
    it('should combine chunks and test associations per file', () => {
      const filepaths = ['src/auth.ts', 'src/user.ts'];
      const fileChunksMap = [
        [
          {
            content: 'auth',
            metadata: { file: 'src/auth.ts', startLine: 1, endLine: 10 },
            score: 0.9,
          },
        ],
        [
          {
            content: 'user',
            metadata: { file: 'src/user.ts', startLine: 1, endLine: 10 },
            score: 0.8,
          },
        ],
      ];
      const relatedChunksMap = [
        [
          {
            content: 'related',
            metadata: { file: 'src/utils.ts', startLine: 1, endLine: 10 },
            score: 0.7,
          },
        ],
        [],
      ];
      const testAssociationsMap = [['src/__tests__/auth.test.ts'], ['src/__tests__/user.test.ts']];

      const result = buildFilesData(
        filepaths,
        fileChunksMap as any,
        relatedChunksMap as any,
        testAssociationsMap,
      );

      expect(Object.keys(result)).toEqual(['src/auth.ts', 'src/user.ts']);
      expect(result['src/auth.ts'].chunks).toHaveLength(2); // file + related
      expect(result['src/auth.ts'].testAssociations).toEqual(['src/__tests__/auth.test.ts']);
      expect(result['src/user.ts'].chunks).toHaveLength(1);
      expect(result['src/user.ts'].testAssociations).toEqual(['src/__tests__/user.test.ts']);
    });

    it('should handle empty related chunks', () => {
      const result = buildFilesData(
        ['src/auth.ts'],
        [
          [
            {
              content: 'auth',
              metadata: { file: 'src/auth.ts', startLine: 1, endLine: 10 },
              score: 0.9,
            },
          ],
        ] as any,
        [], // Empty related chunks
        [['src/__tests__/auth.test.ts']],
      );

      expect(result['src/auth.ts'].chunks).toHaveLength(1);
    });
  });
});

// ============================================================================
// Response Format Validation (Existing Tests)
// ============================================================================

describe('get_files_context - Response Structure', () => {
  describe('Response Format Validation', () => {
    it('should have correct structure for single file response', () => {
      // Expected format for single file input
      const singleFileResponse = {
        indexInfo: {
          indexVersion: 123,
          indexDate: '2025-12-01',
        },
        file: 'src/auth.ts',
        chunks: [
          {
            content: 'export function login() {}',
            metadata: {
              file: 'src/auth.ts',
              startLine: 1,
              endLine: 3,
              language: 'typescript',
            },
            score: 0.9,
          },
        ],
        testAssociations: ['src/__tests__/auth.test.ts'],
      };

      // Validate structure
      expect(singleFileResponse).toHaveProperty('indexInfo');
      expect(singleFileResponse).toHaveProperty('file');
      expect(singleFileResponse).toHaveProperty('chunks');
      expect(singleFileResponse).toHaveProperty('testAssociations');
      expect(Array.isArray(singleFileResponse.chunks)).toBe(true);
      expect(Array.isArray(singleFileResponse.testAssociations)).toBe(true);

      // Should NOT have 'files' property (that's for multi-file)
      expect(singleFileResponse).not.toHaveProperty('files');
    });

    it('should have correct structure for multi-file response', () => {
      // Expected format for multiple file input
      const multiFileResponse = {
        indexInfo: {
          indexVersion: 123,
          indexDate: '2025-12-01',
        },
        files: {
          'src/auth.ts': {
            chunks: [
              {
                content: 'export function login() {}',
                metadata: {
                  file: 'src/auth.ts',
                  startLine: 1,
                  endLine: 3,
                  language: 'typescript',
                },
                score: 0.9,
              },
            ],
            testAssociations: ['src/__tests__/auth.test.ts'],
          },
          'src/user.ts': {
            chunks: [
              {
                content: 'export class User {}',
                metadata: {
                  file: 'src/user.ts',
                  startLine: 1,
                  endLine: 5,
                  language: 'typescript',
                },
                score: 0.95,
              },
            ],
            testAssociations: ['src/__tests__/user.test.ts'],
          },
        },
      };

      // Validate structure
      expect(multiFileResponse).toHaveProperty('indexInfo');
      expect(multiFileResponse).toHaveProperty('files');
      expect(typeof multiFileResponse.files).toBe('object');

      // Should NOT have 'file' or 'chunks' at top level (that's for single file)
      expect(multiFileResponse).not.toHaveProperty('file');
      expect(multiFileResponse).not.toHaveProperty('chunks');

      // Each file should have chunks and testAssociations
      for (const filepath of Object.keys(multiFileResponse.files)) {
        const fileData = multiFileResponse.files[filepath as keyof typeof multiFileResponse.files];
        expect(fileData).toHaveProperty('chunks');
        expect(fileData).toHaveProperty('testAssociations');
        expect(Array.isArray(fileData.chunks)).toBe(true);
        expect(Array.isArray(fileData.testAssociations)).toBe(true);
      }
    });
  });

  describe('Chunk Deduplication', () => {
    it('should deduplicate chunks by file + line range', () => {
      const chunks = [
        {
          content: 'export function login() {}',
          metadata: {
            file: 'src/auth.ts',
            startLine: 1,
            endLine: 3,
            language: 'typescript',
          },
          score: 0.9,
        },
        {
          content: 'export function login() {}',
          metadata: {
            file: 'src/auth.ts',
            startLine: 1,
            endLine: 3,
            language: 'typescript',
          },
          score: 0.85, // Different score, same chunk
        },
        {
          content: 'export function logout() {}',
          metadata: {
            file: 'src/auth.ts',
            startLine: 5,
            endLine: 7,
            language: 'typescript',
          },
          score: 0.8,
        },
      ];

      // Deduplicate
      const seenChunks = new Set<string>();
      const deduplicated = chunks.filter(chunk => {
        const chunkId = `${chunk.metadata.file}:${chunk.metadata.startLine}-${chunk.metadata.endLine}`;
        if (seenChunks.has(chunkId)) return false;
        seenChunks.add(chunkId);
        return true;
      });

      expect(deduplicated).toHaveLength(2);
      expect(deduplicated[0].metadata.startLine).toBe(1);
      expect(deduplicated[1].metadata.startLine).toBe(5);
    });
  });

  describe('Test Association Detection', () => {
    it('should find test files that import a source file', () => {
      // Mock chunks representing test files
      const mockChunks = [
        {
          metadata: {
            file: 'src/__tests__/auth.test.ts',
            imports: ['../auth', '../utils'],
            startLine: 1,
            endLine: 10,
          },
        },
        {
          metadata: {
            file: 'src/__tests__/user.test.ts',
            imports: ['../user', '../auth'],
            startLine: 1,
            endLine: 15,
          },
        },
        {
          metadata: {
            file: 'src/helper.ts',
            imports: ['./auth'],
            startLine: 1,
            endLine: 5,
          },
        },
      ];

      // Find tests that import 'src/auth.ts'
      const targetNormalized = normalizePath('src/auth.ts', workspaceRoot);
      const testFiles = new Set<string>();

      for (const chunk of mockChunks) {
        const chunkFile = getCanonicalPath(chunk.metadata.file, workspaceRoot);

        // Skip if not a test file
        if (!isTestFile(chunkFile)) continue;

        // Check if this test file imports the target
        const imports = chunk.metadata.imports || [];
        for (const imp of imports) {
          const normalizedImport = normalizePath(imp, workspaceRoot);
          if (matchesFile(normalizedImport, targetNormalized)) {
            testFiles.add(chunkFile);
            break;
          }
        }
      }

      expect(testFiles.size).toBe(2);
      expect(testFiles.has('src/__tests__/auth.test.ts')).toBe(true);
      expect(testFiles.has('src/__tests__/user.test.ts')).toBe(true);
      expect(testFiles.has('src/helper.ts')).toBe(false); // Not a test file
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty test associations', () => {
      const response = {
        indexInfo: { indexVersion: 123, indexDate: '2025-12-01' },
        file: 'src/auth.ts',
        chunks: [],
        testAssociations: [], // No tests found
      };

      expect(response.testAssociations).toEqual([]);
    });

    it('should handle file with no chunks', () => {
      const response = {
        indexInfo: { indexVersion: 123, indexDate: '2025-12-01' },
        files: {
          'src/auth.ts': {
            chunks: [], // No chunks found
            testAssociations: [],
          },
        },
      };

      expect(response.files['src/auth.ts'].chunks).toEqual([]);
    });
  });
});
