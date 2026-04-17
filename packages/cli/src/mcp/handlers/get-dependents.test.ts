import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGetDependents } from './get-dependents.js';
import type { ToolContext } from '../types.js';
import type { SearchResult } from '@liendev/core';

// Mock the dependency-analyzer module
vi.mock('./dependency-analyzer.js', async importOriginal => {
  const original = await importOriginal();
  return {
    ...(original as Record<string, unknown>),
    findDependents: vi.fn(),
  };
});

import { findDependents } from './dependency-analyzer.js';

describe('handleGetDependents', () => {
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
    scanWithFilter: ReturnType<typeof vi.fn>;
    scanCrossRepo: ReturnType<typeof vi.fn>;
    supportsCrossRepo: boolean;
  };

  let mockCtx: ToolContext;

  // Helper to create mock analysis result
  function createMockAnalysis(
    overrides: {
      dependents?: Array<{
        filepath: string;
        isTestFile: boolean;
        usages?: Array<{ callerSymbol: string; line: number; snippet: string }>;
        hops?: number;
      }>;
      hitLimit?: boolean;
      complexityMetrics?: {
        averageComplexity: number;
        maxComplexity: number;
        filesWithComplexityData: number;
        highComplexityDependents: Array<{
          filepath: string;
          maxComplexity: number;
          avgComplexity: number;
        }>;
        complexityRiskBoost: 'low' | 'medium' | 'high' | 'critical';
      };
      totalUsageCount?: number;
      truncated?: boolean;
      uncoveredProductionDependents?: number;
    } = {},
  ) {
    const dependents = overrides.dependents ?? [{ filepath: 'src/consumer.ts', isTestFile: false }];
    const testDependentCount = dependents.filter(d => d.isTestFile).length;
    const productionDependentCount = dependents.length - testDependentCount;

    return {
      dependents,
      productionDependentCount,
      testDependentCount,
      chunksByFile: new Map(),
      fileComplexities: [],
      complexityMetrics: overrides.complexityMetrics ?? {
        averageComplexity: 5,
        maxComplexity: 8,
        filesWithComplexityData: 1,
        highComplexityDependents: [],
        complexityRiskBoost: 'low' as const,
      },
      hitLimit: overrides.hitLimit ?? false,
      allChunks: [] as SearchResult[],
      totalUsageCount: overrides.totalUsageCount,
      truncated: overrides.truncated ?? false,
      uncoveredProductionDependents: overrides.uncoveredProductionDependents ?? 0,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();

    mockVectorDB = {
      scanWithFilter: vi.fn(),
      scanCrossRepo: vi.fn(),
      supportsCrossRepo: false,
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

    // Default mock for findDependents
    vi.mocked(findDependents).mockResolvedValue(createMockAnalysis());
  });

  describe('basic functionality', () => {
    it('should return dependents with indexInfo', async () => {
      const mockAnalysis = createMockAnalysis({
        dependents: [
          { filepath: 'src/auth.ts', isTestFile: false },
          { filepath: 'src/user.ts', isTestFile: false },
        ],
      });
      vi.mocked(findDependents).mockResolvedValue(mockAnalysis);

      const result = await handleGetDependents({ filepath: 'src/utils/validate.ts' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.filepath).toBe('src/utils/validate.ts');
      expect(parsed.dependentCount).toBe(2);
      expect(parsed.dependents).toHaveLength(2);
      expect(parsed.indexInfo).toEqual({
        indexVersion: 1234567890,
        indexDate: '2025-12-19',
      });
    });

    it('should call findDependents with correct parameters', async () => {
      await handleGetDependents({ filepath: 'src/utils/helpers.ts' }, mockCtx);

      expect(findDependents).toHaveBeenCalledWith(
        mockVectorDB,
        'src/utils/helpers.ts',
        false, // crossRepo default
        mockLog,
        undefined, // symbol default
        1234567890, // indexVersion from mock
        1, // depth default
        500, // maxNodes default
      );
    });

    it('should call checkAndReconnect before analysis', async () => {
      await handleGetDependents({ filepath: 'src/test.ts' }, mockCtx);

      expect(mockCheckAndReconnect).toHaveBeenCalled();
    });

    it('should handle no dependents gracefully', async () => {
      vi.mocked(findDependents).mockResolvedValue(
        createMockAnalysis({
          dependents: [],
        }),
      );

      const result = await handleGetDependents({ filepath: 'src/isolated.ts' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.dependentCount).toBe(0);
      expect(parsed.dependents).toHaveLength(0);
      expect(parsed.riskLevel).toBe('low');
    });
  });

  describe('risk level calculation', () => {
    it('should return low risk for few dependents', async () => {
      vi.mocked(findDependents).mockResolvedValue(
        createMockAnalysis({
          dependents: [
            { filepath: 'src/a.ts', isTestFile: false },
            { filepath: 'src/b.ts', isTestFile: false },
          ],
          complexityMetrics: {
            averageComplexity: 3,
            maxComplexity: 5,
            filesWithComplexityData: 2,
            highComplexityDependents: [],
            complexityRiskBoost: 'low',
          },
        }),
      );

      const result = await handleGetDependents({ filepath: 'src/utils.ts' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.riskLevel).toBe('low');
    });

    it('should include complexity metrics in response', async () => {
      const complexityMetrics = {
        averageComplexity: 12,
        maxComplexity: 25,
        filesWithComplexityData: 5,
        highComplexityDependents: [
          { filepath: 'src/complex.ts', maxComplexity: 25, avgComplexity: 15 },
        ],
        complexityRiskBoost: 'high' as const,
      };

      vi.mocked(findDependents).mockResolvedValue(
        createMockAnalysis({
          dependents: Array(20)
            .fill(null)
            .map((_, i) => ({
              filepath: `src/file${i}.ts`,
              isTestFile: false,
            })),
          complexityMetrics,
        }),
      );

      const result = await handleGetDependents({ filepath: 'src/core.ts' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.complexityMetrics).toEqual(complexityMetrics);
    });

    it('should escalate to high when an untested dependent is highly complex', async () => {
      // computeBlastRadiusRisk: hasHighComplexityUncovered (maxComplexity >= 15 with uncovered > 0)
      // → high regardless of dependent count.
      vi.mocked(findDependents).mockResolvedValue(
        createMockAnalysis({
          dependents: [{ filepath: 'src/a.ts', isTestFile: false }],
          uncoveredProductionDependents: 1,
          complexityMetrics: {
            averageComplexity: 20,
            maxComplexity: 30,
            filesWithComplexityData: 1,
            highComplexityDependents: [
              { filepath: 'src/a.ts', maxComplexity: 30, avgComplexity: 20 },
            ],
            complexityRiskBoost: 'critical',
          },
        }),
      );

      const result = await handleGetDependents({ filepath: 'src/utils.ts' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.riskLevel).toBe('high');
      expect(parsed.riskReasoning).toEqual(
        expect.arrayContaining(['untested high-complexity dependent']),
      );
    });

    it('should keep risk low when complexity is high but all dependents are tested', async () => {
      // hasHighComplexityUncovered only fires when uncovered > 0.
      vi.mocked(findDependents).mockResolvedValue(
        createMockAnalysis({
          dependents: [{ filepath: 'src/a.ts', isTestFile: false }],
          uncoveredProductionDependents: 0,
          complexityMetrics: {
            averageComplexity: 20,
            maxComplexity: 30,
            filesWithComplexityData: 1,
            highComplexityDependents: [
              { filepath: 'src/a.ts', maxComplexity: 30, avgComplexity: 20 },
            ],
            complexityRiskBoost: 'critical',
          },
        }),
      );

      const result = await handleGetDependents({ filepath: 'src/utils.ts' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.riskLevel).toBe('low');
    });
  });

  describe('hitLimit behavior', () => {
    it('should include warning note when scan limit is reached', async () => {
      vi.mocked(findDependents).mockResolvedValue(
        createMockAnalysis({
          hitLimit: true,
          dependents: Array(50)
            .fill(null)
            .map((_, i) => ({
              filepath: `src/file${i}.ts`,
              isTestFile: false,
            })),
        }),
      );

      const result = await handleGetDependents({ filepath: 'src/widely-used.ts' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.note).toContain('10,000');
      expect(parsed.note).toContain('limit reached');
      expect(parsed.note).toContain('incomplete');
    });

    it('should not include note when scan limit is not reached', async () => {
      vi.mocked(findDependents).mockResolvedValue(
        createMockAnalysis({
          hitLimit: false,
        }),
      );

      const result = await handleGetDependents({ filepath: 'src/normal.ts' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.note).toBeUndefined();
    });
  });

  describe('cross-repo search with Qdrant', () => {
    let mockQdrantDB: any;

    beforeEach(() => {
      mockQdrantDB = {
        scanWithFilter: vi.fn(),
        scanCrossRepo: vi.fn(),
        supportsCrossRepo: true,
      };

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

    it('should pass crossRepo=true to findDependents when enabled', async () => {
      vi.mocked(findDependents).mockResolvedValue(createMockAnalysis());

      await handleGetDependents({ filepath: 'src/shared/utils.ts', crossRepo: true }, mockCtx);

      expect(findDependents).toHaveBeenCalledWith(
        mockQdrantDB,
        'src/shared/utils.ts',
        true,
        mockLog,
        undefined,
        1234567890,
        1,
        500,
      );
    });

    it('should include groupedByRepo when crossRepo=true with Qdrant', async () => {
      const mockChunks: SearchResult[] = [
        {
          content: 'import { util } from "./utils"',
          metadata: {
            file: 'repo-a/src/consumer.ts',
            repoId: 'repo-a',
            startLine: 1,
            endLine: 5,
            type: 'block',
            language: 'typescript',
          },
          score: 0,
          relevance: 'highly_relevant',
        },
        {
          content: 'import { util } from "./utils"',
          metadata: {
            file: 'repo-b/src/other.ts',
            repoId: 'repo-b',
            startLine: 1,
            endLine: 5,
            type: 'block',
            language: 'typescript',
          },
          score: 0,
          relevance: 'highly_relevant',
        },
      ];

      vi.mocked(findDependents).mockResolvedValue({
        ...createMockAnalysis({
          dependents: [
            { filepath: 'repo-a/src/consumer.ts', isTestFile: false },
            { filepath: 'repo-b/src/other.ts', isTestFile: false },
          ],
        }),
        allChunks: mockChunks,
      });

      const result = await handleGetDependents(
        { filepath: 'shared/utils.ts', crossRepo: true },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.groupedByRepo).toBeDefined();
    });
  });

  describe('cross-repo fallback (non-Qdrant)', () => {
    it('should not include groupedByRepo when not using Qdrant', async () => {
      vi.mocked(findDependents).mockResolvedValue(createMockAnalysis());

      const result = await handleGetDependents(
        { filepath: 'src/utils.ts', crossRepo: true },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.groupedByRepo).toBeUndefined();
    });

    it('should still pass crossRepo to findDependents (which handles warning)', async () => {
      vi.mocked(findDependents).mockResolvedValue(createMockAnalysis());

      await handleGetDependents({ filepath: 'src/utils.ts', crossRepo: true }, mockCtx);

      expect(findDependents).toHaveBeenCalledWith(
        mockVectorDB,
        'src/utils.ts',
        true,
        mockLog,
        undefined,
        1234567890,
        1,
        500,
      );
    });
  });

  describe('validation', () => {
    it('should reject empty filepath', async () => {
      const result = await handleGetDependents({ filepath: '' }, mockCtx);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.error).toBe('Invalid parameters');
      expect(parsed.details).toContainEqual(
        expect.objectContaining({
          field: 'filepath',
          message: expect.stringContaining('cannot be empty'),
        }),
      );
    });

    it('should accept valid filepath', async () => {
      vi.mocked(findDependents).mockResolvedValue(createMockAnalysis());

      const result = await handleGetDependents({ filepath: 'src/valid/path.ts' }, mockCtx);

      expect(result.isError).toBeUndefined();
    });

    it('should use default depth of 1', async () => {
      vi.mocked(findDependents).mockResolvedValue(createMockAnalysis());

      const result = await handleGetDependents({ filepath: 'src/test.ts' }, mockCtx);

      // Should not error - depth defaults to 1
      expect(result.isError).toBeUndefined();
    });
  });

  describe('logging', () => {
    it('should log the filepath being analyzed', async () => {
      vi.mocked(findDependents).mockResolvedValue(createMockAnalysis());

      await handleGetDependents({ filepath: 'src/important.ts' }, mockCtx);

      expect(mockLog).toHaveBeenCalledWith('Finding dependents of: src/important.ts');
    });

    it('should indicate cross-repo in log when enabled', async () => {
      vi.mocked(findDependents).mockResolvedValue(createMockAnalysis());

      await handleGetDependents({ filepath: 'src/shared.ts', crossRepo: true }, mockCtx);

      expect(mockLog).toHaveBeenCalledWith('Finding dependents of: src/shared.ts (cross-repo)');
    });

    it('should log dependent count with prod/test breakdown', async () => {
      vi.mocked(findDependents).mockResolvedValue(
        createMockAnalysis({
          dependents: [
            { filepath: 'src/a.ts', isTestFile: false },
            { filepath: 'src/b.ts', isTestFile: false },
            { filepath: 'src/c.test.ts', isTestFile: true },
          ],
        }),
      );

      await handleGetDependents({ filepath: 'src/utils.ts' }, mockCtx);

      expect(mockLog).toHaveBeenCalledWith(
        expect.stringContaining('Found 3 dependents (2 prod, 1 test)'),
      );
    });
  });

  describe('test file identification', () => {
    it('should include isTestFile flag for each dependent', async () => {
      vi.mocked(findDependents).mockResolvedValue(
        createMockAnalysis({
          dependents: [
            { filepath: 'src/auth.ts', isTestFile: false },
            { filepath: 'src/__tests__/auth.test.ts', isTestFile: true },
          ],
        }),
      );

      const result = await handleGetDependents({ filepath: 'src/utils.ts' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.dependents).toContainEqual(
        expect.objectContaining({ filepath: 'src/auth.ts', isTestFile: false }),
      );
      expect(parsed.dependents).toContainEqual(
        expect.objectContaining({ filepath: 'src/__tests__/auth.test.ts', isTestFile: true }),
      );
    });
  });

  describe('test/production split', () => {
    it('should return separate counts for test and production dependents', async () => {
      vi.mocked(findDependents).mockResolvedValue(
        createMockAnalysis({
          dependents: [
            { filepath: 'src/auth.ts', isTestFile: false },
            { filepath: 'src/user.ts', isTestFile: false },
            { filepath: 'src/__tests__/auth.test.ts', isTestFile: true },
            { filepath: 'src/__tests__/user.test.ts', isTestFile: true },
            { filepath: 'src/utils.test.ts', isTestFile: true },
          ],
        }),
      );

      const result = await handleGetDependents({ filepath: 'src/utils.ts' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.productionDependentCount).toBe(2);
      expect(parsed.testDependentCount).toBe(3);
      expect(parsed.dependentCount).toBe(5);
    });

    it('should calculate risk based on production dependents only', async () => {
      // 10 test dependents + 1 production dependent = 11 total
      // With all dependents: would be "medium" risk (6-15 threshold)
      // With only production: should be "low" risk (1-5 threshold)
      vi.mocked(findDependents).mockResolvedValue(
        createMockAnalysis({
          dependents: [
            { filepath: 'src/consumer.ts', isTestFile: false },
            ...Array.from({ length: 10 }, (_, i) => ({
              filepath: `src/__tests__/test${i}.test.ts`,
              isTestFile: true,
            })),
          ],
        }),
      );

      const result = await handleGetDependents({ filepath: 'src/utils.ts' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.dependentCount).toBe(11);
      expect(parsed.productionDependentCount).toBe(1);
      expect(parsed.testDependentCount).toBe(10);
      expect(parsed.riskLevel).toBe('low');
    });

    it('should return low risk when all dependents are test files', async () => {
      vi.mocked(findDependents).mockResolvedValue(
        createMockAnalysis({
          dependents: [
            { filepath: 'src/__tests__/a.test.ts', isTestFile: true },
            { filepath: 'src/__tests__/b.test.ts', isTestFile: true },
            { filepath: 'src/__tests__/c.test.ts', isTestFile: true },
          ],
        }),
      );

      const result = await handleGetDependents({ filepath: 'src/internal-util.ts' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.productionDependentCount).toBe(0);
      expect(parsed.testDependentCount).toBe(3);
      expect(parsed.riskLevel).toBe('low');
    });

    it('should escalate to high for an untested high-complexity dependent', async () => {
      // Under computeBlastRadiusRisk, hasHighComplexityUncovered caps at "high"
      // unless dependentCount also exceeds 20.
      vi.mocked(findDependents).mockResolvedValue(
        createMockAnalysis({
          dependents: [{ filepath: 'src/complex.ts', isTestFile: false }],
          uncoveredProductionDependents: 1,
          complexityMetrics: {
            averageComplexity: 30,
            maxComplexity: 50,
            filesWithComplexityData: 1,
            highComplexityDependents: [
              { filepath: 'src/complex.ts', maxComplexity: 50, avgComplexity: 30 },
            ],
            complexityRiskBoost: 'critical',
          },
        }),
      );

      const result = await handleGetDependents({ filepath: 'src/utils.ts' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.productionDependentCount).toBe(1);
      expect(parsed.riskLevel).toBe('high');
    });
  });

  describe('symbol-level usage tracking', () => {
    it('should pass symbol parameter to findDependents', async () => {
      vi.mocked(findDependents).mockResolvedValue(createMockAnalysis());

      await handleGetDependents(
        { filepath: 'src/utils/validate.ts', symbol: 'validateEmail' },
        mockCtx,
      );

      expect(findDependents).toHaveBeenCalledWith(
        mockVectorDB,
        'src/utils/validate.ts',
        false,
        mockLog,
        'validateEmail',
        1234567890,
        1,
        500,
      );
    });

    it('should include symbol in response when provided', async () => {
      vi.mocked(findDependents).mockResolvedValue({
        ...createMockAnalysis(),
        totalUsageCount: 3,
      });

      const result = await handleGetDependents(
        { filepath: 'src/utils/validate.ts', symbol: 'validateEmail' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.symbol).toBe('validateEmail');
      expect(parsed.totalUsageCount).toBe(3);
    });

    it('should include usages array in dependents when symbol usages found', async () => {
      vi.mocked(findDependents).mockResolvedValue({
        ...createMockAnalysis({
          dependents: [
            {
              filepath: 'src/signup.ts',
              isTestFile: false,
              usages: [
                { callerSymbol: 'signupUser', line: 45, snippet: 'validateEmail(input.email)' },
              ],
            },
            {
              filepath: 'src/profile.ts',
              isTestFile: false,
              usages: [
                { callerSymbol: 'updateEmail', line: 89, snippet: 'if (!validateEmail(newEmail))' },
              ],
            },
          ],
        }),
        totalUsageCount: 2,
      });

      const result = await handleGetDependents(
        { filepath: 'src/utils/validate.ts', symbol: 'validateEmail' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.totalUsageCount).toBe(2);
      expect(parsed.dependents).toHaveLength(2);
      expect(parsed.dependents[0].usages).toHaveLength(1);
      expect(parsed.dependents[0].usages[0]).toEqual({
        callerSymbol: 'signupUser',
        line: 45,
        snippet: 'validateEmail(input.email)',
      });
    });

    it('should include dependents that import symbol but have no tracked call sites', async () => {
      vi.mocked(findDependents).mockResolvedValue({
        ...createMockAnalysis({
          dependents: [
            {
              filepath: 'src/consumer.ts',
              isTestFile: false,
              usages: undefined, // Imports but no call sites tracked
            },
          ],
        }),
        totalUsageCount: 0,
      });

      const result = await handleGetDependents(
        { filepath: 'src/utils/validate.ts', symbol: 'validateEmail' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.dependentCount).toBe(1);
      expect(parsed.totalUsageCount).toBe(0);
      expect(parsed.dependents[0].usages).toBeUndefined();
    });

    it('should log usage count when symbol is provided', async () => {
      vi.mocked(findDependents).mockResolvedValue({
        ...createMockAnalysis({
          dependents: [
            { filepath: 'src/a.ts', isTestFile: false },
            { filepath: 'src/b.ts', isTestFile: false },
          ],
        }),
        totalUsageCount: 5,
      });

      await handleGetDependents({ filepath: 'src/utils.ts', symbol: 'myFunction' }, mockCtx);

      expect(mockLog).toHaveBeenCalledWith(
        expect.stringContaining('Found 5 tracked call sites across 2 files'),
      );
    });

    it('should indicate symbol in initial log message', async () => {
      vi.mocked(findDependents).mockResolvedValue(createMockAnalysis());

      await handleGetDependents({ filepath: 'src/utils.ts', symbol: 'helper' }, mockCtx);

      expect(mockLog).toHaveBeenCalledWith('Finding dependents of: src/utils.ts (symbol: helper)');
    });

    it('should not include totalUsageCount when symbol not provided', async () => {
      vi.mocked(findDependents).mockResolvedValue(createMockAnalysis());

      const result = await handleGetDependents({ filepath: 'src/utils.ts' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.symbol).toBeUndefined();
      expect(parsed.totalUsageCount).toBeUndefined();
    });
  });

  describe('depth / maxNodes / transitive response fields', () => {
    it('should thread depth and maxNodes through to findDependents', async () => {
      vi.mocked(findDependents).mockResolvedValue(createMockAnalysis());

      await handleGetDependents({ filepath: 'src/target.ts', depth: 3, maxNodes: 50 }, mockCtx);

      expect(findDependents).toHaveBeenCalledWith(
        mockVectorDB,
        'src/target.ts',
        false,
        mockLog,
        undefined,
        1234567890,
        3,
        50,
      );
    });

    it('should echo the requested depth in the response', async () => {
      vi.mocked(findDependents).mockResolvedValue(createMockAnalysis());

      const result = await handleGetDependents({ filepath: 'src/target.ts', depth: 2 }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.depth).toBe(2);
    });

    it('should surface truncated and totalImpacted in the response', async () => {
      vi.mocked(findDependents).mockResolvedValue(
        createMockAnalysis({
          dependents: [
            { filepath: 'src/a.ts', isTestFile: false, hops: 1 },
            { filepath: 'src/b.ts', isTestFile: false, hops: 2 },
          ],
          truncated: true,
        }),
      );

      const result = await handleGetDependents(
        { filepath: 'src/target.ts', depth: 2, maxNodes: 2 },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.truncated).toBe(true);
      expect(parsed.totalImpacted).toBe(2);
      expect(parsed.dependents[0].hops).toBe(1);
      expect(parsed.dependents[1].hops).toBe(2);
    });

    it('should include riskReasoning from computeBlastRadiusRisk', async () => {
      vi.mocked(findDependents).mockResolvedValue(
        createMockAnalysis({
          dependents: Array.from({ length: 8 }, (_, i) => ({
            filepath: `src/f${i}.ts`,
            isTestFile: false,
          })),
          uncoveredProductionDependents: 3,
          complexityMetrics: {
            averageComplexity: 6,
            maxComplexity: 12,
            filesWithComplexityData: 8,
            highComplexityDependents: [],
            complexityRiskBoost: 'medium',
          },
        }),
      );

      const result = await handleGetDependents({ filepath: 'src/utils.ts' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.riskLevel).toBe('medium');
      expect(parsed.riskReasoning).toEqual(
        expect.arrayContaining(['8 callers', '3 untested', 'max complexity 12']),
      );
    });

    it('should log transitive depth in the initial request line', async () => {
      vi.mocked(findDependents).mockResolvedValue(createMockAnalysis());

      await handleGetDependents({ filepath: 'src/target.ts', depth: 2 }, mockCtx);

      expect(mockLog).toHaveBeenCalledWith('Finding dependents of: src/target.ts (depth: 2)');
    });

    it('should reject depth above schema max', async () => {
      const result = await handleGetDependents({ filepath: 'src/target.ts', depth: 99 }, mockCtx);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.error).toBe('Invalid parameters');
    });
  });
});
