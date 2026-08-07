import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGetDependents } from './get-dependents.js';
import type { ToolContext } from '../types.js';
import type { SearchResult } from '@liendev/core';
import type { InferredDependentMechanism, EdgeProvenance, DependencyGraph } from '@liendev/parser';

// Mock the dependency-analyzer module
vi.mock('./dependency-analyzer.js', async importOriginal => {
  const original = await importOriginal();
  return {
    ...(original as Record<string, unknown>),
    findDependents: vi.fn(),
    getOrBuildDependencyGraph: vi.fn(),
  };
});

import { findDependents, getOrBuildDependencyGraph } from './dependency-analyzer.js';

vi.mock('../utils/unindexed-paths.js', async importOriginal => {
  const original = await importOriginal();
  return {
    ...(original as Record<string, unknown>),
    findUnindexedPaths: vi.fn().mockResolvedValue([]),
  };
});

import { findUnindexedPaths } from '../utils/unindexed-paths.js';

describe('handleGetDependents', () => {
  const mockLog = vi.fn();
  const mockCheckAndReconnect = vi.fn().mockResolvedValue(undefined);
  const mockGetIndexMetadata = vi.fn(() => ({
    indexVersion: 1234567890,
    indexDate: '2025-12-19',
  }));

  let mockVectorDB: {
    scanWithFilter: ReturnType<typeof vi.fn>;
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
        confidence?: 'inferred';
        inferredVia?: InferredDependentMechanism;
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
      symbolAttributionDegraded?: boolean;
      symbolFoundInFile?: boolean;
      typeSymbolAttributionIncomplete?: boolean;
      dependentAttributionIncomplete?: boolean;
      dependentAttributionPartial?: boolean;
      targetIndexed?: boolean;
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
      symbolAttributionDegraded: overrides.symbolAttributionDegraded,
      symbolFoundInFile: overrides.symbolFoundInFile,
      typeSymbolAttributionIncomplete: overrides.typeSymbolAttributionIncomplete,
      dependentAttributionIncomplete: overrides.dependentAttributionIncomplete,
      dependentAttributionPartial: overrides.dependentAttributionPartial,
      targetIndexed: overrides.targetIndexed ?? true,
    };
  }

  // Helper to build a fake `DependencyGraph` for `getOrBuildDependencyGraph`,
  // keyed the same way the real `getCallers` is: `${filepath}::${symbolName}`.
  // `edgesByKey` lets a test say exactly which provenance tier each caller
  // file should come back tagged with, so tests can prove the evidence
  // filter (`isImportOnlyEvidenceTier`) keeps the safe tiers and drops the
  // unsafe ones (`require-only`, `symbol-name-match`, `same-file`).
  function createMockGraph(
    edgesByKey: Record<string, Array<{ filepath: string; provenance: EdgeProvenance }>> = {},
  ): DependencyGraph {
    return {
      getCallers: vi.fn((filepath: string, symbolName: string) => {
        const entries = edgesByKey[`${filepath}::${symbolName}`] ?? [];
        return entries.map(({ filepath: callerFile, provenance }) => ({
          caller: { filepath: callerFile, symbolName: '(module-level)', chunk: {} as any },
          callSiteLine: 0,
          provenance,
        }));
      }),
      getCallersTransitive: vi.fn(() => ({ callers: [], truncated: false, visitedSymbols: 0 })),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();

    mockVectorDB = {
      scanWithFilter: vi.fn(),
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

    // Default mock for findDependents
    vi.mocked(findDependents).mockResolvedValue(createMockAnalysis());
    vi.mocked(findUnindexedPaths).mockResolvedValue([]);
    // Default: the graph exists but has no edges for anything -- most tests
    // never exercise a type-symbol query, and the ones that do override this.
    vi.mocked(getOrBuildDependencyGraph).mockResolvedValue(createMockGraph());
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

    it('should not report low risk when complexity is critical, even with full test coverage (#933)', async () => {
      // Regression test for #933: a critical complexityRiskBoost must never
      // be paired with riskLevel "low" -- being tested lowers the odds of a
      // *silent* break, it doesn't shrink the blast radius of a
      // critical-complexity caller. Before the fix, hasHighComplexityUncovered
      // (the only path complexity fed into the verdict) required uncovered > 0
      // to fire at all, so this exact shape came back "low" despite its own
      // complexityRiskBoost reading "critical".
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
      expect(parsed.riskLevel).toBe('high');
      expect(parsed.riskReasoning).toEqual(
        expect.arrayContaining(['critical-complexity dependent regardless of test coverage']),
      );
    });

    it('should not escalate a fully-tested untested-linked case above what an untested one already reaches (#933 regression guard)', async () => {
      // The console/Cursor.php shape above must not overtake the "genuinely
      // untested AND high-complexity" case -- testedness still matters, it
      // just can no longer suppress the complexity signal entirely. A
      // critical complexityRiskBoost paired with an actual untested
      // high-complexity dependent stays "high", the same as before this fix
      // (hasHighComplexityUncovered already reaches full severity on its own).
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

  describe('attributionCaveat: symbol-attribution-degraded (method/constructor symbols)', () => {
    it('surfaces attributionCaveat when the analyzer degrades to file-level (symbol confirmed present, e.g. a real method/constructor)', async () => {
      vi.mocked(findDependents).mockResolvedValue({
        ...createMockAnalysis({
          dependents: [{ filepath: 'src/QuestionHelper.php', isTestFile: false }],
          symbolAttributionDegraded: true,
          symbolFoundInFile: true,
        }),
        totalUsageCount: undefined,
      });

      const result = await handleGetDependents(
        { filepath: 'src/Cursor.php', symbol: '__construct' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.attributionCaveat.reason).toBe('symbol-attribution-degraded');
      expect(parsed.attributionCaveat.note).toContain('__construct');
      expect(parsed.attributionCaveat.note).toContain('top-level exports');
      expect(parsed.attributionCaveat.note).toContain('likely a method or constructor');
      expect(parsed.dependentCount).toBe(1);
      expect(parsed.totalUsageCount).toBeUndefined();
    });

    it('hedges instead of asserting "method or constructor" when the symbol is absent from the file entirely (typo/hallucinated/removed)', async () => {
      vi.mocked(findDependents).mockResolvedValue({
        ...createMockAnalysis({
          dependents: [{ filepath: 'src/QuestionHelper.php', isTestFile: false }],
          symbolAttributionDegraded: true,
          symbolFoundInFile: false,
        }),
        totalUsageCount: undefined,
      });

      const result = await handleGetDependents(
        { filepath: 'src/Cursor.php', symbol: 'totallyMadeUpSymbolXYZ123' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.attributionCaveat.reason).toBe('symbol-attribution-degraded');
      expect(parsed.attributionCaveat.note).toContain('totallyMadeUpSymbolXYZ123');
      // Must NOT confidently assert the method/constructor cause when it
      // hasn't been established.
      expect(parsed.attributionCaveat.note).not.toContain('likely a method or constructor');
      expect(parsed.attributionCaveat.note).toMatch(/typo|hallucinated|removed/);
      // The file-level-answer explanation must survive intact either way.
      expect(parsed.attributionCaveat.note).toContain('file-level answer');
      expect(parsed.dependentCount).toBe(1);
      expect(parsed.totalUsageCount).toBeUndefined();
    });

    it('omits attributionCaveat for a normal, non-degraded symbol query', async () => {
      vi.mocked(findDependents).mockResolvedValue({
        ...createMockAnalysis({ dependents: [{ filepath: 'src/a.ts', isTestFile: false }] }),
        totalUsageCount: 1,
      });

      const result = await handleGetDependents(
        { filepath: 'src/utils/validate.ts', symbol: 'validateEmail' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.attributionCaveat).toBeUndefined();
    });
  });

  describe('attributionCaveat: type-symbol-attribution-incomplete (class/struct/interface/enum usage floor, #1015)', () => {
    it('surfaces attributionCaveat for a type-shaped symbol query even though dependents were found', async () => {
      vi.mocked(findDependents).mockResolvedValue({
        ...createMockAnalysis({
          dependents: [{ filepath: 'src/api/users.ts', isTestFile: false }],
          typeSymbolAttributionIncomplete: true,
        }),
        totalUsageCount: 0,
      });

      const result = await handleGetDependents(
        { filepath: 'src/types.ts', symbol: 'User' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.attributionCaveat.reason).toBe('type-symbol-attribution-incomplete');
      expect(parsed.attributionCaveat.note).toContain('User');
      expect(parsed.attributionCaveat.note).toContain('class/struct/interface/enum declaration');
      expect(parsed.attributionCaveat.note).toContain('not a verified total');
      expect(parsed.dependentCount).toBe(1);
      expect(parsed.totalUsageCount).toBe(0);
    });

    it('omits attributionCaveat for a normal function symbol query with real usages (e.g. PHP formatPrice)', async () => {
      vi.mocked(findDependents).mockResolvedValue({
        ...createMockAnalysis({
          dependents: [{ filepath: 'src/ProductController.php', isTestFile: false }],
        }),
        totalUsageCount: 5,
      });

      const result = await handleGetDependents(
        { filepath: 'src/PricingService.php', symbol: 'formatPrice' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.attributionCaveat).toBeUndefined();
      expect(parsed.totalUsageCount).toBe(5);
      expect(parsed.importedBy).toBeUndefined();
    });
  });

  describe('importedBy: real import-only evidence for a type-symbol query (#1015 fix direction 2)', () => {
    it('surfaces importedBy and folds the count into the caveat note when the graph has real import-only evidence', async () => {
      vi.mocked(findDependents).mockResolvedValue({
        ...createMockAnalysis({
          dependents: [
            { filepath: 'src/api/users.ts', isTestFile: false },
            { filepath: 'src/api/orders.ts', isTestFile: false },
          ],
          typeSymbolAttributionIncomplete: true,
        }),
        totalUsageCount: 0,
      });
      vi.mocked(getOrBuildDependencyGraph).mockResolvedValue(
        createMockGraph({
          'src/types.ts::User': [{ filepath: 'src/api/users.ts', provenance: 'import-only' }],
        }),
      );

      const result = await handleGetDependents(
        { filepath: 'src/types.ts', symbol: 'User' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.importedBy).toEqual(['src/api/users.ts']);
      expect(parsed.attributionCaveat.note).toContain('1 file(s)');
      expect(parsed.attributionCaveat.note).toContain('verifiably import');
      expect(parsed.attributionCaveat.note).toContain('importedBy');
      // Non-blind-spot language (TypeScript): the original file-level
      // reassurance stays intact (#1057 only hedges it for the four
      // blind-spot languages).
      expect(parsed.attributionCaveat.note).toContain('remain reliable');
    });

    it('reports importedBy: [] and an honest "checked, found nothing" note when the graph genuinely has no evidence', async () => {
      vi.mocked(findDependents).mockResolvedValue({
        ...createMockAnalysis({
          dependents: [{ filepath: 'src/api/users.ts', isTestFile: false }],
          typeSymbolAttributionIncomplete: true,
        }),
        totalUsageCount: 0,
      });
      // Default mock graph (set in beforeEach) has no edges for anything.

      const result = await handleGetDependents(
        { filepath: 'src/types.ts', symbol: 'User' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.importedBy).toEqual([]);
      expect(parsed.attributionCaveat.note).toContain('checked');
      expect(parsed.attributionCaveat.note).toContain('importedBy');
      expect(parsed.attributionCaveat.note).toContain('is empty');
    });

    it('never surfaces require-only, symbol-name-match, or same-file edges through importedBy, even when the graph has them', async () => {
      vi.mocked(findDependents).mockResolvedValue({
        ...createMockAnalysis({
          dependents: [
            { filepath: 'src/a.ts', isTestFile: false },
            { filepath: 'src/b.ts', isTestFile: false },
            { filepath: 'src/c.ts', isTestFile: false },
            { filepath: 'src/types.ts', isTestFile: false },
          ],
          typeSymbolAttributionIncomplete: true,
        }),
        totalUsageCount: 0,
      });
      vi.mocked(getOrBuildDependencyGraph).mockResolvedValue(
        createMockGraph({
          'src/types.ts::User': [
            { filepath: 'src/a.ts', provenance: 'require-only' },
            { filepath: 'src/b.ts', provenance: 'symbol-name-match' },
            { filepath: 'src/types.ts', provenance: 'same-file' },
            { filepath: 'src/c.ts', provenance: 'import-only' },
          ],
        }),
      );

      const result = await handleGetDependents(
        { filepath: 'src/types.ts', symbol: 'User' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.importedBy).toEqual(['src/c.ts']);
    });

    it('enforces the subset property BY CONSTRUCTION: a graph-reported caller absent from dependents is dropped, not trusted', async () => {
      // `findDependents` (mocked here) is the authority on `dependents`; the
      // graph is a SEPARATE mechanism that must never widen it. Simulates the
      // two disagreeing -- e.g. a future change to one resolver's guards
      // drifting from the other's -- to prove `computeImportOnlyEvidence`
      // intersects against `analysis.dependents` rather than trusting the
      // graph's raw output (CodeRabbit finding on this PR: the earlier
      // version returned the graph's output unintersected, relying on the
      // two algorithms' properties continuing to line up instead of
      // enforcing it).
      vi.mocked(findDependents).mockResolvedValue({
        ...createMockAnalysis({
          dependents: [{ filepath: 'src/api/users.ts', isTestFile: false }],
          typeSymbolAttributionIncomplete: true,
        }),
        totalUsageCount: 0,
      });
      vi.mocked(getOrBuildDependencyGraph).mockResolvedValue(
        createMockGraph({
          'src/types.ts::User': [
            { filepath: 'src/api/users.ts', provenance: 'import-only' },
            // NOT in `dependents` above -- must never reach `importedBy`.
            { filepath: 'src/api/orphaned-not-a-real-dependent.ts', provenance: 'import-only' },
          ],
        }),
      );

      const result = await handleGetDependents(
        { filepath: 'src/types.ts', symbol: 'User' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.importedBy).toEqual(['src/api/users.ts']);
      expect(parsed.importedBy).not.toContain('src/api/orphaned-not-a-real-dependent.ts');
      // The actual subset assertion, on the parsed response as a whole --
      // not just this one fixture's expected value above.
      const dependentFiles = new Set(
        parsed.dependents.map((d: { filepath: string }) => d.filepath),
      );
      for (const file of parsed.importedBy) {
        expect(dependentFiles.has(file)).toBe(true);
      }
    });

    it('gates importedBy on the FINAL decided attributionCaveat reason, not the raw typeSymbolAttributionIncomplete flag', async () => {
      // The #927 manifest-based check and #928's chunk-based scan can
      // disagree on the same path (that disagreement is why both exist) --
      // simulate it by having `findUnindexedPaths` report the path as
      // unindexed while `findDependents`'s own chunk scan (mocked here)
      // independently found a type-symbol match. `unresolved-target` has
      // priority over `type-symbol-attribution-incomplete`
      // (`decideAttributionCaveatReason`), so `importedBy` must NOT populate
      // even though the raw flag is true -- CodeRabbit finding on this PR:
      // the earlier version gated on the raw flag alone, so a response could
      // carry a populated `importedBy` while `attributionCaveat.reason` named
      // something else entirely.
      vi.mocked(findUnindexedPaths).mockResolvedValue(['src/types.ts']);
      vi.mocked(findDependents).mockResolvedValue({
        ...createMockAnalysis({
          dependents: [{ filepath: 'src/api/users.ts', isTestFile: false }],
          typeSymbolAttributionIncomplete: true,
        }),
        totalUsageCount: 0,
      });
      vi.mocked(getOrBuildDependencyGraph).mockResolvedValue(
        createMockGraph({
          'src/types.ts::User': [{ filepath: 'src/api/users.ts', provenance: 'import-only' }],
        }),
      );

      const result = await handleGetDependents(
        { filepath: 'src/types.ts', symbol: 'User' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.attributionCaveat.reason).toBe('unresolved-target');
      expect(parsed.importedBy).toBeUndefined();
      expect(getOrBuildDependencyGraph).not.toHaveBeenCalled();
    });

    it('hedges dependentCount/dependents reliability too for a #1005 blind-spot language (Java)', async () => {
      vi.mocked(findDependents).mockResolvedValue({
        ...createMockAnalysis({
          dependents: [
            { filepath: 'src/main/java/com/example/UserService.java', isTestFile: false },
          ],
          typeSymbolAttributionIncomplete: true,
        }),
        totalUsageCount: 0,
      });

      const result = await handleGetDependents(
        { filepath: 'src/main/java/com/example/User.java', symbol: 'User' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.attributionCaveat.note).toContain("aren't a verified clear");
      expect(parsed.attributionCaveat.note).toContain('same-package');
      expect(parsed.attributionCaveat.note).not.toContain('remain reliable');
    });

    it('does not compute importedBy at all for a non-type-symbol query', async () => {
      vi.mocked(findDependents).mockResolvedValue({
        ...createMockAnalysis({ dependents: [{ filepath: 'src/consumer.ts', isTestFile: false }] }),
        totalUsageCount: 3,
      });

      const result = await handleGetDependents(
        { filepath: 'src/utils/validate.ts', symbol: 'validateEmail' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.importedBy).toBeUndefined();
      expect(getOrBuildDependencyGraph).not.toHaveBeenCalled();
    });

    it('passes the CANONICALIZED filepath to the graph, not the raw argument (backslashes must resolve to the graph key form)', async () => {
      vi.mocked(findDependents).mockResolvedValue({
        ...createMockAnalysis({
          dependents: [{ filepath: 'src/api/users.ts', isTestFile: false }],
          typeSymbolAttributionIncomplete: true,
        }),
        totalUsageCount: 0,
      });
      const mockGraph = createMockGraph({
        'src/types.ts::User': [{ filepath: 'src/api/users.ts', provenance: 'import-only' }],
      });
      vi.mocked(getOrBuildDependencyGraph).mockResolvedValue(mockGraph);

      // Schema requires a relative path (absolute paths and ".." are
      // rejected outright — see dependents.schema.ts), so the realistic
      // canonicalization case that can actually reach the handler is a
      // backslash-separated (Windows-style) relative path, not an absolute
      // one. `getCanonicalPath` must still normalize it to match the
      // graph's forward-slash key form.
      const result = await handleGetDependents(
        { filepath: 'src\\types.ts', symbol: 'User' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(mockGraph.getCallers).toHaveBeenCalledWith('src/types.ts', 'User');
      expect(parsed.importedBy).toEqual(['src/api/users.ts']);
    });
  });

  describe('attributionCaveat: dependent-attribution-incomplete (C# enclosing-namespace-access floor, #930)', () => {
    it('surfaces attributionCaveat for a zero-dependent file-level query', async () => {
      vi.mocked(findDependents).mockResolvedValue(
        createMockAnalysis({ dependents: [], dependentAttributionIncomplete: true }),
      );

      const result = await handleGetDependents(
        { filepath: 'src/Serilog/Parsing/Alignment.cs' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.dependentCount).toBe(0);
      expect(parsed.attributionCaveat.reason).toBe('dependent-attribution-incomplete');
      expect(parsed.attributionCaveat.note).toContain('Alignment.cs');
      expect(parsed.attributionCaveat.note).toContain('the scan found nothing');
    });

    it('omits attributionCaveat for a normal query', async () => {
      vi.mocked(findDependents).mockResolvedValue(createMockAnalysis());

      const result = await handleGetDependents({ filepath: 'src/utils/validate.ts' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.attributionCaveat).toBeUndefined();
    });
  });

  describe('attributionCaveat: dependent-attribution-partial (C# type-reference recovery, #930 part 2)', () => {
    it('surfaces attributionCaveat when the type-reference fallback recovered dependents', async () => {
      vi.mocked(findDependents).mockResolvedValue(
        createMockAnalysis({
          dependents: [
            {
              filepath: 'src/Serilog/Rendering/Padding.cs',
              isTestFile: false,
              confidence: 'inferred',
              inferredVia: 'csharp-type-reference',
            },
          ],
          dependentAttributionPartial: true,
        }),
      );

      const result = await handleGetDependents(
        { filepath: 'src/Serilog/Parsing/Alignment.cs' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.dependentCount).toBe(1);
      expect(parsed.dependents[0]).toMatchObject({
        filepath: 'src/Serilog/Rendering/Padding.cs',
        confidence: 'inferred',
      });
      expect(parsed.attributionCaveat.reason).toBe('dependent-attribution-partial');
      expect(parsed.attributionCaveat.note).toContain('Alignment.cs');
      expect(parsed.attributionCaveat.note).toContain('lower bound'.toUpperCase());
      expect(parsed.attributionCaveat.note).toContain('C#');
      expect(parsed.attributionCaveat.note).toContain('global using');
    });

    // #1018: this fallback is no longer C#-only. Before this fix the note below
    // told every recovered Go file "its language, C#" and described a
    // source-text type-name scan — measured on a real go-chi/chi clone, 24 of
    // 24 recovered edges across context.go/mux.go/chain.go.
    it("describes GO's fallback, not C#'s, when Go's root-package lookup recovered the dependents", async () => {
      vi.mocked(findDependents).mockResolvedValue(
        createMockAnalysis({
          dependents: [
            {
              filepath: 'middleware/clean_path.go',
              isTestFile: false,
              confidence: 'inferred',
              inferredVia: 'go-root-package-export',
            },
          ],
          dependentAttributionPartial: true,
        }),
      );

      const result = await handleGetDependents({ filepath: 'context.go' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      const note = parsed.attributionCaveat.note as string;
      expect(parsed.attributionCaveat.reason).toBe('dependent-attribution-partial');
      expect(note).toContain('its language, Go');
      // The regression this test exists for, asserted directly.
      expect(note).not.toContain('C#');
      expect(note).not.toContain('global using');
      expect(note).not.toContain('source text');
      // And it must actually describe Go's real mechanism.
      expect(note).toContain('import path');
      expect(note).toContain('exports');
    });

    it('describes both fallbacks when a response somehow carries both', async () => {
      vi.mocked(findDependents).mockResolvedValue(
        createMockAnalysis({
          dependents: [
            {
              filepath: 'a.cs',
              isTestFile: false,
              confidence: 'inferred',
              inferredVia: 'csharp-type-reference',
            },
            {
              filepath: 'b.go',
              isTestFile: false,
              confidence: 'inferred',
              inferredVia: 'go-root-package-export',
            },
          ],
          dependentAttributionPartial: true,
        }),
      );

      const result = await handleGetDependents({ filepath: 'target.cs' }, mockCtx);

      const note = JSON.parse(result.content![0].text).attributionCaveat.note as string;
      expect(note).toContain('its language, C# and Go');
      expect(note).toContain('2 of the 2 dependent(s)');
    });

    it('does not fire alongside dependent-attribution-incomplete', async () => {
      vi.mocked(findDependents).mockResolvedValue(
        createMockAnalysis({ dependents: [], dependentAttributionIncomplete: true }),
      );

      const result = await handleGetDependents(
        { filepath: 'src/Serilog/Parsing/Alignment.cs' },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.attributionCaveat.reason).toBe('dependent-attribution-incomplete');
    });
  });

  describe('depth / maxNodes / transitive response fields', () => {
    it('should thread depth and maxNodes through to findDependents', async () => {
      vi.mocked(findDependents).mockResolvedValue(createMockAnalysis());

      await handleGetDependents({ filepath: 'src/target.ts', depth: 3, maxNodes: 50 }, mockCtx);

      expect(findDependents).toHaveBeenCalledWith(
        mockVectorDB,
        'src/target.ts',
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

    it('echoes the EFFECTIVE depth (1), not the requested one, for a symbol-scoped query', async () => {
      // depth > 1 is documented as ignored for symbol queries (runBfsIfRequested
      // in dependency-analyzer.ts never runs BFS when `symbol` is set) -- but
      // the response used to echo back the requested `depth` unchanged, letting
      // a caller believe a multi-hop symbol walk ran when it didn't.
      vi.mocked(findDependents).mockResolvedValue(createMockAnalysis());

      const result = await handleGetDependents(
        { filepath: 'src/target.ts', symbol: 'doStuff', depth: 3 },
        mockCtx,
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.depth).toBe(1);
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
      // "production callers", not bare "callers" (#928) -- risk scoring feeds
      // productionDependentCount in, which can differ from the response's
      // wider top-level dependentCount (production + test); the label makes
      // that scoping explicit instead of leaving two unexplained numbers.
      expect(parsed.riskReasoning).toEqual(
        expect.arrayContaining(['8 production callers', '3 untested', 'max complexity 12']),
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

  describe('attributionCaveat: unresolved-target, manifest-based (#927)', () => {
    it('adds an unmissable attributionCaveat when the filepath has no manifest entry at all', async () => {
      vi.mocked(findUnindexedPaths).mockResolvedValue(['src/does/not/exist.ts']);

      const result = await handleGetDependents({ filepath: 'src/does/not/exist.ts' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.attributionCaveat.reason).toBe('unresolved-target');
      expect(parsed.attributionCaveat.note).toContain('⚠ Lien:');
      expect(parsed.attributionCaveat.note).toContain('"src/does/not/exist.ts"');
    });

    it('adds no attributionCaveat when the filepath is indexed, regardless of dependentCount', async () => {
      vi.mocked(findUnindexedPaths).mockResolvedValue([]);
      vi.mocked(findDependents).mockResolvedValue(
        createMockAnalysis({ dependents: [], targetIndexed: true }),
      );

      const result = await handleGetDependents({ filepath: 'src/isolated.ts' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.dependentCount).toBe(0);
      expect(parsed).not.toHaveProperty('attributionCaveat');
    });
  });

  describe('attributionCaveat: unresolved-target, chunk-based fallback (#928)', () => {
    it('adds an unmissable attributionCaveat when the target has no chunks in the index at all', async () => {
      // findUnindexedPaths defaults to [] in beforeEach (manifest has no
      // opinion here) -- this exercises the #928 chunk-based note on its own.
      vi.mocked(findDependents).mockResolvedValue(
        createMockAnalysis({ dependents: [], targetIndexed: false }),
      );

      const result = await handleGetDependents({ filepath: 'src/does/not/exist.ts' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.dependentCount).toBe(0);
      expect(parsed.riskLevel).toBe('low');
      expect(parsed.attributionCaveat.reason).toBe('unresolved-target');
      expect(parsed.attributionCaveat.note).toContain('⚠ Lien:');
      expect(parsed.attributionCaveat.note).toContain('"src/does/not/exist.ts"');
    });

    it('adds no attributionCaveat when the target is indexed, regardless of dependentCount', async () => {
      vi.mocked(findDependents).mockResolvedValue(
        createMockAnalysis({ dependents: [], targetIndexed: true }),
      );

      const result = await handleGetDependents({ filepath: 'src/isolated.ts' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.dependentCount).toBe(0);
      expect(parsed).not.toHaveProperty('attributionCaveat');
    });

    it('does not duplicate or contradict the #927 manifest note when both mechanisms would fire', async () => {
      // A genuinely nonexistent path is BOTH "not in the manifest" (#927)
      // AND "has no chunks in this scan" (#928) -- the overwhelming common
      // case. Only the manifest note (the more authoritative "is this path
      // even part of the indexed project" signal) should appear; the #928
      // note must not also append or overwrite it with a second, redundant
      // explanation of the same zero.
      vi.mocked(findUnindexedPaths).mockResolvedValue(['src/does/not/exist.ts']);
      vi.mocked(findDependents).mockResolvedValue(
        createMockAnalysis({ dependents: [], targetIndexed: false }),
      );

      const result = await handleGetDependents({ filepath: 'src/does/not/exist.ts' }, mockCtx);

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.attributionCaveat.reason).toBe('unresolved-target');
      expect(parsed.attributionCaveat.note).toContain('⚠ Lien:');
      // Exactly one caveat, sourced from #927 (its wording, not #928's).
      expect(parsed.attributionCaveat.note).toContain('not found in the index');
      expect(parsed.attributionCaveat.note).not.toContain('has no chunks anywhere in the index');
    });
  });
});
