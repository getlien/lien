import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findDependents } from './dependency-analyzer.js';
import type { SearchResult } from '@liendev/core';

/**
 * Helper to create a mock SearchResult chunk with sensible defaults.
 */
function createChunk(overrides: {
  file: string;
  content?: string;
  startLine?: number;
  endLine?: number;
  imports?: string[];
  importedSymbols?: Record<string, string[]>;
  exports?: string[];
  callSites?: Array<{ symbol: string; line: number }>;
  symbolName?: string;
  symbolType?: 'function' | 'method' | 'class' | 'interface';
}): SearchResult {
  return {
    content: overrides.content || '',
    metadata: {
      file: overrides.file,
      startLine: overrides.startLine ?? 1,
      endLine: overrides.endLine ?? 10,
      type: 'function',
      language: 'typescript',
      imports: overrides.imports,
      importedSymbols: overrides.importedSymbols,
      exports: overrides.exports,
      callSites: overrides.callSites,
      symbolName: overrides.symbolName,
      symbolType: overrides.symbolType,
    },
    score: 0,
    relevance: 'highly_relevant',
  };
}

describe('findDependents - re-export chain resolution', () => {
  const mockLog = vi.fn();

  // Mock vectorDB that returns our test chunks
  function createMockDB(chunks: SearchResult[]) {
    return {
      scanWithFilter: vi.fn().mockResolvedValue(chunks),
      scanCrossRepo: vi.fn().mockResolvedValue(chunks),
      search: vi.fn(),
      upsert: vi.fn(),
    } as any;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should find symbol usages through re-export chains', async () => {
    // Scenario:
    // - Target: packages/core/src/vectordb/lancedb.ts exports VectorDB
    // - Re-exporter: packages/core/src/index.ts imports from target and re-exports VectorDB
    // - Consumer: packages/cli/src/app.ts imports VectorDB from @mypackage/core
    //   Package name "core" matches directory component in re-exporter path
    const chunks: SearchResult[] = [
      createChunk({
        file: 'packages/core/src/vectordb/lancedb.ts',
        content: 'export class VectorDB { ... }',
        exports: ['VectorDB'],
        symbolName: 'VectorDB',
        symbolType: 'class',
      }),

      createChunk({
        file: 'packages/core/src/index.ts',
        content: "export { VectorDB } from './vectordb/lancedb.js';",
        imports: ['./vectordb/lancedb.js'],
        importedSymbols: { './vectordb/lancedb.js': ['VectorDB'] },
        exports: ['VectorDB'],
      }),

      createChunk({
        file: 'packages/cli/src/app.ts',
        content: "import { VectorDB } from '@mypackage/core';\nconst db = new VectorDB();",
        imports: ['@mypackage/core'],
        importedSymbols: { '@mypackage/core': ['VectorDB'] },
        callSites: [{ symbol: 'VectorDB', line: 2 }],
        symbolName: 'useDB',
      }),
    ];

    const result = await findDependents(
      createMockDB(chunks),
      'packages/core/src/vectordb/lancedb.ts',
      false,
      mockLog,
      'VectorDB'
    );

    // The re-exporter should be a direct dependent
    const reExporter = result.dependents.find(d => d.filepath === 'packages/core/src/index.ts');
    expect(reExporter).toBeDefined();

    // The consumer should be found as an indirect dependent
    const consumer = result.dependents.find(d => d.filepath === 'packages/cli/src/app.ts');
    expect(consumer).toBeDefined();
    expect(consumer?.usages).toHaveLength(1);
    expect(consumer?.usages?.[0].callerSymbol).toBe('useDB');

    // Total usage count should include the indirect dependent
    expect(result.totalUsageCount).toBeGreaterThanOrEqual(1);
  });

  it('should not include indirect dependents when no re-exporters exist', async () => {
    // No re-exporter exists → consumer importing same symbol name from elsewhere is excluded
    const chunks: SearchResult[] = [
      createChunk({
        file: 'src/vectordb/lancedb.ts',
        exports: ['VectorDB'],
        symbolName: 'VectorDB',
      }),

      // Direct dependent that imports a different symbol
      createChunk({
        file: 'src/consumer.ts',
        imports: ['./vectordb/lancedb.js'],
        importedSymbols: { './vectordb/lancedb.js': ['search'] },
        callSites: [{ symbol: 'search', line: 5 }],
      }),

      // Unrelated file that imports VectorDB from elsewhere
      createChunk({
        file: 'src/other.ts',
        imports: ['other-package'],
        importedSymbols: { 'other-package': ['VectorDB'] },
        callSites: [{ symbol: 'VectorDB', line: 3 }],
      }),
    ];

    const result = await findDependents(
      createMockDB(chunks),
      'src/vectordb/lancedb.ts',
      false,
      mockLog,
      'VectorDB'
    );

    expect(result.dependents.find(d => d.filepath === 'src/other.ts')).toBeUndefined();
  });

  it('should not include files importing same-named symbol from unrelated package', async () => {
    // Re-exporter exists, but a file imports VectorDB from a completely unrelated package.
    // The unrelated package name ("other-db") doesn't match any re-exporter path component,
    // so it should be excluded.
    const chunks: SearchResult[] = [
      createChunk({
        file: 'packages/core/src/vectordb/lancedb.ts',
        exports: ['VectorDB'],
        symbolName: 'VectorDB',
      }),

      // Re-exporter — triggers indirect dependent scanning
      createChunk({
        file: 'packages/core/src/index.ts',
        imports: ['./vectordb/lancedb.js'],
        importedSymbols: { './vectordb/lancedb.js': ['VectorDB'] },
        exports: ['VectorDB'],
      }),

      // Legitimate consumer via re-export (package name "core" matches re-exporter path)
      createChunk({
        file: 'packages/cli/src/app.ts',
        imports: ['@liendev/core'],
        importedSymbols: { '@liendev/core': ['VectorDB'] },
        callSites: [{ symbol: 'VectorDB', line: 5 }],
        symbolName: 'startApp',
      }),

      // Unrelated consumer — imports VectorDB from a different package ("other-db")
      // "other-db" does NOT appear as a directory component in any re-exporter path
      createChunk({
        file: 'packages/cli/src/migration.ts',
        imports: ['other-db'],
        importedSymbols: { 'other-db': ['VectorDB'] },
        callSites: [{ symbol: 'VectorDB', line: 10 }],
        symbolName: 'migrate',
      }),
    ];

    const result = await findDependents(
      createMockDB(chunks),
      'packages/core/src/vectordb/lancedb.ts',
      false,
      mockLog,
      'VectorDB'
    );

    // Legitimate consumer should be found
    expect(result.dependents.find(d => d.filepath === 'packages/cli/src/app.ts')).toBeDefined();

    // Unrelated consumer should NOT be found (import path doesn't match any re-exporter)
    expect(result.dependents.find(d => d.filepath === 'packages/cli/src/migration.ts')).toBeUndefined();
  });

  it('should handle multiple consumers through the same re-exporter', async () => {
    const chunks: SearchResult[] = [
      createChunk({
        file: 'packages/core/src/vectordb/lancedb.ts',
        exports: ['VectorDB'],
        symbolName: 'VectorDB',
      }),

      createChunk({
        file: 'packages/core/src/index.ts',
        imports: ['./vectordb/lancedb.js'],
        importedSymbols: { './vectordb/lancedb.js': ['VectorDB'] },
        exports: ['VectorDB'],
      }),

      createChunk({
        file: 'packages/cli/src/serve.ts',
        content: 'const db = new VectorDB();',
        imports: ['@pkg/core'],
        importedSymbols: { '@pkg/core': ['VectorDB'] },
        callSites: [{ symbol: 'VectorDB', line: 5 }],
        symbolName: 'startServer',
      }),

      createChunk({
        file: 'packages/cli/src/index-cmd.ts',
        content: 'await VectorDB.load(path);',
        imports: ['@pkg/core'],
        importedSymbols: { '@pkg/core': ['VectorDB'] },
        callSites: [{ symbol: 'VectorDB', line: 10 }],
        symbolName: 'indexCommand',
      }),

      createChunk({
        file: 'packages/cli/test/helpers/test-db.ts',
        content: 'new VectorDB()',
        imports: ['@pkg/core'],
        importedSymbols: { '@pkg/core': ['VectorDB'] },
        callSites: [{ symbol: 'VectorDB', line: 3 }],
        symbolName: 'createTestDB',
      }),
    ];

    const result = await findDependents(
      createMockDB(chunks),
      'packages/core/src/vectordb/lancedb.ts',
      false,
      mockLog,
      'VectorDB'
    );

    // All 3 consumers + 1 re-exporter = 4 dependents
    expect(result.dependents).toHaveLength(4);
    expect(result.totalUsageCount).toBe(3); // 3 consumers with call sites

    // Test file should be identified
    const testFile = result.dependents.find(d => d.filepath.includes('test-db'));
    expect(testFile?.isTestFile).toBe(true);
  });

  it('should not double-count files that are both direct and indirect dependents', async () => {
    const chunks: SearchResult[] = [
      createChunk({
        file: 'packages/core/src/vectordb/lancedb.ts',
        exports: ['VectorDB'],
      }),

      createChunk({
        file: 'packages/core/src/index.ts',
        imports: ['./vectordb/lancedb.js'],
        importedSymbols: { './vectordb/lancedb.js': ['VectorDB'] },
        exports: ['VectorDB'],
      }),

      // File that imports directly from the target (matches via relative path)
      createChunk({
        file: 'packages/core/src/vectordb/utils.ts',
        imports: ['./lancedb.js'],
        importedSymbols: { './lancedb.js': ['VectorDB'] },
        callSites: [{ symbol: 'VectorDB', line: 5 }],
        symbolName: 'helper',
      }),
    ];

    const result = await findDependents(
      createMockDB(chunks),
      'packages/core/src/vectordb/lancedb.ts',
      false,
      mockLog,
      'VectorDB'
    );

    const utilsEntries = result.dependents.filter(d => d.filepath.includes('vectordb/utils'));
    expect(utilsEntries).toHaveLength(1);
  });

  it('should log re-exporter detection', async () => {
    const chunks: SearchResult[] = [
      createChunk({
        file: 'packages/core/src/vectordb/lancedb.ts',
        exports: ['VectorDB'],
      }),

      createChunk({
        file: 'packages/core/src/index.ts',
        imports: ['./vectordb/lancedb.js'],
        importedSymbols: { './vectordb/lancedb.js': ['VectorDB'] },
        exports: ['VectorDB'],
      }),

      createChunk({
        file: 'packages/cli/src/app.ts',
        imports: ['@pkg/core'],
        importedSymbols: { '@pkg/core': ['VectorDB'] },
      }),
    ];

    await findDependents(
      createMockDB(chunks),
      'packages/core/src/vectordb/lancedb.ts',
      false,
      mockLog,
      'VectorDB'
    );

    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining('re-exporter')
    );
  });

  it('should handle symbol usages without re-exports (direct imports only)', async () => {
    const chunks: SearchResult[] = [
      createChunk({
        file: 'src/utils/validate.ts',
        exports: ['validateEmail'],
        symbolName: 'validateEmail',
      }),

      createChunk({
        file: 'src/signup.ts',
        content: 'validateEmail(input.email)',
        imports: ['./utils/validate.js'],
        importedSymbols: { './utils/validate.js': ['validateEmail'] },
        callSites: [{ symbol: 'validateEmail', line: 10 }],
        symbolName: 'signupHandler',
      }),
    ];

    const result = await findDependents(
      createMockDB(chunks),
      'src/utils/validate.ts',
      false,
      mockLog,
      'validateEmail'
    );

    expect(result.dependents).toHaveLength(1);
    expect(result.totalUsageCount).toBe(1);
    expect(result.dependents[0].filepath).toBe('src/signup.ts');
  });
});
