import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SearchResult } from '@liendev/core';
import { QdrantDB } from '@liendev/core';
import { findDependents, groupDependentsByRepo } from './dependency-analyzer.js';

/**
 * Helper to create a mock async generator that yields a single page of items.
 */
function mockAsyncGenerator<T>(items: T[]): AsyncGenerator<T[]> {
  return (async function*() {
    if (items.length > 0) {
      yield items;
    }
  })();
}

/**
 * Helper to create a mock SearchResult chunk with sensible defaults.
 */
function createChunk(
  file: string,
  overrides: Partial<{
    imports: string[];
    importedSymbols: Record<string, string[]>;
    exports: string[];
    complexity: number;
    callSites: Array<{ symbol: string; line: number }>;
    symbolName: string;
    repoId: string;
    startLine: number;
    endLine: number;
  }> = {}
): SearchResult {
  return {
    content: overrides.callSites
      ? overrides.callSites.map(cs => `  ${cs.symbol}()`).join('\n')
      : 'test content',
    metadata: {
      file,
      startLine: overrides.startLine ?? 1,
      endLine: overrides.endLine ?? 10,
      type: 'function' as const,
      language: 'typescript',
      ...overrides,
    },
    score: 0,
    relevance: 'not_relevant' as const,
  };
}

describe('findDependents', () => {
  let mockDB: {
    scanPaginated: ReturnType<typeof vi.fn>;
    scanCrossRepo: ReturnType<typeof vi.fn>;
  };
  let mockLog: ReturnType<typeof vi.fn<(message: string, level?: 'warning') => void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDB = {
      scanPaginated: vi.fn().mockReturnValue(mockAsyncGenerator([])),
      scanCrossRepo: vi.fn().mockResolvedValue([]),
    };
    mockLog = vi.fn<(message: string, level?: 'warning') => void>();
  });

  describe('direct dependencies via imports array', () => {
    it('should find a file that imports the target via imports array', async () => {
      mockDB.scanPaginated.mockReturnValue(mockAsyncGenerator([
        createChunk('src/consumer.ts', { imports: ['src/target.ts'] }),
        createChunk('src/target.ts', { exports: ['doStuff'] }),
      ]));

      const result = await findDependents(
        mockDB as any,
        'src/target.ts',
        false,
        mockLog
      );

      expect(result.dependents).toHaveLength(1);
      expect(result.dependents[0].filepath).toBe('src/consumer.ts');
    });

    it('should not include the target file itself as a dependent', async () => {
      mockDB.scanPaginated.mockReturnValue(mockAsyncGenerator([
        createChunk('src/target.ts', {
          imports: ['src/other.ts'],
          exports: ['foo'],
        }),
        createChunk('src/consumer.ts', { imports: ['src/target.ts'] }),
      ]));

      const result = await findDependents(
        mockDB as any,
        'src/target.ts',
        false,
        mockLog
      );

      const filepaths = result.dependents.map(d => d.filepath);
      expect(filepaths).not.toContain('src/target.ts');
      expect(filepaths).toContain('src/consumer.ts');
    });
  });

  describe('importedSymbols-based dependencies', () => {
    it('should find a file via importedSymbols keys', async () => {
      mockDB.scanPaginated.mockReturnValue(mockAsyncGenerator([
        createChunk('src/consumer.ts', {
          importedSymbols: { './target': ['Foo', 'Bar'] },
        }),
        createChunk('src/target.ts', { exports: ['Foo', 'Bar'] }),
      ]));

      const result = await findDependents(
        mockDB as any,
        'src/target.ts',
        false,
        mockLog
      );

      expect(result.dependents).toHaveLength(1);
      expect(result.dependents[0].filepath).toBe('src/consumer.ts');
    });
  });

  describe('fuzzy path matching', () => {
    it('should match relative imports like ./utils to src/utils.ts', async () => {
      mockDB.scanPaginated.mockReturnValue(mockAsyncGenerator([
        createChunk('src/consumer.ts', { imports: ['./utils'] }),
        createChunk('src/utils.ts', { exports: ['helper'] }),
      ]));

      const result = await findDependents(
        mockDB as any,
        'src/utils.ts',
        false,
        mockLog
      );

      expect(result.dependents).toHaveLength(1);
      expect(result.dependents[0].filepath).toBe('src/consumer.ts');
    });
  });

  describe('re-export chains / barrel files', () => {
    it('should find transitive dependents through barrel file re-exports', async () => {
      // target.ts exports Foo
      // index.ts imports from target.ts and re-exports Foo
      // consumer.ts imports from index.ts
      mockDB.scanPaginated.mockReturnValue(mockAsyncGenerator([
        createChunk('src/target.ts', { exports: ['Foo'] }),
        createChunk('src/index.ts', {
          imports: ['src/target.ts'],
          importedSymbols: { 'src/target': ['Foo'] },
          exports: ['Foo'],
        }),
        createChunk('src/consumer.ts', {
          imports: ['src/index.ts'],
          importedSymbols: { 'src/index': ['Foo'] },
        }),
      ]));

      const result = await findDependents(
        mockDB as any,
        'src/target.ts',
        false,
        mockLog
      );

      const filepaths = result.dependents.map(d => d.filepath);
      expect(filepaths).toContain('src/index.ts');
      expect(filepaths).toContain('src/consumer.ts');
    });
  });

  describe('symbol-level search', () => {
    it('should only return files that import the specific symbol', async () => {
      mockDB.scanPaginated.mockReturnValue(mockAsyncGenerator([
        createChunk('src/target.ts', { exports: ['Foo', 'Bar'] }),
        createChunk('src/uses-foo.ts', {
          imports: ['src/target.ts'],
          importedSymbols: { 'src/target': ['Foo'] },
          callSites: [{ symbol: 'Foo', line: 5 }],
          symbolName: 'useFoo',
          startLine: 1,
          endLine: 10,
        }),
        createChunk('src/uses-bar.ts', {
          imports: ['src/target.ts'],
          importedSymbols: { 'src/target': ['Bar'] },
          callSites: [{ symbol: 'Bar', line: 8 }],
          symbolName: 'useBar',
          startLine: 1,
          endLine: 10,
        }),
      ]));

      const result = await findDependents(
        mockDB as any,
        'src/target.ts',
        false,
        mockLog,
        'Foo'
      );

      expect(result.dependents).toHaveLength(1);
      expect(result.dependents[0].filepath).toBe('src/uses-foo.ts');
      expect(result.totalUsageCount).toBe(1);
    });

    it('should include call site usages with correct snippet extraction', async () => {
      const chunk = createChunk('src/caller.ts', {
        imports: ['src/target.ts'],
        importedSymbols: { 'src/target': ['doWork'] },
        callSites: [{ symbol: 'doWork', line: 3 }],
        symbolName: 'handleRequest',
        startLine: 1,
        endLine: 5,
      });
      // Override content for snippet extraction: line 3 - startLine 1 = index 2
      chunk.content = 'function handleRequest() {\n  const data = prepare();\n  doWork(data);\n  return data;\n}';

      mockDB.scanPaginated.mockReturnValue(mockAsyncGenerator([
        createChunk('src/target.ts', { exports: ['doWork'] }),
        chunk,
      ]));

      const result = await findDependents(
        mockDB as any,
        'src/target.ts',
        false,
        mockLog,
        'doWork'
      );

      expect(result.dependents).toHaveLength(1);
      expect(result.dependents[0].usages).toHaveLength(1);
      expect(result.dependents[0].usages![0]).toEqual({
        callerSymbol: 'handleRequest',
        line: 3,
        snippet: 'doWork(data);',
      });
    });
  });

  describe('symbol validation warning', () => {
    it('should log a warning when target does not export the symbol', async () => {
      mockDB.scanPaginated.mockReturnValue(mockAsyncGenerator([
        createChunk('src/target.ts', { exports: ['Foo'] }),
        createChunk('src/consumer.ts', {
          imports: ['src/target.ts'],
          importedSymbols: { 'src/target': ['Bar'] },
        }),
      ]));

      const result = await findDependents(
        mockDB as any,
        'src/target.ts',
        false,
        mockLog,
        'Bar'
      );

      // Should log a warning, not throw
      expect(mockLog).toHaveBeenCalledWith(
        expect.stringContaining('Symbol "Bar" not found in exports'),
        'warning'
      );
      // Should still return a result (not crash)
      expect(result).toBeDefined();
    });
  });

  describe('complexity metrics', () => {
    it('should calculate correct file and overall complexity metrics', async () => {
      mockDB.scanPaginated.mockReturnValue(mockAsyncGenerator([
        createChunk('src/target.ts', { exports: ['util'] }),
        createChunk('src/complex-a.ts', {
          imports: ['src/target.ts'],
          complexity: 12,
        }),
        createChunk('src/complex-a.ts', {
          imports: ['src/target.ts'],
          complexity: 8,
          startLine: 20,
          endLine: 30,
        }),
        createChunk('src/simple-b.ts', {
          imports: ['src/target.ts'],
          complexity: 3,
        }),
      ]));

      const result = await findDependents(
        mockDB as any,
        'src/target.ts',
        false,
        mockLog
      );

      // File complexities
      expect(result.fileComplexities).toHaveLength(2);

      const complexA = result.fileComplexities.find(f => f.filepath === 'src/complex-a.ts');
      expect(complexA).toBeDefined();
      expect(complexA!.maxComplexity).toBe(12);
      expect(complexA!.avgComplexity).toBe(10); // (12 + 8) / 2
      expect(complexA!.chunksWithComplexity).toBe(2);

      // Overall metrics
      expect(result.complexityMetrics.filesWithComplexityData).toBe(2);
      expect(result.complexityMetrics.maxComplexity).toBe(12);
    });

    it('should return zero metrics when no chunks have complexity data', async () => {
      mockDB.scanPaginated.mockReturnValue(mockAsyncGenerator([
        createChunk('src/target.ts', { exports: ['util'] }),
        createChunk('src/consumer.ts', { imports: ['src/target.ts'] }),
      ]));

      const result = await findDependents(
        mockDB as any,
        'src/target.ts',
        false,
        mockLog
      );

      expect(result.complexityMetrics.averageComplexity).toBe(0);
      expect(result.complexityMetrics.maxComplexity).toBe(0);
      expect(result.complexityMetrics.filesWithComplexityData).toBe(0);
      expect(result.complexityMetrics.complexityRiskBoost).toBe('low');
    });
  });

  describe('production vs test split', () => {
    it('should correctly identify test files and split counts', async () => {
      mockDB.scanPaginated.mockReturnValue(mockAsyncGenerator([
        createChunk('src/target.ts', { exports: ['util'] }),
        createChunk('src/consumer.ts', { imports: ['src/target.ts'] }),
        createChunk('src/__tests__/consumer.test.ts', { imports: ['src/target.ts'] }),
        createChunk('test/integration.ts', { imports: ['src/target.ts'] }),
      ]));

      const result = await findDependents(
        mockDB as any,
        'src/target.ts',
        false,
        mockLog
      );

      expect(result.productionDependentCount).toBe(1);
      expect(result.testDependentCount).toBe(2);
      expect(result.dependents).toHaveLength(3);
    });
  });

  describe('sort order', () => {
    it('should sort production files before test files', async () => {
      mockDB.scanPaginated.mockReturnValue(mockAsyncGenerator([
        createChunk('src/target.ts', { exports: ['util'] }),
        createChunk('src/__tests__/a.test.ts', { imports: ['src/target.ts'] }),
        createChunk('src/prod-consumer.ts', { imports: ['src/target.ts'] }),
        createChunk('test/b.spec.ts', { imports: ['src/target.ts'] }),
      ]));

      const result = await findDependents(
        mockDB as any,
        'src/target.ts',
        false,
        mockLog
      );

      // Production files come first
      const firstTestIndex = result.dependents.findIndex(d => d.isTestFile);
      const lastProdIndex = result.dependents.reduce(
        (last, d, i) => (d.isTestFile ? last : i),
        -1
      );

      if (firstTestIndex !== -1 && lastProdIndex !== -1) {
        expect(lastProdIndex).toBeLessThan(firstTestIndex);
      }
    });
  });

  describe('hitLimit', () => {
    it('should set hitLimit to false for single-repo paginated scanning', async () => {
      mockDB.scanPaginated.mockReturnValue(mockAsyncGenerator([
        createChunk('src/target.ts', { exports: ['foo'] }),
        createChunk('src/consumer.ts', { imports: ['src/target.ts'] }),
      ]));

      const result = await findDependents(
        mockDB as any,
        'src/target.ts',
        false,
        mockLog
      );

      expect(result.hitLimit).toBe(false);
    });
  });

  describe('no dependents', () => {
    it('should return empty dependents with low-risk metrics when nothing imports target', async () => {
      mockDB.scanPaginated.mockReturnValue(mockAsyncGenerator([
        createChunk('src/target.ts', { exports: ['foo'] }),
        createChunk('src/unrelated.ts', { imports: ['src/other.ts'] }),
      ]));

      const result = await findDependents(
        mockDB as any,
        'src/target.ts',
        false,
        mockLog
      );

      expect(result.dependents).toHaveLength(0);
      expect(result.productionDependentCount).toBe(0);
      expect(result.testDependentCount).toBe(0);
      expect(result.complexityMetrics.complexityRiskBoost).toBe('low');
    });
  });

  describe('circular dependency chains', () => {
    it('should handle A -> B -> A without infinite loops', async () => {
      mockDB.scanPaginated.mockReturnValue(mockAsyncGenerator([
        createChunk('src/a.ts', {
          imports: ['src/b.ts'],
          exports: ['fnA'],
        }),
        createChunk('src/b.ts', {
          imports: ['src/a.ts'],
          exports: ['fnB'],
        }),
      ]));

      const result = await findDependents(
        mockDB as any,
        'src/a.ts',
        false,
        mockLog
      );

      // B imports A, so B is a dependent of A
      expect(result.dependents).toHaveLength(1);
      expect(result.dependents[0].filepath).toBe('src/b.ts');
    });
  });

  describe('files with no imports or exports', () => {
    it('should ignore chunks with no imports and no exports', async () => {
      mockDB.scanPaginated.mockReturnValue(mockAsyncGenerator([
        createChunk('src/target.ts', { exports: ['foo'] }),
        createChunk('src/standalone.ts'), // no imports, no exports
        createChunk('src/consumer.ts', { imports: ['src/target.ts'] }),
      ]));

      const result = await findDependents(
        mockDB as any,
        'src/target.ts',
        false,
        mockLog
      );

      expect(result.dependents).toHaveLength(1);
      expect(result.dependents[0].filepath).toBe('src/consumer.ts');
    });
  });

  describe('cross-repo with QdrantDB', () => {
    it('should call scanCrossRepo when vectorDB is QdrantDB and crossRepo=true', async () => {
      const mockQdrantDB: any = {
        scanPaginated: vi.fn().mockReturnValue(mockAsyncGenerator([])),
        scanCrossRepo: vi.fn().mockResolvedValue([]),
      };
      Object.setPrototypeOf(mockQdrantDB, QdrantDB.prototype);

      await findDependents(
        mockQdrantDB,
        'src/target.ts',
        true,
        mockLog
      );

      expect(mockQdrantDB.scanCrossRepo).toHaveBeenCalledWith({ limit: 100000 });
      expect(mockQdrantDB.scanPaginated).not.toHaveBeenCalled();
    });
  });

  describe('cross-repo fallback for non-QdrantDB', () => {
    it('should log warning and use scanPaginated when vectorDB is not QdrantDB', async () => {
      await findDependents(
        mockDB as any,
        'src/target.ts',
        true,
        mockLog
      );

      expect(mockLog).toHaveBeenCalledWith(
        expect.stringContaining('crossRepo=true requires Qdrant backend'),
        'warning'
      );
      expect(mockDB.scanPaginated).toHaveBeenCalled();
      expect(mockDB.scanCrossRepo).not.toHaveBeenCalled();
    });
  });
});

describe('groupDependentsByRepo', () => {
  it('should group dependents by repoId from chunk metadata', () => {
    const dependents = [
      { filepath: 'repo-a/src/a.ts', isTestFile: false },
      { filepath: 'repo-b/src/b.ts', isTestFile: false },
      { filepath: 'repo-a/src/c.ts', isTestFile: true },
    ];

    const chunks: SearchResult[] = [
      createChunk('repo-a/src/a.ts', { repoId: 'repo-a' }),
      createChunk('repo-b/src/b.ts', { repoId: 'repo-b' }),
      createChunk('repo-a/src/c.ts', { repoId: 'repo-a' }),
    ];

    const result = groupDependentsByRepo(dependents, chunks);

    expect(Object.keys(result)).toHaveLength(2);
    expect(result['repo-a']).toHaveLength(2);
    expect(result['repo-b']).toHaveLength(1);
    expect(result['repo-a'].map(d => d.filepath)).toEqual([
      'repo-a/src/a.ts',
      'repo-a/src/c.ts',
    ]);
  });

  it('should fall back to "unknown" when chunk has no repoId', () => {
    const dependents = [
      { filepath: 'src/a.ts', isTestFile: false },
    ];

    const chunks: SearchResult[] = [
      createChunk('src/a.ts'), // no repoId
    ];

    const result = groupDependentsByRepo(dependents, chunks);

    expect(result['unknown']).toHaveLength(1);
    expect(result['unknown'][0].filepath).toBe('src/a.ts');
  });

  it('should return empty object when no dependents are provided', () => {
    const result = groupDependentsByRepo([], []);
    expect(result).toEqual({});
  });

  it('should handle multiple repos with mixed dependents', () => {
    const dependents = [
      { filepath: 'a/src/x.ts', isTestFile: false },
      { filepath: 'b/src/y.ts', isTestFile: false },
      { filepath: 'c/src/z.ts', isTestFile: true },
      { filepath: 'a/src/w.ts', isTestFile: false },
    ];

    const chunks: SearchResult[] = [
      createChunk('a/src/x.ts', { repoId: 'alpha' }),
      createChunk('b/src/y.ts', { repoId: 'beta' }),
      createChunk('c/src/z.ts', { repoId: 'gamma' }),
      createChunk('a/src/w.ts', { repoId: 'alpha' }),
    ];

    const result = groupDependentsByRepo(dependents, chunks);

    expect(Object.keys(result).sort()).toEqual(['alpha', 'beta', 'gamma']);
    expect(result['alpha']).toHaveLength(2);
    expect(result['beta']).toHaveLength(1);
    expect(result['gamma']).toHaveLength(1);
    expect(result['gamma'][0].isTestFile).toBe(true);
  });

  it('should assign "unknown" when dependent filepath has no matching chunk', () => {
    const dependents = [
      { filepath: 'src/orphan.ts', isTestFile: false },
    ];

    // Chunks do not include orphan.ts
    const chunks: SearchResult[] = [
      createChunk('src/other.ts', { repoId: 'repo-a' }),
    ];

    const result = groupDependentsByRepo(dependents, chunks);

    expect(result['unknown']).toHaveLength(1);
    expect(result['unknown'][0].filepath).toBe('src/orphan.ts');
  });
});
