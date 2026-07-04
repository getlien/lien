import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSemanticSearch } from './semantic-search.js';
import type { ToolContext } from '../types.js';
import type { SearchResult } from '@liendev/core';

describe('handleSemanticSearch', () => {
  const mockLog = vi.fn();
  const mockCheckAndReconnect = vi.fn().mockResolvedValue(undefined);
  const mockGetIndexMetadata = vi.fn(() => ({
    indexVersion: 1234567890,
    indexDate: '2025-12-19',
  }));

  // Default metadata for mock results
  const defaultMetadata = {
    file: 'src/example.ts',
    startLine: 1,
    endLine: 10,
    type: 'function' as const,
    language: 'typescript',
    symbolName: 'example',
    symbolType: 'function' as const,
  };

  // Helper to create mock search results
  function createMockResult(
    overrides: {
      content?: string;
      metadata?: Partial<typeof defaultMetadata & { repoId?: string }>;
      score?: number;
      relevance?: 'highly_relevant' | 'relevant' | 'loosely_related' | 'not_relevant';
    } = {},
  ): SearchResult {
    return {
      content: overrides.content ?? 'function example() { return true; }',
      metadata: {
        ...defaultMetadata,
        ...overrides.metadata,
      },
      score: overrides.score ?? 0.5,
      relevance: overrides.relevance ?? 'highly_relevant',
    };
  }

  let mockVectorDB: {
    search: ReturnType<typeof vi.fn>;
    supportsCrossRepo: boolean;
  };

  let mockCtx: ToolContext;

  beforeEach(() => {
    vi.clearAllMocks();

    mockVectorDB = {
      search: vi.fn(),
      supportsCrossRepo: false,
    };

    mockCtx = {
      vectorDB: mockVectorDB as any,
      log: mockLog,
      checkAndReconnect: mockCheckAndReconnect,
      getIndexMetadata: mockGetIndexMetadata,
      getReindexState: vi.fn(() => ({
        inProgress: false,
        pendingFiles: [],
        lastReindexTimestamp: null,
        lastReindexDurationMs: null,
      })),
      rootDir: '/fake/workspace',
    };
  });

  describe('basic search', () => {
    it('should return search results with indexInfo', async () => {
      const mockResults = [
        createMockResult({
          content: 'function handleAuth() {}',
          metadata: { file: 'src/auth.ts', startLine: 1, endLine: 10 },
        }),
        createMockResult({
          content: 'function validateUser() {}',
          metadata: { file: 'src/validate.ts', startLine: 1, endLine: 10 },
        }),
      ];
      mockVectorDB.search.mockResolvedValue(mockResults);

      const result = await handleSemanticSearch({ query: 'handles user authentication' }, mockCtx);

      expect(mockVectorDB.search).toHaveBeenCalled();
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(2);
      expect(parsed.indexInfo).toEqual({
        indexVersion: 1234567890,
        indexDate: '2025-12-19',
      });
    });

    it('should respect limit parameter', async () => {
      const mockResults = [
        createMockResult({ content: 'result 1' }),
        createMockResult({ content: 'result 2' }),
        createMockResult({ content: 'result 3' }),
      ];
      mockVectorDB.search.mockResolvedValue(mockResults);

      await handleSemanticSearch({ query: 'test query here', limit: 10 }, mockCtx);

      // Lexical search: the query text and limit are passed directly.
      expect(mockVectorDB.search).toHaveBeenCalledWith('test query here', 10);
    });

    it('should use default limit of 5 when not specified', async () => {
      mockVectorDB.search.mockResolvedValue([]);

      await handleSemanticSearch({ query: 'test query here' }, mockCtx);

      expect(mockVectorDB.search).toHaveBeenCalledWith('test query here', 5);
    });

    it('should call checkAndReconnect before searching', async () => {
      mockVectorDB.search.mockResolvedValue([]);

      await handleSemanticSearch({ query: 'test query here' }, mockCtx);

      expect(mockCheckAndReconnect).toHaveBeenCalled();
    });

    it('should run lexical search with the raw query text', async () => {
      mockVectorDB.search.mockResolvedValue([]);

      await handleSemanticSearch({ query: 'handles authentication' }, mockCtx);

      // Lexical FTS5 path: the query string is passed straight to search().
      expect(mockVectorDB.search).toHaveBeenCalledWith('handles authentication', 5);
    });

    it('should handle empty results gracefully', async () => {
      mockVectorDB.search.mockResolvedValue([]);

      const result = await handleSemanticSearch({ query: 'nonexistent feature' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(0);
      expect(parsed.indexInfo).toBeDefined();
    });

    it('should include diagnostic note when search returns empty results', async () => {
      mockVectorDB.search.mockResolvedValue([]);

      const result = await handleSemanticSearch({ query: 'nonexistent feature' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(0);
      expect(parsed.note).toContain('0 results');
      expect(parsed.note).toContain('grep');
      expect(parsed.note).toContain('lien index');
    });
  });

  describe('cross-repo fallback (unsupported by the bundled backend)', () => {
    it('should fall back to single-repo search when crossRepo=true', async () => {
      const mockResults = [createMockResult()];
      mockVectorDB.search.mockResolvedValue(mockResults);

      const result = await handleSemanticSearch(
        { query: 'test fallback query', crossRepo: true },
        mockCtx,
      );

      // Should log a warning
      expect(mockLog).toHaveBeenCalledWith(
        'Warning: crossRepo=true requires a cross-repo-capable backend. Falling back to single-repo search.',
        'warning',
      );

      // Should use regular lexical search
      expect(mockVectorDB.search).toHaveBeenCalled();

      // Should not include groupedByRepo in response (single-repo backend)
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.groupedByRepo).toBeUndefined();
    });

    it('should still return results when falling back', async () => {
      const mockResults = [
        createMockResult({ content: 'fallback result 1', metadata: { file: 'src/fb1.ts' } }),
        createMockResult({ content: 'fallback result 2', metadata: { file: 'src/fb2.ts' } }),
      ];
      mockVectorDB.search.mockResolvedValue(mockResults);

      const result = await handleSemanticSearch(
        { query: 'test fallback results', crossRepo: true },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(2);
      expect(parsed.indexInfo).toBeDefined();
    });
  });

  describe('validation', () => {
    it('should reject queries shorter than 3 characters', async () => {
      const result = await handleSemanticSearch({ query: 'ab' }, mockCtx);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.error).toBe('Invalid parameters');
      expect(parsed.details).toContainEqual(
        expect.objectContaining({
          field: 'query',
          message: expect.stringContaining('at least 3 characters'),
        }),
      );
    });

    it('should reject empty query', async () => {
      const result = await handleSemanticSearch({ query: '' }, mockCtx);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.error).toBe('Invalid parameters');
    });

    it('should reject limit below 1', async () => {
      const result = await handleSemanticSearch({ query: 'valid query', limit: 0 }, mockCtx);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.details).toContainEqual(
        expect.objectContaining({
          field: 'limit',
          message: expect.stringContaining('at least 1'),
        }),
      );
    });

    it('should reject limit above 50', async () => {
      const result = await handleSemanticSearch({ query: 'valid query', limit: 100 }, mockCtx);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.details).toContainEqual(
        expect.objectContaining({
          field: 'limit',
          message: expect.stringContaining('cannot exceed 50'),
        }),
      );
    });

    it('should accept valid parameters at boundary values', async () => {
      mockVectorDB.search.mockResolvedValue([]);

      // Test minimum valid query (3 chars)
      const result1 = await handleSemanticSearch({ query: 'abc' }, mockCtx);
      expect(result1.isError).toBeUndefined();

      // Test maximum valid limit (50)
      const result2 = await handleSemanticSearch({ query: 'valid query', limit: 50 }, mockCtx);
      expect(result2.isError).toBeUndefined();
    });
  });

  describe('empty result signaling', () => {
    it('should return empty results with note when all results are not_relevant', async () => {
      const mockResults = [
        createMockResult({ relevance: 'not_relevant', metadata: { file: 'src/a.ts' } }),
        createMockResult({ relevance: 'not_relevant', metadata: { file: 'src/b.ts' } }),
      ];
      mockVectorDB.search.mockResolvedValue(mockResults);

      const result = await handleSemanticSearch({ query: 'something irrelevant' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(0);
      expect(parsed.note).toContain('No relevant matches found.');
      expect(parsed.note).toContain('0 results');
      expect(parsed.indexInfo).toBeDefined();
    });

    it('should merge crossRepo fallback note with not_relevant note', async () => {
      const mockResults = [
        createMockResult({ relevance: 'not_relevant', metadata: { file: 'src/a.ts' } }),
      ];
      mockVectorDB.search.mockResolvedValue(mockResults);

      const result = await handleSemanticSearch(
        { query: 'something irrelevant', crossRepo: true },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(0);
      expect(parsed.note).toContain('Cross-repo search requires a cross-repo-capable backend');
      expect(parsed.note).toContain('No relevant matches found.');
    });

    it('should keep results when at least one is relevant', async () => {
      const mockResults = [
        createMockResult({ relevance: 'not_relevant', metadata: { file: 'src/a.ts' } }),
        createMockResult({ relevance: 'relevant', metadata: { file: 'src/b.ts' } }),
      ];
      mockVectorDB.search.mockResolvedValue(mockResults);

      const result = await handleSemanticSearch({ query: 'partially relevant' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(2);
    });
  });

  describe('logging', () => {
    it('should log search query', async () => {
      mockVectorDB.search.mockResolvedValue([]);

      await handleSemanticSearch({ query: 'authentication handler' }, mockCtx);

      expect(mockLog).toHaveBeenCalledWith('Searching for: "authentication handler"');
    });

    it('should indicate cross-repo in log when enabled', async () => {
      mockVectorDB.search.mockResolvedValue([]);

      await handleSemanticSearch({ query: 'cross repo test', crossRepo: true }, mockCtx);

      expect(mockLog).toHaveBeenCalledWith('Searching for: "cross repo test" (cross-repo)');
    });

    it('should log result count', async () => {
      const mockResults = [createMockResult(), createMockResult(), createMockResult()];
      mockVectorDB.search.mockResolvedValue(mockResults);

      await handleSemanticSearch({ query: 'test query here' }, mockCtx);

      expect(mockLog).toHaveBeenCalledWith('Found 3 results');
    });
  });
});
