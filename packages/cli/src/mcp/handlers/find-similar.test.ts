import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleFindSimilar } from './find-similar.js';
import type { ToolContext } from '../types.js';
import type { SearchResult } from '@liendev/core';

describe('handleFindSimilar', () => {
  const mockLog = vi.fn();
  const mockCheckAndReconnect = vi.fn().mockResolvedValue(undefined);
  const mockGetIndexMetadata = vi.fn(() => ({
    indexVersion: 1234567890,
    indexDate: '2025-12-19',
  }));

  const mockEmbeddings = {
    embed: vi.fn().mockResolvedValue(new Float32Array([0.1, 0.2, 0.3])),
  };

  let mockVectorDB: {
    search: ReturnType<typeof vi.fn>;
  };

  let mockCtx: ToolContext;

  // Default metadata for mock results
  const defaultMetadata = {
    file: 'src/example.ts',
    startLine: 1,
    endLine: 5,
    type: 'function' as const,
    language: 'typescript',
    symbolName: 'example',
    symbolType: 'function' as const,
  };

  // Helper to create mock search results
  function createMockResult(
    overrides: {
      content?: string;
      metadata?: Partial<typeof defaultMetadata>;
      score?: number;
      relevance?: 'highly_relevant' | 'relevant' | 'loosely_related' | 'not_relevant';
    } = {},
  ): SearchResult {
    return {
      content: overrides.content ?? 'function example() {}',
      metadata: {
        ...defaultMetadata,
        ...overrides.metadata,
      },
      score: overrides.score ?? 0.5,
      relevance: overrides.relevance ?? 'highly_relevant',
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();

    mockVectorDB = {
      search: vi.fn(),
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
    it('should return search results without filters', async () => {
      const mockResults = [
        createMockResult({
          content: 'function fetchUser() {}',
          metadata: { file: 'src/fetch.ts' },
        }),
        createMockResult({ content: 'function getUser() {}', metadata: { file: 'src/get.ts' } }),
      ];
      mockVectorDB.search.mockResolvedValue(mockResults);

      const result = await handleFindSimilar(
        { code: 'async function fetchData() { return await db.find(); }' },
        mockCtx,
      );

      expect(mockVectorDB.search).toHaveBeenCalled();
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(2);
      expect(parsed.indexInfo).toBeDefined();
    });

    it('should include index metadata in response', async () => {
      mockVectorDB.search.mockResolvedValue([]);

      const result = await handleFindSimilar(
        { code: 'async function fetchData() { return await db.find(); }' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.indexInfo).toEqual({
        indexVersion: 1234567890,
        indexDate: '2025-12-19',
      });
    });
  });

  describe('language filter', () => {
    it('should filter results by language (case-insensitive)', async () => {
      const mockResults = [
        createMockResult({ metadata: { language: 'typescript', file: 'src/a.ts' } }),
        createMockResult({ metadata: { language: 'python', file: 'src/b.py' } }),
        createMockResult({ metadata: { language: 'TypeScript', file: 'src/c.ts' } }),
      ];
      mockVectorDB.search.mockResolvedValue(mockResults);

      const result = await handleFindSimilar(
        { code: 'async function fetchData() { return await db.find(); }', language: 'typescript' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(2);
      expect(
        parsed.results.every((r: any) => r.metadata.language.toLowerCase() === 'typescript'),
      ).toBe(true);
      expect(parsed.filtersApplied.language).toBe('typescript');
    });

    it('should return empty when no results match language', async () => {
      const mockResults = [
        createMockResult({ metadata: { language: 'python' } }),
        createMockResult({ metadata: { language: 'javascript' } }),
      ];
      mockVectorDB.search.mockResolvedValue(mockResults);

      const result = await handleFindSimilar(
        { code: 'async function fetchData() { return await db.find(); }', language: 'rust' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(0);
      expect(parsed.filtersApplied.language).toBe('rust');
    });

    it('should handle missing language metadata gracefully', async () => {
      const mockResults = [
        createMockResult({ metadata: { language: 'typescript' } }),
        // Simulate a record with missing language by using type assertion
        {
          ...createMockResult(),
          metadata: { ...defaultMetadata, language: undefined as unknown as string },
        },
      ];
      mockVectorDB.search.mockResolvedValue(mockResults);

      const result = await handleFindSimilar(
        { code: 'async function fetchData() { return await db.find(); }', language: 'typescript' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(1);
    });
  });

  describe('pathHint filter', () => {
    it('should filter results by path substring (case-insensitive)', async () => {
      const mockResults = [
        createMockResult({ metadata: { file: 'src/api/users.ts' } }),
        createMockResult({ metadata: { file: 'src/utils/helpers.ts' } }),
        createMockResult({ metadata: { file: 'src/API/orders.ts' } }),
      ];
      mockVectorDB.search.mockResolvedValue(mockResults);

      const result = await handleFindSimilar(
        { code: 'async function fetchData() { return await db.find(); }', pathHint: 'api' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(2);
      expect(parsed.filtersApplied.pathHint).toBe('api');
    });

    it('should return empty when no results match path hint', async () => {
      const mockResults = [
        createMockResult({ metadata: { file: 'src/utils/helpers.ts' } }),
        createMockResult({ metadata: { file: 'src/core/main.ts' } }),
      ];
      mockVectorDB.search.mockResolvedValue(mockResults);

      const result = await handleFindSimilar(
        { code: 'async function fetchData() { return await db.find(); }', pathHint: 'api' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(0);
    });

    it('should handle missing file metadata gracefully', async () => {
      const mockResults = [
        createMockResult({ metadata: { file: 'src/api/users.ts' } }),
        // Simulate a record with missing file by using type assertion
        {
          ...createMockResult(),
          metadata: { ...defaultMetadata, file: undefined as unknown as string },
        },
      ];
      mockVectorDB.search.mockResolvedValue(mockResults);

      const result = await handleFindSimilar(
        { code: 'async function fetchData() { return await db.find(); }', pathHint: 'api' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(1);
    });
  });

  describe('low-relevance pruning', () => {
    it('should prune not_relevant results', async () => {
      const mockResults = [
        createMockResult({
          relevance: 'highly_relevant',
          score: 0.5,
          metadata: { file: 'src/a.ts' },
        }),
        createMockResult({ relevance: 'relevant', score: 1.1, metadata: { file: 'src/b.ts' } }),
        createMockResult({ relevance: 'not_relevant', score: 1.6, metadata: { file: 'src/c.ts' } }),
        createMockResult({
          relevance: 'loosely_related',
          score: 1.4,
          metadata: { file: 'src/d.ts' },
        }),
      ];
      mockVectorDB.search.mockResolvedValue(mockResults);

      const result = await handleFindSimilar(
        { code: 'async function fetchData() { return await db.find(); }' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(3);
      expect(parsed.results.every((r: any) => r.relevance !== 'not_relevant')).toBe(true);
      expect(parsed.filtersApplied.prunedLowRelevance).toBe(1);
    });

    it('should handle all results being pruned', async () => {
      const mockResults = [
        createMockResult({ relevance: 'not_relevant', score: 1.8, metadata: { file: 'src/a.ts' } }),
        createMockResult({ relevance: 'not_relevant', score: 2.0, metadata: { file: 'src/b.ts' } }),
      ];
      mockVectorDB.search.mockResolvedValue(mockResults);

      const result = await handleFindSimilar(
        { code: 'async function fetchData() { return await db.find(); }' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(0);
      expect(parsed.filtersApplied.prunedLowRelevance).toBe(2);
    });
  });

  describe('combined filters', () => {
    it('should apply language and pathHint filters together', async () => {
      const mockResults = [
        createMockResult({ metadata: { file: 'src/api/users.ts', language: 'typescript' } }),
        createMockResult({ metadata: { file: 'src/api/orders.py', language: 'python' } }),
        createMockResult({ metadata: { file: 'src/utils/helpers.ts', language: 'typescript' } }),
      ];
      mockVectorDB.search.mockResolvedValue(mockResults);

      const result = await handleFindSimilar(
        {
          code: 'async function fetchData() { return await db.find(); }',
          language: 'typescript',
          pathHint: 'api',
        },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].metadata.file).toBe('src/api/users.ts');
      expect(parsed.filtersApplied.language).toBe('typescript');
      expect(parsed.filtersApplied.pathHint).toBe('api');
    });

    it('should apply all filters and pruning together', async () => {
      const mockResults = [
        createMockResult({
          metadata: { file: 'src/api/users.ts', language: 'typescript' },
          relevance: 'highly_relevant',
        }),
        createMockResult({
          metadata: { file: 'src/api/orders.ts', language: 'typescript' },
          relevance: 'not_relevant',
        }),
      ];
      mockVectorDB.search.mockResolvedValue(mockResults);

      const result = await handleFindSimilar(
        {
          code: 'async function fetchData() { return await db.find(); }',
          language: 'typescript',
          pathHint: 'api',
        },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(1);
      expect(parsed.filtersApplied.prunedLowRelevance).toBe(1);
    });
  });

  describe('limit behavior', () => {
    it('should respect limit after filtering', async () => {
      const mockResults = Array.from({ length: 20 }, (_, i) =>
        createMockResult({
          content: `function example${i}() {}`,
          metadata: { file: `src/file${i}.ts`, language: 'typescript' },
        }),
      );
      mockVectorDB.search.mockResolvedValue(mockResults);

      const result = await handleFindSimilar(
        { code: 'async function fetchData() { return await db.find(); }', limit: 3 },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(3);
    });

    it('should return fewer than limit when filters reduce results', async () => {
      const mockResults = [
        createMockResult({ metadata: { language: 'typescript' } }),
        createMockResult({ metadata: { language: 'python' } }),
      ];
      mockVectorDB.search.mockResolvedValue(mockResults);

      const result = await handleFindSimilar(
        {
          code: 'async function fetchData() { return await db.find(); }',
          language: 'typescript',
          limit: 10,
        },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(1);
    });
  });

  describe('deduplication', () => {
    it('should deduplicate results with same file + line range', async () => {
      const mockResults = [
        createMockResult({
          content: 'first',
          metadata: { file: 'src/a.ts', startLine: 1, endLine: 5 },
        }),
        createMockResult({
          content: 'duplicate',
          metadata: { file: 'src/a.ts', startLine: 1, endLine: 5 },
        }),
        createMockResult({
          content: 'different',
          metadata: { file: 'src/b.ts', startLine: 1, endLine: 5 },
        }),
      ];
      mockVectorDB.search.mockResolvedValue(mockResults);

      const result = await handleFindSimilar({ code: 'async function test() {}' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(2);
    });
  });

  describe('self-match filtering', () => {
    it('should filter out exact self-matches with low score', async () => {
      const inputCode = 'function selfMatch() { return true; }';
      const mockResults = [
        createMockResult({ content: inputCode, score: 0.05, metadata: { file: 'src/self.ts' } }),
        createMockResult({
          content: 'function other() {}',
          score: 0.5,
          metadata: { file: 'src/other.ts' },
        }),
      ];
      mockVectorDB.search.mockResolvedValue(mockResults);

      const result = await handleFindSimilar({ code: inputCode }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].metadata.file).toBe('src/other.ts');
    });

    it('should keep near-matches even with low score', async () => {
      const inputCode = 'function selfMatch() { return true; }';
      const mockResults = [
        createMockResult({
          content: 'function selfMatch() { return false; }',
          score: 0.05,
          metadata: { file: 'src/near.ts' },
        }),
      ];
      mockVectorDB.search.mockResolvedValue(mockResults);

      const result = await handleFindSimilar({ code: inputCode }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(1);
    });

    it('should keep exact match if score >= 0.1', async () => {
      const inputCode = 'function selfMatch() { return true; }';
      const mockResults = [
        createMockResult({ content: inputCode, score: 0.5, metadata: { file: 'src/self.ts' } }),
      ];
      mockVectorDB.search.mockResolvedValue(mockResults);

      const result = await handleFindSimilar({ code: inputCode }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(1);
    });
  });

  describe('empty result diagnostics', () => {
    it('should include diagnostic note when no results are found', async () => {
      mockVectorDB.search.mockResolvedValue([]);

      const result = await handleFindSimilar(
        { code: 'async function fetchData() { return await db.find(); }' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(0);
      expect(parsed.note).toContain('0 results');
      expect(parsed.note).toContain('24 characters');
      expect(parsed.note).toContain('grep');
    });
  });

  describe('filtersApplied metadata', () => {
    it('should not include filtersApplied when no filtering occurred', async () => {
      const mockResults = [createMockResult({ relevance: 'highly_relevant' })];
      mockVectorDB.search.mockResolvedValue(mockResults);

      const result = await handleFindSimilar(
        { code: 'async function fetchData() { return await db.find(); }' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.filtersApplied).toBeUndefined();
    });

    it('should include filtersApplied when pruning occurred', async () => {
      const mockResults = [
        createMockResult({ relevance: 'highly_relevant', metadata: { file: 'src/a.ts' } }),
        createMockResult({ relevance: 'not_relevant', metadata: { file: 'src/b.ts' } }),
      ];
      mockVectorDB.search.mockResolvedValue(mockResults);

      const result = await handleFindSimilar(
        { code: 'async function fetchData() { return await db.find(); }' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.filtersApplied).toBeDefined();
      expect(parsed.filtersApplied.prunedLowRelevance).toBe(1);
    });
  });
});
