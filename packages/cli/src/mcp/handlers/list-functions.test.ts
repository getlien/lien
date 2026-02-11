import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleListFunctions } from './list-functions.js';
import type { ToolContext } from '../types.js';
import type { SearchResult } from '@liendev/core';

describe('handleListFunctions', () => {
  const mockLog = vi.fn();
  const mockCheckAndReconnect = vi.fn().mockResolvedValue(undefined);
  const mockGetIndexMetadata = vi.fn(() => ({
    indexVersion: 1234567890,
    indexDate: '2025-12-19',
  }));

  const mockEmbeddings = {
    embed: vi.fn(),
  };

  let mockVectorDB: {
    querySymbols: ReturnType<typeof vi.fn>;
    scanWithFilter: ReturnType<typeof vi.fn>;
  };

  let mockCtx: ToolContext;

  beforeEach(() => {
    vi.clearAllMocks();

    mockVectorDB = {
      querySymbols: vi.fn(),
      scanWithFilter: vi.fn(),
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

  describe('symbol-based query (primary path)', () => {
    it('should use querySymbols when available', async () => {
      const mockResults: SearchResult[] = [
        {
          content: 'function testCommand() {}',
          metadata: {
            file: 'src/cli.ts',
            startLine: 1,
            endLine: 5,
            type: 'function',
            language: 'typescript',
            symbolName: 'testCommand',
            symbolType: 'function',
          },
          score: 1,
          relevance: 'highly_relevant',
        },
      ];

      mockVectorDB.querySymbols.mockResolvedValue(mockResults);

      const result = await handleListFunctions({ pattern: '.*Command.*' }, mockCtx);

      expect(mockVectorDB.querySymbols).toHaveBeenCalledWith({
        language: undefined,
        pattern: '.*Command.*',
        symbolType: undefined,
        limit: 51, // 50 + 0 + 1 (over-fetch by 1 for hasMore detection)
      });
      expect(mockVectorDB.scanWithFilter).not.toHaveBeenCalled();

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.method).toBe('symbols');
      expect(parsed.results).toHaveLength(1);
    });
  });

  describe('symbolType filter', () => {
    it('should pass symbolType to querySymbols', async () => {
      mockVectorDB.querySymbols.mockResolvedValue([
        {
          content: 'class UserService {}',
          metadata: {
            file: 'src/user.ts',
            startLine: 1,
            endLine: 10,
            type: 'class',
            language: 'typescript',
            symbolName: 'UserService',
            symbolType: 'class',
          },
          score: 0,
          relevance: 'highly_relevant',
        },
      ]);

      const result = await handleListFunctions({ symbolType: 'class' }, mockCtx);

      expect(mockVectorDB.querySymbols).toHaveBeenCalledWith({
        language: undefined,
        pattern: undefined,
        symbolType: 'class',
        limit: 51,
      });

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.method).toBe('symbols');
      expect(parsed.results).toHaveLength(1);
    });

    it('should pass symbolType to scanWithFilter in content scan fallback', async () => {
      mockVectorDB.querySymbols.mockResolvedValue([]);
      mockVectorDB.scanWithFilter.mockResolvedValue([
        {
          content: 'getName() { return this.name; }',
          metadata: {
            file: 'src/user.ts',
            symbolName: 'getName',
            symbolType: 'method',
          },
          score: 0,
          relevance: 'highly_relevant',
        },
      ]);

      const result = await handleListFunctions({ symbolType: 'method' }, mockCtx);

      expect(mockVectorDB.scanWithFilter).toHaveBeenCalledWith({
        language: undefined,
        symbolType: 'method',
        limit: 51,
      });

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].metadata.symbolName).toBe('getName');
      expect(parsed.results[0].metadata.symbolType).toBe('method');
    });

    it('should pass symbolType function to scanWithFilter in content scan fallback', async () => {
      mockVectorDB.querySymbols.mockResolvedValue([]);
      // scanWithFilter now handles symbolType filtering at DB level
      mockVectorDB.scanWithFilter.mockResolvedValue([
        {
          content: 'function standalone() {}',
          metadata: {
            file: 'src/utils.ts',
            symbolName: 'standalone',
            symbolType: 'function',
          },
          score: 0,
          relevance: 'highly_relevant',
        },
        {
          content: 'getName() { return this.name; }',
          metadata: {
            file: 'src/user.ts',
            symbolName: 'getName',
            symbolType: 'method',
          },
          score: 0,
          relevance: 'highly_relevant',
        },
      ]);

      const result = await handleListFunctions({ symbolType: 'function' }, mockCtx);

      expect(mockVectorDB.scanWithFilter).toHaveBeenCalledWith({
        language: undefined,
        symbolType: 'function',
        limit: 51,
      });

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(2);
      expect(parsed.results.map((r: any) => r.metadata.symbolType)).toEqual(['function', 'method']);
    });

    it('should return all types when symbolType is omitted', async () => {
      mockVectorDB.querySymbols.mockResolvedValue([
        {
          content: 'function helper() {}',
          metadata: {
            file: 'src/utils.ts',
            startLine: 1,
            endLine: 3,
            type: 'function',
            language: 'typescript',
            symbolName: 'helper',
            symbolType: 'function',
          },
          score: 0,
          relevance: 'highly_relevant',
        },
        {
          content: 'class MyClass {}',
          metadata: {
            file: 'src/class.ts',
            startLine: 1,
            endLine: 5,
            type: 'class',
            language: 'typescript',
            symbolName: 'MyClass',
            symbolType: 'class',
          },
          score: 0,
          relevance: 'highly_relevant',
        },
      ]);

      const result = await handleListFunctions({}, mockCtx);

      expect(mockVectorDB.querySymbols).toHaveBeenCalledWith({
        language: undefined,
        pattern: undefined,
        symbolType: undefined,
        limit: 51,
      });

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(2);
    });
  });

  describe('content scan fallback', () => {
    it('should fall back to content scan when querySymbols returns empty', async () => {
      mockVectorDB.querySymbols.mockResolvedValue([]);
      mockVectorDB.scanWithFilter.mockResolvedValue([
        {
          content: 'function testCommand() {}',
          metadata: {
            file: 'src/cli.ts',
            startLine: 1,
            endLine: 5,
            type: 'function',
            language: 'typescript',
            symbolName: 'testCommand',
            symbolType: 'function',
          },
          score: 0,
          relevance: 'highly_relevant',
        },
      ]);

      const result = await handleListFunctions({ pattern: '.*Command.*' }, mockCtx);

      expect(mockVectorDB.scanWithFilter).toHaveBeenCalled();

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.method).toBe('content');
      expect(parsed.note).toContain('lien reindex');
    });

    it('should pass symbolType to scanWithFilter and return DB-filtered results', async () => {
      mockVectorDB.querySymbols.mockResolvedValue([]);
      // scanWithFilter now filters by symbolType at DB level, so only matching results returned
      mockVectorDB.scanWithFilter.mockResolvedValue([
        {
          content: 'class UserService {}',
          metadata: {
            file: 'src/user.ts',
            symbolName: 'UserService',
            symbolType: 'class',
          },
          score: 0,
          relevance: 'highly_relevant',
        },
      ]);

      const result = await handleListFunctions({ symbolType: 'class' }, mockCtx);

      expect(mockVectorDB.scanWithFilter).toHaveBeenCalledWith({
        language: undefined,
        symbolType: 'class',
        limit: 51,
      });

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.method).toBe('content');
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].metadata.symbolType).toBe('class');
    });

    it('should fall back to content scan when querySymbols throws', async () => {
      mockVectorDB.querySymbols.mockRejectedValue(new Error('Symbol query failed'));
      mockVectorDB.scanWithFilter.mockResolvedValue([
        {
          content: 'function testCommand() {}',
          metadata: {
            file: 'src/cli.ts',
            symbolName: 'testCommand',
          },
          score: 0,
          relevance: 'highly_relevant',
        },
      ]);

      const result = await handleListFunctions({ pattern: '.*Command.*' }, mockCtx);

      expect(mockVectorDB.scanWithFilter).toHaveBeenCalled();

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.method).toBe('content');
    });

    it('should filter by symbolName NOT content in fallback', async () => {
      mockVectorDB.querySymbols.mockResolvedValue([]);
      mockVectorDB.scanWithFilter.mockResolvedValue([
        // This should be INCLUDED - symbolName matches pattern
        {
          content: 'function helper() { /* some code */ }',
          metadata: {
            file: 'src/commands.ts',
            symbolName: 'initCommand',
            symbolType: 'function',
          },
          score: 0,
          relevance: 'highly_relevant',
        },
        // This should be EXCLUDED - symbolName doesn't match, even though content has "Command"
        {
          content: '// This is a Command handler comment',
          metadata: {
            file: 'src/docs.md',
            symbolName: 'markdownBlock',
            symbolType: 'block',
          },
          score: 0,
          relevance: 'highly_relevant',
        },
        // This should be INCLUDED - symbolName matches
        {
          content: 'export async function serveCommand() {}',
          metadata: {
            file: 'src/serve.ts',
            symbolName: 'serveCommand',
            symbolType: 'function',
          },
          score: 0,
          relevance: 'highly_relevant',
        },
      ]);

      const result = await handleListFunctions({ pattern: '.*Command.*' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);

      // Should only include results where symbolName matches the pattern
      expect(parsed.results).toHaveLength(2);
      expect(parsed.results.map((r: any) => r.metadata.symbolName)).toEqual([
        'initCommand',
        'serveCommand',
      ]);
      // The markdown block with "Command" in content should NOT be included
      expect(parsed.results.some((r: any) => r.metadata.symbolName === 'markdownBlock')).toBe(
        false,
      );
    });

    it('should handle records with missing symbolName in fallback', async () => {
      mockVectorDB.querySymbols.mockResolvedValue([]);
      mockVectorDB.scanWithFilter.mockResolvedValue([
        // Has symbolName - should be checked against pattern
        {
          content: 'function initCommand() {}',
          metadata: {
            file: 'src/init.ts',
            symbolName: 'initCommand',
            symbolType: 'function',
          },
          score: 0,
          relevance: 'highly_relevant',
        },
        // Missing symbolName - should be EXCLUDED
        {
          content: 'some random content with Command in it',
          metadata: {
            file: 'src/random.ts',
            // no symbolName
          },
          score: 0,
          relevance: 'highly_relevant',
        },
        // Empty symbolName - should be EXCLUDED
        {
          content: 'another block',
          metadata: {
            file: 'src/other.ts',
            symbolName: '',
          },
          score: 0,
          relevance: 'highly_relevant',
        },
      ]);

      const result = await handleListFunctions({ pattern: '.*Command.*' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);

      // Should only include the one with a valid symbolName that matches
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].metadata.symbolName).toBe('initCommand');
    });

    it('should limit results to default 50 items in fallback', async () => {
      mockVectorDB.querySymbols.mockResolvedValue([]);

      // Create 100 results
      const manyResults = Array.from({ length: 100 }, (_, i) => ({
        content: `function func${i}Command() {}`,
        metadata: {
          file: `src/file${i}.ts`,
          symbolName: `func${i}Command`,
          symbolType: 'function',
        },
        score: 0,
        relevance: 'highly_relevant' as const,
      }));

      mockVectorDB.scanWithFilter.mockResolvedValue(manyResults);

      const result = await handleListFunctions({ pattern: '.*Command.*' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);

      // Should be limited to 50 (default limit)
      expect(parsed.results).toHaveLength(50);

      expect(parsed.hasMore).toBe(true);
      expect(parsed.nextOffset).toBe(50);
    });
  });

  describe('invalid and ReDoS regex patterns', () => {
    it('should return unfiltered results for invalid regex pattern', async () => {
      mockVectorDB.querySymbols.mockResolvedValue([]);
      mockVectorDB.scanWithFilter.mockResolvedValue([
        {
          content: 'function helper() {}',
          metadata: {
            file: 'src/utils.ts',
            symbolName: 'helper',
            symbolType: 'function',
          },
          score: 0,
          relevance: 'highly_relevant',
        },
      ]);

      const result = await handleListFunctions({ pattern: '[unterminated' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      // Invalid regex should be skipped, returning all results unfiltered
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].metadata.symbolName).toBe('helper');
    });

    it('should return unfiltered results for ReDoS pattern', async () => {
      mockVectorDB.querySymbols.mockResolvedValue([]);
      mockVectorDB.scanWithFilter.mockResolvedValue([
        {
          content: 'function alpha() {}',
          metadata: {
            file: 'src/alpha.ts',
            symbolName: 'alpha',
            symbolType: 'function',
          },
          score: 0,
          relevance: 'highly_relevant',
        },
        {
          content: 'function beta() {}',
          metadata: {
            file: 'src/beta.ts',
            symbolName: 'beta',
            symbolType: 'function',
          },
          score: 0,
          relevance: 'highly_relevant',
        },
      ]);

      const result = await handleListFunctions({ pattern: '(a+)+$' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      // ReDoS pattern should be rejected, returning all results unfiltered
      expect(parsed.results).toHaveLength(2);
    });
  });

  describe('empty result diagnostics', () => {
    it('should include diagnostic note when no results are found', async () => {
      mockVectorDB.querySymbols.mockResolvedValue([]);
      mockVectorDB.scanWithFilter.mockResolvedValue([]);

      const result = await handleListFunctions({ pattern: 'nonExistentPattern' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(0);
      expect(parsed.note).toContain('0 results');
      expect(parsed.note).toContain('semantic_search');
      expect(parsed.note).toContain('symbolType');
    });
  });

  describe('no pattern provided', () => {
    it('should not filter by symbolName when no pattern is provided', async () => {
      mockVectorDB.querySymbols.mockResolvedValue([]);
      mockVectorDB.scanWithFilter.mockResolvedValue([
        {
          content: 'function helper() {}',
          metadata: {
            file: 'src/utils.ts',
            symbolName: 'helper',
            symbolType: 'function',
          },
          score: 0,
          relevance: 'highly_relevant',
        },
        {
          content: 'class MyClass {}',
          metadata: {
            file: 'src/class.ts',
            symbolName: 'MyClass',
            symbolType: 'class',
          },
          score: 0,
          relevance: 'highly_relevant',
        },
      ]);

      const result = await handleListFunctions(
        { language: 'typescript' }, // Only language, no pattern
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);

      // Should include all results (no pattern filtering)
      expect(parsed.results).toHaveLength(2);
    });
  });

  describe('deduplication', () => {
    it('should deduplicate results with same file + line range', async () => {
      const duplicate: SearchResult = {
        content: 'function testCommand() {}',
        metadata: {
          file: 'src/cli.ts',
          startLine: 1,
          endLine: 5,
          type: 'function',
          language: 'typescript',
          symbolName: 'testCommand',
          symbolType: 'function',
        },
        score: 1,
        relevance: 'highly_relevant',
      };

      mockVectorDB.querySymbols.mockResolvedValue([duplicate, { ...duplicate }]);

      const result = await handleListFunctions({ pattern: '.*Command.*' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(1);
    });
  });

  describe('index metadata', () => {
    it('should include index metadata in response', async () => {
      mockVectorDB.querySymbols.mockResolvedValue([]);
      mockVectorDB.scanWithFilter.mockResolvedValue([]);

      const result = await handleListFunctions({}, mockCtx);

      const parsed = JSON.parse(result.content![0].text);

      expect(parsed).toHaveProperty('indexInfo');
      expect(parsed.indexInfo).toEqual({
        indexVersion: 1234567890,
        indexDate: '2025-12-19',
      });
    });
  });

  describe('pagination', () => {
    function makeResults(count: number): SearchResult[] {
      return Array.from({ length: count }, (_, i) => ({
        content: `f${i}(){}`,
        metadata: {
          file: `s/${i}.ts`,
          startLine: 1,
          endLine: 5,
          type: 'function' as const,
          language: 'typescript',
          symbolName: `f${i}`,
          symbolType: 'function',
        },
        score: 1,
        relevance: 'highly_relevant' as const,
      }));
    }

    it('should apply default limit of 50', async () => {
      mockVectorDB.querySymbols.mockResolvedValue(makeResults(80));

      const result = await handleListFunctions({}, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(50);

      expect(parsed.hasMore).toBe(true);
      expect(parsed.nextOffset).toBe(50);
    });

    it('should respect custom limit', async () => {
      mockVectorDB.querySymbols.mockResolvedValue(makeResults(30));

      const result = await handleListFunctions({ limit: 10 }, mockCtx);

      // fetchLimit = 10 + 0 + 1 = 11
      expect(mockVectorDB.querySymbols).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 11 }),
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(10);

      expect(parsed.hasMore).toBe(true);
      expect(parsed.nextOffset).toBe(10);
    });

    it('should skip results with offset', async () => {
      mockVectorDB.querySymbols.mockResolvedValue(makeResults(20));

      const result = await handleListFunctions({ limit: 5, offset: 10 }, mockCtx);

      // fetchLimit = 5 + 10 + 1 = 16
      expect(mockVectorDB.querySymbols).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 16 }),
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(5);
      // Results should start from offset 10 (f10..f14)
      expect(parsed.results[0].metadata.symbolName).toBe('f10');
      expect(parsed.results[4].metadata.symbolName).toBe('f14');

      expect(parsed.hasMore).toBe(true);
      expect(parsed.nextOffset).toBe(15);
    });

    it('should return hasMore=false when all results fit', async () => {
      mockVectorDB.querySymbols.mockResolvedValue(makeResults(5));

      const result = await handleListFunctions({ limit: 10 }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(5);

      expect(parsed.hasMore).toBe(false);
      expect(parsed.nextOffset).toBeUndefined();
    });

    it('should return empty results when offset is beyond result count', async () => {
      mockVectorDB.querySymbols.mockResolvedValue(makeResults(5));

      const result = await handleListFunctions({ limit: 10, offset: 100 }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(0);

      expect(parsed.hasMore).toBe(false);
    });

    it('should include pagination metadata in content scan fallback', async () => {
      mockVectorDB.querySymbols.mockRejectedValue(new Error('fail'));
      mockVectorDB.scanWithFilter.mockResolvedValue(makeResults(30));

      const result = await handleListFunctions({ limit: 10, offset: 5 }, mockCtx);

      // fetchLimit = 10 + 5 + 1 = 16
      expect(mockVectorDB.scanWithFilter).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 16 }),
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(10);

      expect(parsed.hasMore).toBe(true);
      expect(parsed.nextOffset).toBe(15);
    });
  });
});
