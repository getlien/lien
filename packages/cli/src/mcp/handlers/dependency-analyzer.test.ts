import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SearchResult } from '@liendev/core';
import { findDependents, clearDependencyCache } from './dependency-analyzer.js';

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
    startLine: number;
    endLine: number;
  }> = {},
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
    scanAll: ReturnType<typeof vi.fn>;
  };
  let mockLog: ReturnType<typeof vi.fn<(message: string, level?: 'warning') => void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    clearDependencyCache();
    mockDB = {
      scanAll: vi.fn().mockResolvedValue([]),
    };
    mockLog = vi.fn<(message: string, level?: 'warning') => void>();
  });

  describe('direct dependencies via imports array', () => {
    it('should find a file that imports the target via imports array', async () => {
      mockDB.scanAll.mockResolvedValue([
        createChunk('src/consumer.ts', { imports: ['src/target.ts'] }),
        createChunk('src/target.ts', { exports: ['doStuff'] }),
      ]);

      const result = await findDependents(mockDB as any, 'src/target.ts', mockLog);

      expect(result.dependents).toHaveLength(1);
      expect(result.dependents[0].filepath).toBe('src/consumer.ts');
    });

    it('should not include the target file itself as a dependent', async () => {
      mockDB.scanAll.mockResolvedValue([
        createChunk('src/target.ts', {
          imports: ['src/other.ts'],
          exports: ['foo'],
        }),
        createChunk('src/consumer.ts', { imports: ['src/target.ts'] }),
      ]);

      const result = await findDependents(mockDB as any, 'src/target.ts', mockLog);

      const filepaths = result.dependents.map(d => d.filepath);
      expect(filepaths).not.toContain('src/target.ts');
      expect(filepaths).toContain('src/consumer.ts');
    });
  });

  describe('importedSymbols-based dependencies', () => {
    it('should find a file via importedSymbols keys', async () => {
      mockDB.scanAll.mockResolvedValue([
        createChunk('src/consumer.ts', {
          importedSymbols: { './target': ['Foo', 'Bar'] },
        }),
        createChunk('src/target.ts', { exports: ['Foo', 'Bar'] }),
      ]);

      const result = await findDependents(mockDB as any, 'src/target.ts', mockLog);

      expect(result.dependents).toHaveLength(1);
      expect(result.dependents[0].filepath).toBe('src/consumer.ts');
    });
  });

  describe('fuzzy path matching', () => {
    it('should match relative imports like ./utils to src/utils.ts', async () => {
      mockDB.scanAll.mockResolvedValue([
        createChunk('src/consumer.ts', { imports: ['./utils'] }),
        createChunk('src/utils.ts', { exports: ['helper'] }),
      ]);

      const result = await findDependents(mockDB as any, 'src/utils.ts', mockLog);

      expect(result.dependents).toHaveLength(1);
      expect(result.dependents[0].filepath).toBe('src/consumer.ts');
    });
  });

  describe('#887 language-aware directory-vs-file matching', () => {
    it('Ruby: a bare multi-segment require does not credit a sibling file under the same directory', async () => {
      // rack-protection/lib/rack/protection/base.rb bare-requires
      // 'rack/protection' -- that must resolve to the umbrella
      // rack-protection/lib/rack/protection.rb, not to an unrelated sibling
      // module that merely shares the directory (#887).
      mockDB.scanAll.mockResolvedValue([
        createChunk('rack-protection/lib/rack/protection/base.rb', {
          imports: ['rack/protection'],
        }),
      ]);

      const result = await findDependents(
        mockDB as any,
        'rack-protection/lib/rack/protection/xss_header.rb',
        mockLog,
      );

      expect(result.dependents.map(d => d.filepath)).not.toContain(
        'rack-protection/lib/rack/protection/base.rb',
      );
    });

    it('Ruby: the umbrella entry point itself is still a legitimate match', async () => {
      mockDB.scanAll.mockResolvedValue([
        createChunk('rack-protection/lib/rack/protection/base.rb', {
          imports: ['rack/protection'],
        }),
      ]);

      const result = await findDependents(
        mockDB as any,
        'rack-protection/lib/rack/protection.rb',
        mockLog,
      );

      expect(result.dependents.map(d => d.filepath)).toContain(
        'rack-protection/lib/rack/protection/base.rb',
      );
    });

    it('Go: a package-directory import still credits every file in the directory as a dependent (the caught regression)', async () => {
      // #877 normalizes `import "mymodule/internal/fs"` down to the bare
      // `internal/fs`. In Go that names a PACKAGE, so every .go file inside
      // the directory (e.g. fs.go) is a legitimate dependent -- an earlier
      // revision of the #887 fix broke this (67 -> 9 dependent edges on a
      // real gin clone) by applying Ruby's stricter anchor unconditionally.
      mockDB.scanAll.mockResolvedValue([
        createChunk('render/html.go', { imports: ['internal/fs'] }),
      ]);

      const result = await findDependents(mockDB as any, 'internal/fs/fs.go', mockLog);

      expect(result.dependents.map(d => d.filepath)).toContain('render/html.go');
    });

    it('applies the language check per chunk, not once per shared import key', async () => {
      // Two chunks share the identical normalized import key ('pkg/sub'):
      // one Go, one Ruby. The fuzzy-match loop iterates the index by key, so
      // it must not decide "match or no match" once per key -- the Go chunk
      // is a real dependent, the Ruby chunk is not.
      mockDB.scanAll.mockResolvedValue([
        createChunk('render/html.go', { imports: ['pkg/sub'] }),
        createChunk('lib/pkg/consumer.rb', { imports: ['pkg/sub'] }),
      ]);

      const result = await findDependents(mockDB as any, 'pkg/sub/child.go', mockLog);
      const filepaths = result.dependents.map(d => d.filepath);

      expect(filepaths).toContain('render/html.go');
      expect(filepaths).not.toContain('lib/pkg/consumer.rb');
    });
  });

  describe('re-export chains / barrel files', () => {
    it('should find transitive dependents through barrel file re-exports', async () => {
      // target.ts exports Foo
      // index.ts imports from target.ts and re-exports Foo
      // consumer.ts imports from index.ts
      mockDB.scanAll.mockResolvedValue([
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
      ]);

      const result = await findDependents(mockDB as any, 'src/target.ts', mockLog);

      const filepaths = result.dependents.map(d => d.filepath);
      expect(filepaths).toContain('src/index.ts');
      expect(filepaths).toContain('src/consumer.ts');
    });
  });

  describe('symbol-level search', () => {
    it('should only return files that import the specific symbol', async () => {
      mockDB.scanAll.mockResolvedValue([
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
      ]);

      const result = await findDependents(mockDB as any, 'src/target.ts', mockLog, 'Foo');

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
      chunk.content =
        'function handleRequest() {\n  const data = prepare();\n  doWork(data);\n  return data;\n}';

      mockDB.scanAll.mockResolvedValue([
        createChunk('src/target.ts', { exports: ['doWork'] }),
        chunk,
      ]);

      const result = await findDependents(mockDB as any, 'src/target.ts', mockLog, 'doWork');

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
      mockDB.scanAll.mockResolvedValue([
        createChunk('src/target.ts', { exports: ['Foo'] }),
        createChunk('src/consumer.ts', {
          imports: ['src/target.ts'],
          importedSymbols: { 'src/target': ['Bar'] },
        }),
      ]);

      const result = await findDependents(mockDB as any, 'src/target.ts', mockLog, 'Bar');

      // Should log a warning, not throw
      expect(mockLog).toHaveBeenCalledWith(
        expect.stringContaining('Symbol "Bar" not found in exports'),
        'warning',
      );
      // Should still return a result (not crash)
      expect(result).toBeDefined();
    });
  });

  describe('qualified-access fallback (methods, constructors, package-level functions)', () => {
    it('Go-style: a package-qualified function call is attributed via callSites even though importedSymbols only records the package alias', async () => {
      // Go's `import "internal/bytesconv"` records the package alias
      // ("bytesconv") in importedSymbols, never the individual function
      // called through it -- the real evidence lives in callSites instead.
      mockDB.scanAll.mockResolvedValue([
        createChunk('internal/bytesconv/bytesconv.go', { exports: ['StringToBytes'] }),
        createChunk('auth.go', {
          imports: ['internal/bytesconv'],
          importedSymbols: { 'internal/bytesconv': ['bytesconv'] },
          callSites: [{ symbol: 'StringToBytes', line: 37 }],
          symbolName: 'basicAuth',
        }),
      ]);

      const result = await findDependents(
        mockDB as any,
        'internal/bytesconv/bytesconv.go',
        mockLog,
        'StringToBytes',
      );

      expect(result.dependents).toHaveLength(1);
      expect(result.dependents[0].filepath).toBe('auth.go');
      expect(result.totalUsageCount).toBe(1);
      expect(result.symbolAttributionDegraded).toBeUndefined();
    });

    it('does not attribute a same-named call site from a file that imports a different package', async () => {
      mockDB.scanAll.mockResolvedValue([
        createChunk('internal/bytesconv/bytesconv.go', { exports: ['StringToBytes'] }),
        createChunk('unrelated.go', {
          imports: ['internal/other'],
          importedSymbols: { 'internal/other': ['other'] },
          callSites: [{ symbol: 'StringToBytes', line: 5 }],
        }),
      ]);

      const result = await findDependents(
        mockDB as any,
        'internal/bytesconv/bytesconv.go',
        mockLog,
        'StringToBytes',
      );

      expect(result.dependents).toHaveLength(0);
    });

    it('PHP-style: a method call is attributed via callSites even though importedSymbols only records the class name', async () => {
      // `use ...\\Cursor;` records the class name in importedSymbols, never
      // the method invoked on an instance of it.
      mockDB.scanAll.mockResolvedValue([
        createChunk('Cursor.php', { exports: ['Cursor'] }),
        createChunk('QuestionHelper.php', {
          imports: ['Cursor'],
          importedSymbols: { Cursor: ['Cursor'] },
          callSites: [{ symbol: 'moveUp', line: 265 }],
          symbolName: 'someMethod',
        }),
      ]);

      const result = await findDependents(mockDB as any, 'Cursor.php', mockLog, 'moveUp');

      expect(result.dependents).toHaveLength(1);
      expect(result.dependents[0].filepath).toBe('QuestionHelper.php');
      expect(result.totalUsageCount).toBe(1);
    });

    it('degrades to file-level dependents when the symbol is not a top-level export and no call site confirms usage (constructor shape)', async () => {
      // PHP's `new Cursor(...)` isn't tracked as a call site at all (the
      // parser gap), and `__construct` is never a top-level PHP export --
      // the structural signature of an unresolvable symbol query. Reporting
      // the symbol-scoped zero here would read as "no callers, safe to
      // change" even though QuestionHelper.php genuinely imports Cursor.php.
      mockDB.scanAll.mockResolvedValue([
        createChunk('Cursor.php', { exports: ['Cursor'] }),
        createChunk('QuestionHelper.php', {
          imports: ['Cursor'],
          importedSymbols: { Cursor: ['Cursor'] },
        }),
      ]);

      const result = await findDependents(mockDB as any, 'Cursor.php', mockLog, '__construct');

      expect(result.symbolAttributionDegraded).toBe(true);
      expect(result.dependents).toHaveLength(1);
      expect(result.dependents[0].filepath).toBe('QuestionHelper.php');
      expect(result.totalUsageCount).toBeUndefined();
      expect(mockLog).toHaveBeenCalledWith(
        expect.stringContaining("isn't a top-level export"),
        'warning',
      );
    });

    it('does not degrade (stays a real empty result) when there are no file-level dependents at all', async () => {
      // The structural gap distinct from the one above (see #869): a
      // whole-module-import language can have zero import edges into a
      // file at all, so there is no file-level answer to widen to either.
      // Must not fabricate dependents where none can be found.
      mockDB.scanAll.mockResolvedValue([createChunk('Session.swift', { exports: ['Session'] })]);

      const result = await findDependents(mockDB as any, 'Session.swift', mockLog, 'validate');

      expect(result.symbolAttributionDegraded).toBeUndefined();
      expect(result.dependents).toHaveLength(0);
    });

    it('does not degrade when the symbol IS a top-level export with zero real usages (true negative)', async () => {
      mockDB.scanAll.mockResolvedValue([
        createChunk('src/target.ts', { exports: ['Foo', 'Bar'] }),
        createChunk('src/unrelated.ts', {
          imports: ['src/target.ts'],
          importedSymbols: { 'src/target': ['Bar'] },
        }),
      ]);

      const result = await findDependents(mockDB as any, 'src/target.ts', mockLog, 'Foo');

      expect(result.dependents).toHaveLength(0);
      expect(result.symbolAttributionDegraded).toBeUndefined();
    });
  });

  describe('complexity metrics', () => {
    it('should calculate correct file and overall complexity metrics', async () => {
      mockDB.scanAll.mockResolvedValue([
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
      ]);

      const result = await findDependents(mockDB as any, 'src/target.ts', mockLog);

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
      mockDB.scanAll.mockResolvedValue([
        createChunk('src/target.ts', { exports: ['util'] }),
        createChunk('src/consumer.ts', { imports: ['src/target.ts'] }),
      ]);

      const result = await findDependents(mockDB as any, 'src/target.ts', mockLog);

      expect(result.complexityMetrics.averageComplexity).toBe(0);
      expect(result.complexityMetrics.maxComplexity).toBe(0);
      expect(result.complexityMetrics.filesWithComplexityData).toBe(0);
      expect(result.complexityMetrics.complexityRiskBoost).toBe('low');
    });

    // Regression: a file can import the target file (landing in the
    // pre-symbol-filter candidate set) without importing the requested
    // symbol, so `buildDependentsList` correctly drops it from `dependents`.
    // Complexity metrics used to be computed from that wider candidate set
    // instead of the resolved `dependents`, so an unrelated high-complexity
    // file could inflate `complexityMetrics`/`complexityRiskBoost` even when
    // zero dependents were returned.
    it('should return neutral complexity metrics when the symbol filter leaves zero dependents', async () => {
      mockDB.scanAll.mockResolvedValue([
        createChunk('src/target.ts', { exports: ['Foo', 'Bar'] }),
        createChunk('src/unrelated.ts', {
          imports: ['src/target.ts'],
          importedSymbols: { 'src/target': ['Bar'] }, // does not import 'Foo'
          complexity: 17,
        }),
      ]);

      const result = await findDependents(mockDB as any, 'src/target.ts', mockLog, 'Foo');

      expect(result.dependents).toHaveLength(0);
      expect(result.fileComplexities).toHaveLength(0);
      expect(result.complexityMetrics).toEqual({
        averageComplexity: 0,
        maxComplexity: 0,
        filesWithComplexityData: 0,
        highComplexityDependents: [],
        complexityRiskBoost: 'low',
      });
    });

    // Regression: when some (but not all) files pass the symbol filter,
    // complexity metrics must be restricted to exactly those files — not the
    // wider import-graph candidate set that also matched the target file.
    it('should restrict complexity metrics to exactly the resolved symbol dependents', async () => {
      mockDB.scanAll.mockResolvedValue([
        createChunk('src/target.ts', { exports: ['Foo', 'Bar'] }),
        createChunk('src/uses-foo.ts', {
          imports: ['src/target.ts'],
          importedSymbols: { 'src/target': ['Foo'] },
          complexity: 4,
        }),
        createChunk('src/uses-bar.ts', {
          imports: ['src/target.ts'],
          importedSymbols: { 'src/target': ['Bar'] }, // does not import 'Foo'
          complexity: 20, // high complexity, but must not leak into the result
        }),
      ]);

      const result = await findDependents(mockDB as any, 'src/target.ts', mockLog, 'Foo');

      expect(result.dependents).toHaveLength(1);
      expect(result.dependents[0].filepath).toBe('src/uses-foo.ts');

      expect(result.fileComplexities).toHaveLength(1);
      expect(result.fileComplexities[0].filepath).toBe('src/uses-foo.ts');

      expect(result.complexityMetrics.filesWithComplexityData).toBe(1);
      expect(result.complexityMetrics.maxComplexity).toBe(4);
      expect(result.complexityMetrics.highComplexityDependents).toHaveLength(0);
    });
  });

  describe('production vs test split', () => {
    it('should correctly identify test files and split counts', async () => {
      mockDB.scanAll.mockResolvedValue([
        createChunk('src/target.ts', { exports: ['util'] }),
        createChunk('src/consumer.ts', { imports: ['src/target.ts'] }),
        createChunk('src/__tests__/consumer.test.ts', { imports: ['src/target.ts'] }),
        createChunk('test/integration.ts', { imports: ['src/target.ts'] }),
      ]);

      const result = await findDependents(mockDB as any, 'src/target.ts', mockLog);

      expect(result.productionDependentCount).toBe(1);
      expect(result.testDependentCount).toBe(2);
      expect(result.dependents).toHaveLength(3);
    });
  });

  describe('sort order', () => {
    it('should sort production files before test files', async () => {
      mockDB.scanAll.mockResolvedValue([
        createChunk('src/target.ts', { exports: ['util'] }),
        createChunk('src/__tests__/a.test.ts', { imports: ['src/target.ts'] }),
        createChunk('src/prod-consumer.ts', { imports: ['src/target.ts'] }),
        createChunk('test/b.spec.ts', { imports: ['src/target.ts'] }),
      ]);

      const result = await findDependents(mockDB as any, 'src/target.ts', mockLog);

      // Production files come first
      const firstTestIndex = result.dependents.findIndex(d => d.isTestFile);
      const lastProdIndex = result.dependents.reduce((last, d, i) => (d.isTestFile ? last : i), -1);

      if (firstTestIndex !== -1 && lastProdIndex !== -1) {
        expect(lastProdIndex).toBeLessThan(firstTestIndex);
      }
    });
  });

  describe('hitLimit', () => {
    it('should set hitLimit to false for single-repo paginated scanning', async () => {
      mockDB.scanAll.mockResolvedValue([
        createChunk('src/target.ts', { exports: ['foo'] }),
        createChunk('src/consumer.ts', { imports: ['src/target.ts'] }),
      ]);

      const result = await findDependents(mockDB as any, 'src/target.ts', mockLog);

      expect(result.hitLimit).toBe(false);
    });
  });

  describe('no dependents', () => {
    it('should return empty dependents with low-risk metrics when nothing imports target', async () => {
      mockDB.scanAll.mockResolvedValue([
        createChunk('src/target.ts', { exports: ['foo'] }),
        createChunk('src/unrelated.ts', { imports: ['src/other.ts'] }),
      ]);

      const result = await findDependents(mockDB as any, 'src/target.ts', mockLog);

      expect(result.dependents).toHaveLength(0);
      expect(result.productionDependentCount).toBe(0);
      expect(result.testDependentCount).toBe(0);
      expect(result.complexityMetrics.complexityRiskBoost).toBe('low');
    });
  });

  describe('circular dependency chains', () => {
    it('should handle A -> B -> A without infinite loops', async () => {
      mockDB.scanAll.mockResolvedValue([
        createChunk('src/a.ts', {
          imports: ['src/b.ts'],
          exports: ['fnA'],
        }),
        createChunk('src/b.ts', {
          imports: ['src/a.ts'],
          exports: ['fnB'],
        }),
      ]);

      const result = await findDependents(mockDB as any, 'src/a.ts', mockLog);

      // B imports A, so B is a dependent of A
      expect(result.dependents).toHaveLength(1);
      expect(result.dependents[0].filepath).toBe('src/b.ts');
    });

    it('should not revisit the target when BFS loops back at depth 2', async () => {
      // A <- B, B <- A cycle (via importedSymbols so B isn't flagged as a re-exporter).
      // From A, depth 1 finds B; depth 2 would revisit A via B's importer list —
      // the walk must exclude the original target.
      mockDB.scanAll.mockResolvedValue([
        createChunk('src/a.ts', {
          importedSymbols: { 'src/b': ['fnB'] },
          exports: ['fnA'],
        }),
        createChunk('src/b.ts', {
          importedSymbols: { 'src/a': ['fnA'] },
          exports: ['fnB'],
        }),
      ]);

      const result = await findDependents(
        mockDB as any,
        'src/a.ts',
        mockLog,
        undefined,
        undefined,
        3,
      );

      expect(result.dependents.map(d => d.filepath)).toEqual(['src/b.ts']);
      expect(result.dependents[0].hops).toBe(1);
    });
  });

  describe('cross-package basename collisions (#525)', () => {
    // Pre-fix, two files with the same basename in different packages would
    // collide because relative specifiers were stored as bare basenames.
    // With index-time resolution, importIndex keys are workspace-relative,
    // and the collision no longer happens.
    it('should not treat a same-basename file in another package as a dependent', async () => {
      // Simulate what the indexer now stores: resolved workspace-relative
      // paths in importedSymbols keys.
      mockDB.scanAll.mockResolvedValue([
        // The query target — no dependents in this test setup.
        createChunk('packages/cli/src/mcp/handlers/dependency-analyzer.ts', {
          exports: ['findDependents'],
        }),
        // A different file with the SAME basename in a different package.
        createChunk('packages/parser/src/dependency-analyzer.ts', {
          exports: ['chunkImportsFrom'],
        }),
        // Parser-side consumer imports the PARSER's dependency-analyzer.
        // Its importedSymbols key is now a resolved workspace-relative path.
        createChunk('packages/parser/src/ast/chunker.ts', {
          importedSymbols: { 'packages/parser/src/dependency-analyzer': ['chunkImportsFrom'] },
        }),
      ]);

      const result = await findDependents(
        mockDB as any,
        'packages/cli/src/mcp/handlers/dependency-analyzer.ts',
        mockLog,
      );

      // The parser-side consumer must NOT appear as a dependent of the CLI file.
      expect(result.dependents.map(d => d.filepath)).not.toContain(
        'packages/parser/src/ast/chunker.ts',
      );
    });
  });

  describe('re-export walk: named-import requirement (#526)', () => {
    // Pre-fix, a file that raw-imported the target AND exported anything at
    // all was flagged as a re-exporter of everything the target exported.
    // Then chains through that false re-exporter polluted depth-1 results.
    it('should not treat "imports target + exports unrelated" as a re-exporter', async () => {
      mockDB.scanAll.mockResolvedValue([
        // a.ts — the target
        createChunk('src/a.ts', { exports: ['fnA'] }),
        // b.ts — imports fnA from a, exports fnB (NOT a re-export of fnA)
        createChunk('src/b.ts', {
          imports: ['src/a.ts'],
          importedSymbols: { 'src/a': ['fnA'] },
          exports: ['fnB'],
        }),
        // c.ts — imports fnB from b. Must NOT be a transitive dependent of a.
        createChunk('src/c.ts', {
          imports: ['src/b.ts'],
          importedSymbols: { 'src/b': ['fnB'] },
        }),
      ]);

      const result = await findDependents(mockDB as any, 'src/a.ts', mockLog);

      const filepaths = result.dependents.map(d => d.filepath);
      // b is a direct dependent of a — correct.
      expect(filepaths).toContain('src/b.ts');
      // c only imports b, not a. Must not be pulled in via the re-export walk.
      expect(filepaths).not.toContain('src/c.ts');
    });
  });

  describe('BFS over depth', () => {
    // Post-#526, chunks with raw `imports` no longer trip a '*' wildcard
    // re-export sentinel — importedSymbols is the authoritative signal.

    it('should stay at depth 1 by default (backwards compatible)', async () => {
      mockDB.scanAll.mockResolvedValue([
        createChunk('src/a.ts', { exports: ['fnA'] }),
        createChunk('src/b.ts', {
          importedSymbols: { 'src/a': ['fnA'] },
          exports: ['fnB'],
        }),
        createChunk('src/c.ts', {
          importedSymbols: { 'src/b': ['fnB'] },
        }),
      ]);

      const result = await findDependents(mockDB as any, 'src/a.ts', mockLog);

      expect(result.dependents.map(d => d.filepath)).toEqual(['src/b.ts']);
      expect(result.dependents[0].hops).toBe(1);
      expect(result.truncated).toBe(false);
    });

    it('should discover depth-2 dependents and tag them with hops=2', async () => {
      mockDB.scanAll.mockResolvedValue([
        createChunk('src/a.ts', { exports: ['fnA'] }),
        createChunk('src/b.ts', {
          importedSymbols: { 'src/a': ['fnA'] },
          exports: ['fnB'],
        }),
        createChunk('src/c.ts', {
          importedSymbols: { 'src/b': ['fnB'] },
        }),
      ]);

      const result = await findDependents(
        mockDB as any,
        'src/a.ts',
        mockLog,
        undefined,
        undefined,
        2,
      );

      const byFile = new Map(result.dependents.map(d => [d.filepath, d.hops]));
      expect(byFile.get('src/b.ts')).toBe(1);
      expect(byFile.get('src/c.ts')).toBe(2);
      expect(result.dependents).toHaveLength(2);
    });

    it('should discover depth-3 dependents', async () => {
      mockDB.scanAll.mockResolvedValue([
        createChunk('src/a.ts', { exports: ['fnA'] }),
        createChunk('src/b.ts', {
          importedSymbols: { 'src/a': ['fnA'] },
          exports: ['fnB'],
        }),
        createChunk('src/c.ts', {
          importedSymbols: { 'src/b': ['fnB'] },
          exports: ['fnC'],
        }),
        createChunk('src/d.ts', {
          importedSymbols: { 'src/c': ['fnC'] },
        }),
      ]);

      const result = await findDependents(
        mockDB as any,
        'src/a.ts',
        mockLog,
        undefined,
        undefined,
        3,
      );

      const byFile = new Map(result.dependents.map(d => [d.filepath, d.hops]));
      expect(byFile.get('src/b.ts')).toBe(1);
      expect(byFile.get('src/c.ts')).toBe(2);
      expect(byFile.get('src/d.ts')).toBe(3);
    });

    it('should record the minimum hop for diamond-shaped graphs', async () => {
      // A <- B (hop 1), A <- C (hop 1), D imports both B and C (hop 2 via either).
      mockDB.scanAll.mockResolvedValue([
        createChunk('src/a.ts', { exports: ['fnA'] }),
        createChunk('src/b.ts', {
          importedSymbols: { 'src/a': ['fnA'] },
          exports: ['fnB'],
        }),
        createChunk('src/c.ts', {
          importedSymbols: { 'src/a': ['fnA'] },
          exports: ['fnC'],
        }),
        createChunk('src/d.ts', {
          importedSymbols: { 'src/b': ['fnB'], 'src/c': ['fnC'] },
        }),
      ]);

      const result = await findDependents(
        mockDB as any,
        'src/a.ts',
        mockLog,
        undefined,
        undefined,
        2,
      );

      const byFile = new Map(result.dependents.map(d => [d.filepath, d.hops]));
      expect(byFile.get('src/d.ts')).toBe(2);
    });

    it('should truncate when maxNodes is hit and set truncated=true', async () => {
      mockDB.scanAll.mockResolvedValue([
        createChunk('src/a.ts', { exports: ['fnA'] }),
        createChunk('src/b.ts', {
          importedSymbols: { 'src/a': ['fnA'] },
          exports: ['fnB'],
        }),
        createChunk('src/c.ts', {
          importedSymbols: { 'src/b': ['fnB'] },
          exports: ['fnC'],
        }),
        createChunk('src/d.ts', {
          importedSymbols: { 'src/c': ['fnC'] },
        }),
      ]);

      const result = await findDependents(
        mockDB as any,
        'src/a.ts',
        mockLog,
        undefined,
        undefined,
        3,
        1,
      );

      expect(result.dependents).toHaveLength(1);
      expect(result.truncated).toBe(true);
    });

    it('should ignore depth > 1 for symbol-level queries', async () => {
      mockDB.scanAll.mockResolvedValue([
        createChunk('src/a.ts', { exports: ['fnA'] }),
        createChunk('src/b.ts', {
          importedSymbols: { 'src/a': ['fnA'] },
          exports: ['fnB'],
        }),
        createChunk('src/c.ts', {
          importedSymbols: { 'src/b': ['fnB'] },
        }),
      ]);

      const result = await findDependents(mockDB as any, 'src/a.ts', mockLog, 'fnA', undefined, 3);

      // At depth 1 for symbol fnA, only src/b.ts imports the symbol directly.
      expect(result.dependents.map(d => d.filepath)).toEqual(['src/b.ts']);
      // And the caller is warned that depth > 1 was ignored.
      expect(mockLog).toHaveBeenCalledWith(
        expect.stringContaining('depth > 1 is ignored for symbol-level queries'),
      );
    });
  });

  describe('uncovered production dependents', () => {
    it('should count production dependents with no importing test file', async () => {
      mockDB.scanAll.mockResolvedValue([
        createChunk('src/target.ts', { exports: ['util'] }),
        createChunk('src/covered.ts', { imports: ['src/target.ts'], exports: ['foo'] }),
        createChunk('src/covered.test.ts', { imports: ['src/covered.ts'] }),
        createChunk('src/uncovered.ts', { imports: ['src/target.ts'] }),
      ]);

      const result = await findDependents(mockDB as any, 'src/target.ts', mockLog);

      expect(result.productionDependentCount).toBe(2);
      expect(result.uncoveredProductionDependents).toBe(1);
    });

    it('should treat production dependents as covered if any test file imports them', async () => {
      mockDB.scanAll.mockResolvedValue([
        createChunk('src/target.ts', { exports: ['util'] }),
        createChunk('src/a.ts', { imports: ['src/target.ts'], exports: ['a'] }),
        createChunk('src/a.test.ts', { imports: ['src/a.ts'] }),
      ]);

      const result = await findDependents(mockDB as any, 'src/target.ts', mockLog);

      expect(result.productionDependentCount).toBe(1);
      expect(result.uncoveredProductionDependents).toBe(0);
    });
  });

  describe('files with no imports or exports', () => {
    it('should ignore chunks with no imports and no exports', async () => {
      mockDB.scanAll.mockResolvedValue([
        createChunk('src/target.ts', { exports: ['foo'] }),
        createChunk('src/standalone.ts'), // no imports, no exports
        createChunk('src/consumer.ts', { imports: ['src/target.ts'] }),
      ]);

      const result = await findDependents(mockDB as any, 'src/target.ts', mockLog);

      expect(result.dependents).toHaveLength(1);
      expect(result.dependents[0].filepath).toBe('src/consumer.ts');
    });
  });

  describe('whole-module-import basename hub (#884)', () => {
    // The Alamofire shape: Source/Alamofire.swift's basename coincidentally
    // equals the module name every test file bare-imports (`import
    // Alamofire`, whole-module). Before #884 this fell inside #868/#883's
    // deliberate one-leading-segment leniency (the same window that
    // legitimately allows Rust's `auth` -> `src/auth.rs`) and falsely hubbed
    // every whole-module test file onto this file.
    it('does not count Swift whole-module test imports as dependents of a same-basename file', async () => {
      mockDB.scanAll.mockResolvedValue([
        createChunk('Source/Alamofire.swift'),
        createChunk('Tests/SessionTests.swift', { imports: ['Alamofire'] }),
        createChunk('Tests/ValidationTests.swift', { imports: ['Alamofire'] }),
      ]);

      const result = await findDependents(mockDB as any, 'Source/Alamofire.swift', mockLog);

      expect(result.dependents).toHaveLength(0);
    });

    it('still counts a real dependent via the identical one-leading-segment shape for a non-whole-module language', async () => {
      mockDB.scanAll.mockResolvedValue([
        createChunk('src/auth.rs'),
        createChunk('tests/auth_test.rs', { imports: ['auth'] }),
      ]);

      const result = await findDependents(mockDB as any, 'src/auth.rs', mockLog);

      expect(result.dependents.map(d => d.filepath)).toEqual(['tests/auth_test.rs']);
    });

    it('leaves other Swift files alone when their imports are not bare whole-module hits', async () => {
      mockDB.scanAll.mockResolvedValue([
        createChunk('Source/Networking/Session.swift'),
        createChunk('Tests/SessionTests.swift', { imports: ['./Networking/Session'] }),
      ]);

      const result = await findDependents(
        mockDB as any,
        'Source/Networking/Session.swift',
        mockLog,
      );

      expect(result.dependents.map(d => d.filepath)).toEqual(['Tests/SessionTests.swift']);
    });

    it('does not resolve a symbol-level query through fileImportsSymbolFromAny via the same basename coincidence', async () => {
      // SwiftImportExtractor.processImportSymbols records a bare `import
      // Alamofire` as importedSymbols: { Alamofire: ['Alamofire'] } (the
      // "symbol" is just the module's own name). A symbol-level query for
      // that exact name must not resolve through the coincidental basename
      // match either.
      mockDB.scanAll.mockResolvedValue([
        createChunk('Source/Alamofire.swift', { exports: ['AF', 'AFInfo'] }),
        createChunk('Tests/SessionTests.swift', {
          imports: ['Alamofire'],
          importedSymbols: { Alamofire: ['Alamofire'] },
          callSites: [{ symbol: 'Alamofire', line: 3 }],
        }),
      ]);

      const result = await findDependents(
        mockDB as any,
        'Source/Alamofire.swift',
        mockLog,
        'Alamofire',
      );

      expect(result.dependents).toHaveLength(0);
    });
  });

  describe('import index caching', () => {
    it('should cache scan results and reuse on same indexVersion', async () => {
      const chunks = [
        createChunk('src/target.ts', { exports: ['foo'] }),
        createChunk('src/consumer.ts', { imports: ['src/target.ts'] }),
      ];
      mockDB.scanAll.mockResolvedValue(chunks);

      // First call: should scan
      const result1 = await findDependents(mockDB as any, 'src/target.ts', mockLog, undefined, 100);
      expect(mockDB.scanAll).toHaveBeenCalledTimes(1);
      expect(result1.dependents).toHaveLength(1);

      // Second call with same indexVersion: should use cache
      mockDB.scanAll.mockResolvedValue([]);
      const result2 = await findDependents(mockDB as any, 'src/target.ts', mockLog, undefined, 100);
      expect(mockDB.scanAll).toHaveBeenCalledTimes(1); // not called again
      expect(result2.dependents).toHaveLength(1); // same results from cache
    });

    it('should invalidate cache when indexVersion changes', async () => {
      const chunks = [
        createChunk('src/target.ts', { exports: ['foo'] }),
        createChunk('src/consumer.ts', { imports: ['src/target.ts'] }),
      ];
      mockDB.scanAll.mockResolvedValue(chunks);

      // First call with version 100
      await findDependents(mockDB as any, 'src/target.ts', mockLog, undefined, 100);
      expect(mockDB.scanAll).toHaveBeenCalledTimes(1);

      // Second call with version 200: should re-scan
      mockDB.scanAll.mockResolvedValue([createChunk('src/target.ts', { exports: ['foo'] })]);
      const result2 = await findDependents(mockDB as any, 'src/target.ts', mockLog, undefined, 200);
      expect(mockDB.scanAll).toHaveBeenCalledTimes(2);
      expect(result2.dependents).toHaveLength(0); // no consumers in new scan
    });

    it('should invalidate cache via clearDependencyCache()', async () => {
      const chunks = [
        createChunk('src/target.ts', { exports: ['foo'] }),
        createChunk('src/consumer.ts', { imports: ['src/target.ts'] }),
      ];
      mockDB.scanAll.mockResolvedValue(chunks);

      // First call: populates cache
      await findDependents(mockDB as any, 'src/target.ts', mockLog, undefined, 100);
      expect(mockDB.scanAll).toHaveBeenCalledTimes(1);

      // Clear cache
      clearDependencyCache();

      // Same version but cache cleared: should re-scan
      mockDB.scanAll.mockResolvedValue(chunks);
      await findDependents(mockDB as any, 'src/target.ts', mockLog, undefined, 100);
      expect(mockDB.scanAll).toHaveBeenCalledTimes(2);
    });

    it('should not cache when indexVersion is not provided', async () => {
      const chunks = [
        createChunk('src/target.ts', { exports: ['foo'] }),
        createChunk('src/consumer.ts', { imports: ['src/target.ts'] }),
      ];
      mockDB.scanAll.mockResolvedValue(chunks);

      // First call without indexVersion
      await findDependents(mockDB as any, 'src/target.ts', mockLog);
      expect(mockDB.scanAll).toHaveBeenCalledTimes(1);

      // Second call without indexVersion: should scan again
      mockDB.scanAll.mockResolvedValue(chunks);
      await findDependents(mockDB as any, 'src/target.ts', mockLog);
      expect(mockDB.scanAll).toHaveBeenCalledTimes(2);
    });
  });
});
