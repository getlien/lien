import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGetComplexity } from './get-complexity.js';
import type { ToolContext } from '../types.js';
import type { ComplexityReport } from '@liendev/core';

// Mock ComplexityAnalyzer - must be defined inside mock factory

vi.mock('@liendev/core', async () => {
  const actual = await vi.importActual('@liendev/core');
  const mockAnalyzeFn = vi.fn();
  
  // Store reference for use in tests
  (globalThis as any).__mockAnalyze = mockAnalyzeFn;
  
  // Create a proper class mock
  class MockComplexityAnalyzer {
    constructor(public vectorDB: any, public config: any) {}
    analyze = mockAnalyzeFn;
  }
  
  return {
    ...actual,
    ComplexityAnalyzer: MockComplexityAnalyzer,
    QdrantDB: class MockQdrantDB {},
  };
});

describe('handleGetComplexity', () => {
  const mockVectorDB = {
    scanWithFilter: vi.fn(),
    scanCrossRepo: vi.fn(),
    getCurrentVersion: vi.fn(() => 1234567890),
    getVersionDate: vi.fn(() => '2025-12-19'),
  };

  const mockConfig = {
    complexity: {
      enabled: true,
      thresholds: {
        testPaths: 15,
        mentalLoad: 15,
      },
    },
  };

  const mockLog = vi.fn();
  const mockCheckAndReconnect = vi.fn().mockResolvedValue(undefined);
  const mockGetIndexMetadata = vi.fn(() => ({
    indexVersion: 1234567890,
    indexDate: '2025-12-19',
  }));

  const mockEmbeddings = {
    embed: vi.fn(),
  };

  const mockCtx: ToolContext = {
    vectorDB: mockVectorDB as any,
    config: mockConfig as any,
    embeddings: mockEmbeddings as any,
    log: mockLog,
    checkAndReconnect: mockCheckAndReconnect,
    getIndexMetadata: mockGetIndexMetadata,
    rootDir: '/fake/workspace',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    const mockAnalyzeFn = (globalThis as any).__mockAnalyze;
    if (mockAnalyzeFn) {
      mockAnalyzeFn.mockClear();
    }
  });
  
  const getMockAnalyze = () => (globalThis as any).__mockAnalyze;

  describe('threshold filtering', () => {
    it('should filter violations by threshold when provided', async () => {
      const mockReport: ComplexityReport = {
        summary: {
          filesAnalyzed: 2,
          avgComplexity: 20,
          maxComplexity: 30,
          totalViolations: 3,
          bySeverity: {
            error: 1,
            warning: 2,
          },
        },
        files: {
          'src/file1.ts': {
            violations: [
              {
                filepath: 'src/file1.ts',
                symbolName: 'func1',
                symbolType: 'function',
                startLine: 1,
                endLine: 10,
                complexity: 25,
                metricType: 'cyclomatic',
                threshold: 15,
                severity: 'error',
                language: 'typescript',
                message: 'Complexity 25 exceeds threshold 15',
              },
              {
                filepath: 'src/file1.ts',
                symbolName: 'func2',
                symbolType: 'function',
                startLine: 11,
                endLine: 20,
                complexity: 20,
                metricType: 'cyclomatic',
                threshold: 15,
                severity: 'warning',
                language: 'typescript',
                message: 'Complexity 20 exceeds threshold 15',
              },
            ],
            dependents: [],
            testAssociations: [],
            dependentCount: 0,
            riskLevel: 'low',
          },
          'src/file2.ts': {
            violations: [
              {
                filepath: 'src/file2.ts',
                symbolName: 'func3',
                symbolType: 'function',
                startLine: 1,
                endLine: 5,
                complexity: 18,
                metricType: 'cyclomatic',
                threshold: 15,
                severity: 'warning',
                language: 'typescript',
                message: 'Complexity 18 exceeds threshold 15',
              },
            ],
            dependents: [],
            testAssociations: [],
            dependentCount: 0,
            riskLevel: 'low',
          },
        },
      };

      getMockAnalyze().mockResolvedValue(mockReport);

      const result = await handleGetComplexity(
        { threshold: 20, top: 10 },
        mockCtx
      );

      // wrapToolHandler returns { content: [{ type: 'text', text: JSON.stringify(...) }] }
      expect(result).toHaveProperty('content');
      const parsed = JSON.parse(result.content![0].text);
      
      expect(parsed).toHaveProperty('violations');
      // Should only include violations with complexity >= 20
      expect(parsed.violations).toHaveLength(2);
      expect(parsed.violations.every((v: any) => v.complexity >= 20)).toBe(true);
      expect(parsed.summary.violationCount).toBe(2);
    });

    it('should include all violations when threshold is not provided', async () => {
      const mockReport: ComplexityReport = {
        summary: {
          filesAnalyzed: 1,
          avgComplexity: 20,
          maxComplexity: 25,
          totalViolations: 2,
          bySeverity: {
            error: 1,
            warning: 1,
          },
        },
        files: {
          'src/file1.ts': {
            violations: [
              {
                filepath: 'src/file1.ts',
                symbolName: 'func1',
                symbolType: 'function',
                startLine: 1,
                endLine: 10,
                complexity: 25,
                metricType: 'cyclomatic',
                threshold: 15,
                severity: 'error',
                language: 'typescript',
                message: 'Complexity 25 exceeds threshold 15',
              },
              {
                filepath: 'src/file1.ts',
                symbolName: 'func2',
                symbolType: 'function',
                startLine: 11,
                endLine: 20,
                complexity: 18,
                metricType: 'cyclomatic',
                threshold: 15,
                severity: 'warning',
                language: 'typescript',
                message: 'Complexity 18 exceeds threshold 15',
              },
            ],
            dependents: [],
            testAssociations: [],
            dependentCount: 0,
            riskLevel: 'low',
          },
        },
      };

      getMockAnalyze().mockResolvedValue(mockReport);

      const result = await handleGetComplexity(
        { top: 10 },
        mockCtx
      );

      const parsed = JSON.parse(result.content![0].text);
      
      expect(parsed).toHaveProperty('violations');
      // Should include all violations when threshold is not provided
      expect(parsed.violations).toHaveLength(2);
      expect(parsed.summary.violationCount).toBe(2);
    });

    it('should filter violations correctly when threshold is minimum (1)', async () => {
      const mockReport: ComplexityReport = {
        summary: {
          filesAnalyzed: 1,
          avgComplexity: 20,
          maxComplexity: 25,
          totalViolations: 2,
          bySeverity: {
            error: 1,
            warning: 1,
          },
        },
        files: {
          'src/file1.ts': {
            violations: [
              {
                filepath: 'src/file1.ts',
                symbolName: 'func1',
                symbolType: 'function',
                startLine: 1,
                endLine: 10,
                complexity: 25,
                metricType: 'cyclomatic',
                threshold: 15,
                severity: 'error',
                language: 'typescript',
                message: 'Complexity 25 exceeds threshold 15',
              },
              {
                filepath: 'src/file1.ts',
                symbolName: 'func2',
                symbolType: 'function',
                startLine: 11,
                endLine: 20,
                complexity: 18,
                metricType: 'cyclomatic',
                threshold: 15,
                severity: 'warning',
                language: 'typescript',
                message: 'Complexity 18 exceeds threshold 15',
              },
            ],
            dependents: [],
            testAssociations: [],
            dependentCount: 0,
            riskLevel: 'low',
          },
        },
      };

      getMockAnalyze().mockResolvedValue(mockReport);

      const result = await handleGetComplexity(
        { threshold: 1, top: 10 },
        mockCtx
      );

      // Check if result is an error first
      if (result.isError) {
        const error = JSON.parse(result.content![0].text);
        throw new Error(`Handler returned an error: ${JSON.stringify(error)}`);
      }

      const parsed = JSON.parse(result.content![0].text);
      
      expect(parsed).toHaveProperty('violations');
      // Threshold of 1 should include all violations (complexity >= 1)
      expect(parsed.violations).toHaveLength(2);
      expect(parsed.summary.violationCount).toBe(2);
    });
  });

  describe('top parameter', () => {
    it('should limit results to top N violations', async () => {
      const violations = Array.from({ length: 20 }, (_, i) => ({
        filepath: `src/file${i}.ts`,
        symbolName: `func${i}`,
        symbolType: 'function' as const,
        startLine: 1,
        endLine: 10,
        complexity: 30 - i, // Decreasing complexity
        metricType: 'cyclomatic' as const,
        threshold: 15,
        severity: 'error' as const,
        language: 'typescript',
        message: `Complexity ${30 - i} exceeds threshold 15`,
      }));

      const mockReport: ComplexityReport = {
        summary: {
          filesAnalyzed: 20,
          avgComplexity: 20,
          maxComplexity: 30,
          totalViolations: 20,
          bySeverity: {
            error: 20,
            warning: 0,
          },
        },
        files: Object.fromEntries(
          violations.map((v) => [
            v.filepath,
            {
              violations: [v],
              dependents: [],
              testAssociations: [],
              dependentCount: 0,
              riskLevel: 'low' as const,
            },
          ])
        ),
      };

      getMockAnalyze().mockResolvedValue(mockReport);

      const result = await handleGetComplexity(
        { top: 5 },
        mockCtx
      );

      const parsed = JSON.parse(result.content![0].text);
      
      expect(parsed.violations).toHaveLength(5);
      // Should be sorted by complexity descending
      expect(parsed.violations[0].complexity).toBe(30);
      expect(parsed.violations[4].complexity).toBe(26);
    });
  });

  describe('severity counts', () => {
    it('should calculate severity counts correctly', async () => {
      const mockReport: ComplexityReport = {
        summary: {
          filesAnalyzed: 1,
          avgComplexity: 20,
          maxComplexity: 25,
          totalViolations: 3,
          bySeverity: {
            error: 1,
            warning: 2,
          },
        },
        files: {
          'src/file1.ts': {
            violations: [
              {
                filepath: 'src/file1.ts',
                symbolName: 'func1',
                symbolType: 'function',
                startLine: 1,
                endLine: 10,
                complexity: 25,
                metricType: 'cyclomatic',
                threshold: 15,
                severity: 'error',
                language: 'typescript',
                message: 'Complexity 25 exceeds threshold 15',
              },
              {
                filepath: 'src/file1.ts',
                symbolName: 'func2',
                symbolType: 'function',
                startLine: 11,
                endLine: 20,
                complexity: 18,
                metricType: 'cyclomatic',
                threshold: 15,
                severity: 'warning',
                language: 'typescript',
                message: 'Complexity 18 exceeds threshold 15',
              },
              {
                filepath: 'src/file1.ts',
                symbolName: 'func3',
                symbolType: 'function',
                startLine: 21,
                endLine: 30,
                complexity: 16,
                metricType: 'cyclomatic',
                threshold: 15,
                severity: 'warning',
                language: 'typescript',
                message: 'Complexity 16 exceeds threshold 15',
              },
            ],
            dependents: [],
            testAssociations: [],
            dependentCount: 0,
            riskLevel: 'low',
          },
        },
      };

      getMockAnalyze().mockResolvedValue(mockReport);

      const result = await handleGetComplexity(
        { top: 10 },
        mockCtx
      );

      const parsed = JSON.parse(result.content![0].text);
      
      expect(parsed.summary.bySeverity.error).toBe(1);
      expect(parsed.summary.bySeverity.warning).toBe(2);
    });
  });

  describe('index metadata', () => {
    it('should include index metadata in response', async () => {
      const mockReport: ComplexityReport = {
        summary: {
          filesAnalyzed: 0,
          avgComplexity: 0,
          maxComplexity: 0,
          totalViolations: 0,
          bySeverity: {
            error: 0,
            warning: 0,
          },
        },
        files: {},
      };

      getMockAnalyze().mockResolvedValue(mockReport);

      const result = await handleGetComplexity(
        { top: 10 },
        mockCtx
      );

      // Check if result is an error first
      if (result.isError) {
        console.log('Error response:', JSON.parse(result.content![0].text));
        throw new Error('Handler returned an error');
      }

      const parsed = JSON.parse(result.content![0].text);
      
      expect(parsed).toHaveProperty('indexInfo');
      expect(parsed.indexInfo).toEqual({
        indexVersion: 1234567890,
        indexDate: '2025-12-19',
      });
    });
  });
});

