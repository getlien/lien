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

      const result = await handleListFunctions(
        { pattern: '.*Command.*' },
        mockCtx
      );

      expect(mockVectorDB.querySymbols).toHaveBeenCalledWith({
        language: undefined,
        pattern: '.*Command.*',
        limit: 50,
      });
      expect(mockVectorDB.scanWithFilter).not.toHaveBeenCalled();

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.method).toBe('symbols');
      expect(parsed.results).toHaveLength(1);
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

      const result = await handleListFunctions(
        { pattern: '.*Command.*' },
        mockCtx
      );

      expect(mockVectorDB.scanWithFilter).toHaveBeenCalled();

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.method).toBe('content');
      expect(parsed.note).toContain('lien reindex');
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

      const result = await handleListFunctions(
        { pattern: '.*Command.*' },
        mockCtx
      );

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

      const result = await handleListFunctions(
        { pattern: '.*Command.*' },
        mockCtx
      );

      const parsed = JSON.parse(result.content![0].text);
      
      // Should only include results where symbolName matches the pattern
      expect(parsed.results).toHaveLength(2);
      expect(parsed.results.map((r: any) => r.metadata.symbolName)).toEqual([
        'initCommand',
        'serveCommand',
      ]);
      // The markdown block with "Command" in content should NOT be included
      expect(parsed.results.some((r: any) => r.metadata.symbolName === 'markdownBlock')).toBe(false);
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

      const result = await handleListFunctions(
        { pattern: '.*Command.*' },
        mockCtx
      );

      const parsed = JSON.parse(result.content![0].text);
      
      // Should only include the one with a valid symbolName that matches
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].metadata.symbolName).toBe('initCommand');
    });

    it('should limit results to 50 items in fallback', async () => {
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

      const result = await handleListFunctions(
        { pattern: '.*Command.*' },
        mockCtx
      );

      const parsed = JSON.parse(result.content![0].text);
      
      // Should be limited to 50
      expect(parsed.results).toHaveLength(50);
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
        mockCtx
      );

      const parsed = JSON.parse(result.content![0].text);
      
      // Should include all results (no pattern filtering)
      expect(parsed.results).toHaveLength(2);
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
});

