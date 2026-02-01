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
    // - Target: src/vectordb/lancedb.ts exports VectorDB
    // - Re-exporter: src/index.ts imports from ./vectordb/lancedb.js and re-exports VectorDB
    // - Consumer: src/cli/app.ts imports VectorDB from @mypackage/core (maps to src/index.ts)
    //   and uses it
    const chunks: SearchResult[] = [
      // Target file (src/vectordb/lancedb.ts) - exports VectorDB
      createChunk({
        file: 'src/vectordb/lancedb.ts',
        content: 'export class VectorDB { ... }',
        exports: ['VectorDB'],
        symbolName: 'VectorDB',
        symbolType: 'class',
      }),

      // Re-exporter (src/index.ts) - imports from target and re-exports
      createChunk({
        file: 'src/index.ts',
        content: "export { VectorDB } from './vectordb/lancedb.js';",
        imports: ['./vectordb/lancedb.js'],
        importedSymbols: { './vectordb/lancedb.js': ['VectorDB'] },
        exports: ['VectorDB'],
      }),

      // Consumer via re-export (src/cli/app.ts) - imports from package name
      createChunk({
        file: 'src/cli/app.ts',
        content: "import { VectorDB } from '@mypackage/core';\nconst db = new VectorDB();",
        imports: ['@mypackage/core'],
        importedSymbols: { '@mypackage/core': ['VectorDB'] },
        callSites: [{ symbol: 'VectorDB', line: 2 }],
        symbolName: 'useDB',
      }),
    ];

    const result = await findDependents(
      createMockDB(chunks),
      'src/vectordb/lancedb.ts',
      false,
      mockLog,
      'VectorDB'
    );

    // The re-exporter (src/index.ts) should be a direct dependent
    const reExporter = result.dependents.find(d => d.filepath === 'src/index.ts');
    expect(reExporter).toBeDefined();

    // The consumer (src/cli/app.ts) should be found as an indirect dependent
    const consumer = result.dependents.find(d => d.filepath === 'src/cli/app.ts');
    expect(consumer).toBeDefined();
    expect(consumer?.usages).toHaveLength(1);
    expect(consumer?.usages?.[0].callerSymbol).toBe('useDB');

    // Total usage count should include the indirect dependent
    expect(result.totalUsageCount).toBeGreaterThanOrEqual(1);
  });

  it('should not include indirect dependents when no re-exporters exist', async () => {
    // Scenario: target exports VectorDB, consumer imports VectorDB from unrelated module
    // No re-exporter exists, so the consumer should NOT be found
    const chunks: SearchResult[] = [
      // Target file
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

    // consumer.ts imports the target but not VectorDB specifically
    // other.ts imports VectorDB but there's no re-exporter chain
    // So only consumer.ts should be in dependents (file-level), but not matched for symbol
    expect(result.dependents.find(d => d.filepath === 'src/other.ts')).toBeUndefined();
  });

  it('should handle multiple levels of re-export consumers', async () => {
    // Multiple files import VectorDB through the same re-exporter
    const chunks: SearchResult[] = [
      createChunk({
        file: 'src/vectordb/lancedb.ts',
        exports: ['VectorDB'],
        symbolName: 'VectorDB',
      }),

      // Re-exporter
      createChunk({
        file: 'src/index.ts',
        imports: ['./vectordb/lancedb.js'],
        importedSymbols: { './vectordb/lancedb.js': ['VectorDB'] },
        exports: ['VectorDB'],
      }),

      // Consumer 1
      createChunk({
        file: 'src/cli/serve.ts',
        content: 'const db = new VectorDB();',
        imports: ['@pkg/core'],
        importedSymbols: { '@pkg/core': ['VectorDB'] },
        callSites: [{ symbol: 'VectorDB', line: 5 }],
        symbolName: 'startServer',
      }),

      // Consumer 2
      createChunk({
        file: 'src/cli/index-cmd.ts',
        content: 'await VectorDB.load(path);',
        imports: ['@pkg/core'],
        importedSymbols: { '@pkg/core': ['VectorDB'] },
        callSites: [{ symbol: 'VectorDB', line: 10 }],
        symbolName: 'indexCommand',
      }),

      // Consumer 3 (test file)
      createChunk({
        file: 'test/helpers/test-db.ts',
        content: 'new VectorDB()',
        imports: ['@pkg/core'],
        importedSymbols: { '@pkg/core': ['VectorDB'] },
        callSites: [{ symbol: 'VectorDB', line: 3 }],
        symbolName: 'createTestDB',
      }),
    ];

    const result = await findDependents(
      createMockDB(chunks),
      'src/vectordb/lancedb.ts',
      false,
      mockLog,
      'VectorDB'
    );

    // All 3 consumers + 1 re-exporter = 4 dependents
    expect(result.dependents).toHaveLength(4);
    expect(result.totalUsageCount).toBe(3); // 3 consumers with call sites

    // Test file should be identified
    const testFile = result.dependents.find(d => d.filepath === 'test/helpers/test-db.ts');
    expect(testFile?.isTestFile).toBe(true);
  });

  it('should not double-count files that are both direct and indirect dependents', async () => {
    // A file imports VectorDB directly from the target AND also from a re-exporter
    // It should only appear once
    const chunks: SearchResult[] = [
      createChunk({
        file: 'src/vectordb/lancedb.ts',
        exports: ['VectorDB'],
      }),

      // Re-exporter
      createChunk({
        file: 'src/index.ts',
        imports: ['./vectordb/lancedb.js'],
        importedSymbols: { './vectordb/lancedb.js': ['VectorDB'] },
        exports: ['VectorDB'],
      }),

      // File that imports directly from the target (matches via path)
      createChunk({
        file: 'src/vectordb/utils.ts',
        imports: ['./lancedb.js'],
        importedSymbols: { './lancedb.js': ['VectorDB'] },
        callSites: [{ symbol: 'VectorDB', line: 5 }],
        symbolName: 'helper',
      }),
    ];

    const result = await findDependents(
      createMockDB(chunks),
      'src/vectordb/lancedb.ts',
      false,
      mockLog,
      'VectorDB'
    );

    // vectordb/utils.ts should appear once (as direct dependent)
    const utilsEntries = result.dependents.filter(d => d.filepath === 'src/vectordb/utils.ts');
    expect(utilsEntries).toHaveLength(1);
  });

  it('should log re-exporter detection', async () => {
    const chunks: SearchResult[] = [
      createChunk({
        file: 'src/vectordb/lancedb.ts',
        exports: ['VectorDB'],
      }),

      createChunk({
        file: 'src/index.ts',
        imports: ['./vectordb/lancedb.js'],
        importedSymbols: { './vectordb/lancedb.js': ['VectorDB'] },
        exports: ['VectorDB'],
      }),

      createChunk({
        file: 'src/app.ts',
        imports: ['@pkg/core'],
        importedSymbols: { '@pkg/core': ['VectorDB'] },
      }),
    ];

    await findDependents(
      createMockDB(chunks),
      'src/vectordb/lancedb.ts',
      false,
      mockLog,
      'VectorDB'
    );

    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining('re-exporter')
    );
  });

  it('should handle symbol usages without re-exports (direct imports only)', async () => {
    // Basic case: no re-exports, direct imports work fine
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
