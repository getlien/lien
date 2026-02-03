import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSemanticSearch } from './semantic-search.js';
import type { ToolContext } from '../types.js';
import type { SearchResult } from '@liendev/core';
import { QdrantDB } from '@liendev/core';

describe('handleSemanticSearch', () => {
  const mockLog = vi.fn();
  const mockCheckAndReconnect = vi.fn().mockResolvedValue(undefined);
  const mockGetIndexMetadata = vi.fn(() => ({
    indexVersion: 1234567890,
    indexDate: '2025-12-19',
  }));

  const mockEmbeddings = {
    embed: vi.fn().mockResolvedValue(new Float32Array([0.1, 0.2, 0.3])),
  };

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
  function createMockResult(overrides: {
    content?: string;
    metadata?: Partial<typeof defaultMetadata & { repoId?: string }>;
    score?: number;
    relevance?: 'highly_relevant' | 'relevant' | 'loosely_related' | 'not_relevant';
  } = {}): SearchResult {
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
    searchCrossRepo: ReturnType<typeof vi.fn>;
  };

  let mockCtx: ToolContext;

  beforeEach(() => {
    vi.clearAllMocks();

    mockVectorDB = {
      search: vi.fn(),
      searchCrossRepo: vi.fn(),
    };

    mockCtx = {
      vectorDB: mockVectorDB as any,
      embeddings: mockEmbeddings as any,
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
        createMockResult({ content: 'function handleAuth() {}', metadata: { file: 'src/auth.ts', startLine: 1, endLine: 10 } }),
        createMockResult({ content: 'function validateUser() {}', metadata: { file: 'src/validate.ts', startLine: 1, endLine: 10 } }),
      ];
      mockVectorDB.search.mockResolvedValue(mockResults);

      const result = await handleSemanticSearch(
        { query: 'handles user authentication' },
        mockCtx
      );

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

      await handleSemanticSearch(
        { query: 'test query here', limit: 10 },
        mockCtx
      );

      // Verify limit was passed to search
      expect(mockVectorDB.search).toHaveBeenCalledWith(
        expect.any(Float32Array),
        10,
        'test query here'
      );
    });

    it('should use default limit of 5 when not specified', async () => {
      mockVectorDB.search.mockResolvedValue([]);

      await handleSemanticSearch(
        { query: 'test query here' },
        mockCtx
      );

      expect(mockVectorDB.search).toHaveBeenCalledWith(
        expect.any(Float32Array),
        5,
        'test query here'
      );
    });

    it('should call checkAndReconnect before searching', async () => {
      mockVectorDB.search.mockResolvedValue([]);

      await handleSemanticSearch(
        { query: 'test query here' },
        mockCtx
      );

      expect(mockCheckAndReconnect).toHaveBeenCalled();
    });

    it('should embed the query before searching', async () => {
      mockVectorDB.search.mockResolvedValue([]);

      await handleSemanticSearch(
        { query: 'handles authentication' },
        mockCtx
      );

      expect(mockEmbeddings.embed).toHaveBeenCalledWith('handles authentication');
    });

    it('should handle empty results gracefully', async () => {
      mockVectorDB.search.mockResolvedValue([]);

      const result = await handleSemanticSearch(
        { query: 'nonexistent feature' },
        mockCtx
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(0);
      expect(parsed.indexInfo).toBeDefined();
    });

    it('should include diagnostic note when search returns empty results', async () => {
      mockVectorDB.search.mockResolvedValue([]);

      const result = await handleSemanticSearch(
        { query: 'nonexistent feature' },
        mockCtx
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(0);
      expect(parsed.note).toContain('0 results');
      expect(parsed.note).toContain('grep');
      expect(parsed.note).toContain('lien reindex');
    });
  });

  describe('cross-repo search with Qdrant', () => {
    // Create a mock that passes instanceof QdrantDB check
    let mockQdrantDB: any;

    beforeEach(() => {
      // Create a mock object and set its prototype to QdrantDB.prototype
      mockQdrantDB = {
        search: vi.fn(),
        searchCrossRepo: vi.fn(),
      };
      Object.setPrototypeOf(mockQdrantDB, QdrantDB.prototype);

      mockCtx = {
        vectorDB: mockQdrantDB,
        embeddings: mockEmbeddings as any,
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

    it('should use searchCrossRepo when crossRepo=true and using Qdrant', async () => {
      const mockResults = [
        createMockResult({ metadata: { repoId: 'repo-a', file: 'src/a.ts' } }),
        createMockResult({ metadata: { repoId: 'repo-b', file: 'src/b.ts' } }),
      ];
      mockQdrantDB.searchCrossRepo.mockResolvedValue(mockResults);

      const result = await handleSemanticSearch(
        { query: 'cross repo search', crossRepo: true },
        mockCtx
      );

      expect(mockQdrantDB.searchCrossRepo).toHaveBeenCalledWith(
        expect.any(Float32Array),
        5,
        { repoIds: undefined }
      );
      expect(mockQdrantDB.search).not.toHaveBeenCalled();

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(2);
      expect(parsed.groupedByRepo).toBeDefined();
    });

    it('should group results by repository when crossRepo=true', async () => {
      const mockResults = [
        createMockResult({ content: 'result 1', metadata: { repoId: 'repo-a', file: 'src/a1.ts' } }),
        createMockResult({ content: 'result 2', metadata: { repoId: 'repo-a', file: 'src/a2.ts' } }),
        createMockResult({ content: 'result 3', metadata: { repoId: 'repo-b', file: 'src/b1.ts' } }),
      ];
      mockQdrantDB.searchCrossRepo.mockResolvedValue(mockResults);

      const result = await handleSemanticSearch(
        { query: 'test cross repo', crossRepo: true },
        mockCtx
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.groupedByRepo).toBeDefined();
      expect(parsed.groupedByRepo['repo-a']).toHaveLength(2);
      expect(parsed.groupedByRepo['repo-b']).toHaveLength(1);
    });

    it('should filter by repoIds when provided', async () => {
      mockQdrantDB.searchCrossRepo.mockResolvedValue([]);

      await handleSemanticSearch(
        { query: 'filtered search', crossRepo: true, repoIds: ['repo-a', 'repo-c'] },
        mockCtx
      );

      expect(mockQdrantDB.searchCrossRepo).toHaveBeenCalledWith(
        expect.any(Float32Array),
        5,
        { repoIds: ['repo-a', 'repo-c'] }
      );
    });
  });

  describe('cross-repo fallback (non-Qdrant)', () => {
    it('should fall back to single-repo search when crossRepo=true but not using Qdrant', async () => {
      const mockResults = [createMockResult()];
      mockVectorDB.search.mockResolvedValue(mockResults);

      const result = await handleSemanticSearch(
        { query: 'test fallback query', crossRepo: true },
        mockCtx
      );

      // Should log a warning
      expect(mockLog).toHaveBeenCalledWith(
        'Warning: crossRepo=true requires Qdrant backend. Falling back to single-repo search.',
        'warning'
      );

      // Should use regular search, not searchCrossRepo
      expect(mockVectorDB.search).toHaveBeenCalled();
      expect(mockVectorDB.searchCrossRepo).not.toHaveBeenCalled();

      // Should not include groupedByRepo in response
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
        mockCtx
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(2);
      expect(parsed.indexInfo).toBeDefined();
    });
  });

  describe('validation', () => {
    it('should reject queries shorter than 3 characters', async () => {
      const result = await handleSemanticSearch(
        { query: 'ab' },
        mockCtx
      );

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.error).toBe('Invalid parameters');
      expect(parsed.details).toContainEqual(
        expect.objectContaining({
          field: 'query',
          message: expect.stringContaining('at least 3 characters'),
        })
      );
    });

    it('should reject empty query', async () => {
      const result = await handleSemanticSearch(
        { query: '' },
        mockCtx
      );

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.error).toBe('Invalid parameters');
    });

    it('should reject limit below 1', async () => {
      const result = await handleSemanticSearch(
        { query: 'valid query', limit: 0 },
        mockCtx
      );

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.details).toContainEqual(
        expect.objectContaining({
          field: 'limit',
          message: expect.stringContaining('at least 1'),
        })
      );
    });

    it('should reject limit above 50', async () => {
      const result = await handleSemanticSearch(
        { query: 'valid query', limit: 100 },
        mockCtx
      );

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.details).toContainEqual(
        expect.objectContaining({
          field: 'limit',
          message: expect.stringContaining('cannot exceed 50'),
        })
      );
    });

    it('should accept valid parameters at boundary values', async () => {
      mockVectorDB.search.mockResolvedValue([]);

      // Test minimum valid query (3 chars)
      const result1 = await handleSemanticSearch(
        { query: 'abc' },
        mockCtx
      );
      expect(result1.isError).toBeUndefined();

      // Test maximum valid limit (50)
      const result2 = await handleSemanticSearch(
        { query: 'valid query', limit: 50 },
        mockCtx
      );
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

      const result = await handleSemanticSearch(
        { query: 'something irrelevant' },
        mockCtx
      );

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
        mockCtx
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(0);
      expect(parsed.note).toContain('Cross-repo search requires Qdrant backend');
      expect(parsed.note).toContain('No relevant matches found.');
    });

    it('should keep results when at least one is relevant', async () => {
      const mockResults = [
        createMockResult({ relevance: 'not_relevant', metadata: { file: 'src/a.ts' } }),
        createMockResult({ relevance: 'relevant', metadata: { file: 'src/b.ts' } }),
      ];
      mockVectorDB.search.mockResolvedValue(mockResults);

      const result = await handleSemanticSearch(
        { query: 'partially relevant' },
        mockCtx
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(2);
    });
  });

  describe('logging', () => {
    it('should log search query', async () => {
      mockVectorDB.search.mockResolvedValue([]);

      await handleSemanticSearch(
        { query: 'authentication handler' },
        mockCtx
      );

      expect(mockLog).toHaveBeenCalledWith(
        'Searching for: "authentication handler"'
      );
    });

    it('should indicate cross-repo in log when enabled', async () => {
      mockVectorDB.search.mockResolvedValue([]);

      await handleSemanticSearch(
        { query: 'cross repo test', crossRepo: true },
        mockCtx
      );

      expect(mockLog).toHaveBeenCalledWith(
        'Searching for: "cross repo test" (cross-repo)'
      );
    });

    it('should log result count', async () => {
      const mockResults = [
        createMockResult(),
        createMockResult(),
        createMockResult(),
      ];
      mockVectorDB.search.mockResolvedValue(mockResults);

      await handleSemanticSearch(
        { query: 'test query here' },
        mockCtx
      );

      expect(mockLog).toHaveBeenCalledWith('Found 3 results');
    });
  });
});

