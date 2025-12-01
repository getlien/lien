import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComplexityAnalyzer } from './complexity-analyzer.js';
import { VectorDB } from '../vectordb/lancedb.js';
import { LienConfig } from '../config/schema.js';
import { ChunkMetadata } from '../indexer/types.js';

describe('ComplexityAnalyzer', () => {
  let mockVectorDB: VectorDB;
  let config: LienConfig;

  beforeEach(() => {
    // Create mock VectorDB
    mockVectorDB = {
      scanWithFilter: vi.fn(),
    } as any;

    // Default config
    config = {
      version: '1.0',
      complexity: {
        enabled: true,
        thresholds: {
          method: 10,
          file: 50,
          average: 6,
        },
        severity: {
          warning: 1.0,
          error: 2.0,
        },
      },
    } as any;
  });

  describe('analyze', () => {
    it('should find violations above threshold', async () => {
      const chunks = [
        {
          content: 'function complex() { }',
          metadata: {
            file: 'src/test.ts',
            startLine: 1,
            endLine: 10,
            type: 'function',
            language: 'typescript',
            symbolName: 'complex',
            symbolType: 'function',
            complexity: 15, // Above threshold of 10
          } as ChunkMetadata,
          score: 1.0,
          relevance: 'highly_relevant' as const,
        },
        {
          content: 'function simple() { }',
          metadata: {
            file: 'src/test.ts',
            startLine: 12,
            endLine: 15,
            type: 'function',
            language: 'typescript',
            symbolName: 'simple',
            symbolType: 'function',
            complexity: 5, // Below threshold
          } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
        },
      ];

      vi.mocked(mockVectorDB.scanWithFilter).mockResolvedValue(chunks);

      const analyzer = new ComplexityAnalyzer(mockVectorDB, config);
      const report = await analyzer.analyze();

      expect(report.summary.totalViolations).toBe(1);
      expect(report.summary.filesAnalyzed).toBe(1);
      expect(report.files['src/test.ts'].violations).toHaveLength(1);
      expect(report.files['src/test.ts'].violations[0].symbolName).toBe('complex');
      expect(report.files['src/test.ts'].violations[0].complexity).toBe(15);
    });

    it('should calculate correct severity based on multiplier', async () => {
      const chunks = [
        {
          content: 'function warning() { }',
          metadata: {
            file: 'src/test.ts',
            startLine: 1,
            endLine: 10,
            type: 'function',
            language: 'typescript',
            symbolName: 'warning',
            symbolType: 'function',
            complexity: 15, // 1.5x threshold = warning
          } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
        },
        {
          content: 'function error() { }',
          metadata: {
            file: 'src/test.ts',
            startLine: 12,
            endLine: 20,
            type: 'function',
            language: 'typescript',
            symbolName: 'error',
            symbolType: 'function',
            complexity: 25, // 2.5x threshold = error
          } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
        },
      ];

      vi.mocked(mockVectorDB.scanWithFilter).mockResolvedValue(chunks);

      const analyzer = new ComplexityAnalyzer(mockVectorDB, config);
      const report = await analyzer.analyze();

      expect(report.summary.bySeverity.warning).toBe(1);
      expect(report.summary.bySeverity.error).toBe(1);
    });

    it('should filter by specific files when provided', async () => {
      const chunks = [
        {
          content: 'function test1() { }',
          metadata: {
            file: 'src/file1.ts',
            startLine: 1,
            endLine: 10,
            type: 'function',
            language: 'typescript',
            symbolName: 'test1',
            symbolType: 'function',
            complexity: 15,
          } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
        },
        {
          content: 'function test2() { }',
          metadata: {
            file: 'src/file2.ts',
            startLine: 1,
            endLine: 10,
            type: 'function',
            language: 'typescript',
            symbolName: 'test2',
            symbolType: 'function',
            complexity: 20,
          } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
        },
      ];

      vi.mocked(mockVectorDB.scanWithFilter).mockResolvedValue(chunks);

      const analyzer = new ComplexityAnalyzer(mockVectorDB, config);
      const report = await analyzer.analyze(['src/file1.ts']);

      expect(report.summary.filesAnalyzed).toBe(1);
      expect(report.files['src/file1.ts']).toBeDefined();
      expect(report.files['src/file2.ts']).toBeUndefined();
    });

    it('should handle empty results', async () => {
      vi.mocked(mockVectorDB.scanWithFilter).mockResolvedValue([]);

      const analyzer = new ComplexityAnalyzer(mockVectorDB, config);
      const report = await analyzer.analyze();

      expect(report.summary.totalViolations).toBe(0);
      expect(report.summary.filesAnalyzed).toBe(0);
      expect(report.summary.avgComplexity).toBe(0);
      expect(report.summary.maxComplexity).toBe(0);
    });

    it('should calculate correct summary statistics', async () => {
      const chunks = [
        {
          content: 'function a() { }',
          metadata: {
            file: 'src/test.ts',
            startLine: 1,
            endLine: 5,
            type: 'function',
            language: 'typescript',
            symbolName: 'a',
            symbolType: 'function',
            complexity: 5,
          } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
        },
        {
          content: 'function b() { }',
          metadata: {
            file: 'src/test.ts',
            startLine: 6,
            endLine: 10,
            type: 'function',
            language: 'typescript',
            symbolName: 'b',
            symbolType: 'function',
            complexity: 15,
          } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
        },
        {
          content: 'function c() { }',
          metadata: {
            file: 'src/test.ts',
            startLine: 11,
            endLine: 15,
            type: 'function',
            language: 'typescript',
            symbolName: 'c',
            symbolType: 'function',
            complexity: 10,
          } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
        },
      ];

      vi.mocked(mockVectorDB.scanWithFilter).mockResolvedValue(chunks);

      const analyzer = new ComplexityAnalyzer(mockVectorDB, config);
      const report = await analyzer.analyze();

      expect(report.summary.avgComplexity).toBe(10); // (5 + 15 + 10) / 3 = 10
      expect(report.summary.maxComplexity).toBe(15);
    });

    it('should skip chunks without complexity data', async () => {
      const chunks = [
        {
          content: 'function test() { }',
          metadata: {
            file: 'src/test.ts',
            startLine: 1,
            endLine: 5,
            type: 'function',
            language: 'typescript',
            symbolName: 'test',
            symbolType: 'function',
            // No complexity field
          } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
        },
      ];

      vi.mocked(mockVectorDB.scanWithFilter).mockResolvedValue(chunks);

      const analyzer = new ComplexityAnalyzer(mockVectorDB, config);
      const report = await analyzer.analyze();

      expect(report.summary.totalViolations).toBe(0);
    });

    it('should calculate risk levels correctly', async () => {
      const chunks = [
        // File with no violations
        {
          content: 'function low() { }',
          metadata: {
            file: 'src/low.ts',
            startLine: 1,
            endLine: 5,
            type: 'function',
            language: 'typescript',
            symbolName: 'low',
            symbolType: 'function',
            complexity: 5,
          } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
        },
        // File with 1 warning
        {
          content: 'function medium() { }',
          metadata: {
            file: 'src/medium.ts',
            startLine: 1,
            endLine: 5,
            type: 'function',
            language: 'typescript',
            symbolName: 'medium',
            symbolType: 'function',
            complexity: 12,
          } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
        },
        // File with 1 error
        {
          content: 'function high() { }',
          metadata: {
            file: 'src/high.ts',
            startLine: 1,
            endLine: 5,
            type: 'function',
            language: 'typescript',
            symbolName: 'high',
            symbolType: 'function',
            complexity: 25,
          } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
        },
      ];

      vi.mocked(mockVectorDB.scanWithFilter).mockResolvedValue(chunks);

      const analyzer = new ComplexityAnalyzer(mockVectorDB, config);
      const report = await analyzer.analyze();

      expect(report.files['src/low.ts'].riskLevel).toBe('low');
      expect(report.files['src/medium.ts'].riskLevel).toBe('low'); // Only 1 warning
      expect(report.files['src/high.ts'].riskLevel).toBe('high'); // Has error
    });
  });
});

