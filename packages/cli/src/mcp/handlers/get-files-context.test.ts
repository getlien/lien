import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  searchFileChunks,
  findRelatedChunks,
  handleGetFilesContext,
  clearTestAssociationScanCache,
} from './get-files-context.js';
import type { ToolContext } from '../types.js';
import type { SearchResult } from '@liendev/core';

describe('searchFileChunks', () => {
  const mockLog = vi.fn();

  function makeResult(file: string, content: string): SearchResult {
    return {
      content,
      metadata: {
        file,
        startLine: 1,
        endLine: 10,
        type: 'function',
        language: 'typescript',
      },
      score: 0,
      relevance: 'not_relevant',
    };
  }

  it('should query chunks using scanWithFilter with file paths', async () => {
    const chunks = [
      makeResult('src/foo.ts', 'function foo() {}'),
      makeResult('src/bar.ts', 'function bar() {}'),
    ];

    const mockVectorDB = {
      scanWithFilter: vi.fn().mockResolvedValue(chunks),
    };

    const ctx = {
      vectorDB: mockVectorDB as any,
      log: mockLog,
      workspaceRoot: '/project',
    };

    const results = await searchFileChunks(['src/foo.ts', 'src/bar.ts'], ctx);

    expect(mockVectorDB.scanWithFilter).toHaveBeenCalledWith(
      expect.objectContaining({
        file: ['src/foo.ts', 'src/bar.ts'],
        limit: 200,
      }),
    );
    expect(results).toHaveLength(2);
    expect(results[0]).toHaveLength(1);
    expect(results[0][0].metadata.file).toBe('src/foo.ts');
    expect(results[1]).toHaveLength(1);
    expect(results[1][0].metadata.file).toBe('src/bar.ts');
  });

  it('should return empty arrays for files with no indexed chunks', async () => {
    const mockVectorDB = {
      scanWithFilter: vi.fn().mockResolvedValue([]),
    };

    const ctx = {
      vectorDB: mockVectorDB as any,
      log: mockLog,
      workspaceRoot: '/project',
    };

    const results = await searchFileChunks(['src/missing.ts'], ctx);

    expect(results).toHaveLength(1);
    expect(results[0]).toHaveLength(0);
  });

  it('should group multiple chunks per file correctly', async () => {
    const chunks = [
      makeResult('src/foo.ts', 'function foo() {}'),
      makeResult('src/foo.ts', 'function bar() {}'),
      makeResult('src/foo.ts', 'const x = 1;'),
    ];

    const mockVectorDB = {
      scanWithFilter: vi.fn().mockResolvedValue(chunks),
    };

    const ctx = {
      vectorDB: mockVectorDB as any,
      log: mockLog,
      workspaceRoot: '/project',
    };

    const results = await searchFileChunks(['src/foo.ts'], ctx);

    expect(results[0]).toHaveLength(3);
  });
});

describe('findRelatedChunks (lexical FTS5 on first-chunk content)', () => {
  const mockLog = vi.fn();

  function makeResult(file: string, content: string, language = 'typescript'): SearchResult {
    return {
      content,
      metadata: { file, startLine: 1, endLine: 10, type: 'function', language },
      score: 0,
      relevance: 'highly_relevant',
    };
  }

  it('searches with the first chunk content string', async () => {
    const firstChunk = makeResult('src/foo.ts', 'function foo() { return computeThing(); }');
    const related = makeResult('src/bar.ts', 'function computeThing() {}');
    const mockVectorDB = { search: vi.fn().mockResolvedValue([related]) };

    const ctx = {
      vectorDB: mockVectorDB as any,
      log: mockLog,
      workspaceRoot: '/project',
    };

    const result = await findRelatedChunks(['src/foo.ts'], [[firstChunk]], ctx);

    // Lexical path: the first chunk content is the query text passed to search().
    expect(mockVectorDB.search).toHaveBeenCalledWith(firstChunk.content, 5);
    expect(result[0].some(r => r.metadata.file === 'src/bar.ts')).toBe(true);
  });

  it('filters out same-file and markdown related chunks', async () => {
    const firstChunk = makeResult('src/foo.ts', 'function foo() {}');
    const sameFile = makeResult('src/foo.ts', 'function other() {}');
    const markdown = makeResult('README.md', '# docs', 'markdown');
    const mockVectorDB = { search: vi.fn().mockResolvedValue([sameFile, markdown]) };

    const ctx = {
      vectorDB: mockVectorDB as any,
      log: mockLog,
      workspaceRoot: '/project',
    };

    const result = await findRelatedChunks(['src/foo.ts'], [[firstChunk]], ctx);

    expect(result[0]).toHaveLength(0);
  });
});

describe('handleGetFilesContext - test-association scan (scanAll fast path + cache)', () => {
  const mockLog = vi.fn();
  const mockCheckAndReconnect = vi.fn().mockResolvedValue(undefined);

  function makeChunk(file: string, imports: string[] = []): SearchResult {
    return {
      content: '',
      metadata: {
        file,
        startLine: 1,
        endLine: 5,
        type: 'block',
        language: 'typescript',
        imports,
      },
      score: 0,
      relevance: 'not_relevant',
    };
  }

  function makeCtx(options: {
    scanAll: ReturnType<typeof vi.fn>;
    indexVersion: number | (() => number);
  }): ToolContext {
    const { indexVersion } = options;
    const getVersion: () => number =
      typeof indexVersion === 'function' ? indexVersion : () => indexVersion;

    return {
      vectorDB: {
        scanAll: options.scanAll,
        // Per-file lookup (Step 1) — irrelevant to these tests, always empty.
        scanWithFilter: vi.fn().mockResolvedValue([]),
      } as any,
      rootDir: '/fake/workspace',
      log: mockLog,
      checkAndReconnect: mockCheckAndReconnect,
      getIndexMetadata: vi.fn(() => ({
        indexVersion: getVersion(),
        indexDate: '2026-07-01',
      })),
      getReindexState: vi.fn(() => ({
        inProgress: false,
        pendingFiles: [],
        lastReindexTimestamp: null,
        lastReindexDurationMs: null,
      })),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    clearTestAssociationScanCache();
  });

  it('uses scanAll (not an unfiltered scanWithFilter) for the test-association scan', async () => {
    const scanAll = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({ scanAll, indexVersion: 1 });

    await handleGetFilesContext({ filepaths: 'src/auth.ts', includeRelated: false }, ctx);

    expect(scanAll).toHaveBeenCalledTimes(1);
    expect(scanAll).toHaveBeenCalledWith();
  });

  it('returns the same test associations via scanAll as scanWithFilter previously produced', async () => {
    const scanAll = vi.fn().mockResolvedValue([
      makeChunk('src/__tests__/auth.test.ts', ['../auth']),
      makeChunk('src/helper.ts', ['./auth']), // imports the target but is not a test file
    ]);
    const ctx = makeCtx({ scanAll, indexVersion: 1 });

    const result = await handleGetFilesContext(
      { filepaths: 'src/auth.ts', includeRelated: false },
      ctx,
    );

    const parsed = JSON.parse(result.content![0].text);
    expect(parsed.testAssociations).toEqual(['src/__tests__/auth.test.ts']);
  });

  it('caches the scan across calls with the same indexVersion (no re-scan)', async () => {
    const scanAll = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({ scanAll, indexVersion: 42 });

    await handleGetFilesContext({ filepaths: 'src/a.ts', includeRelated: false }, ctx);
    await handleGetFilesContext({ filepaths: 'src/b.ts', includeRelated: false }, ctx);

    expect(scanAll).toHaveBeenCalledTimes(1);
  });

  it('busts the cache when indexVersion changes (reindex)', async () => {
    const scanAll = vi.fn().mockResolvedValue([]);
    let indexVersion = 1;
    const ctx = makeCtx({ scanAll, indexVersion: () => indexVersion });

    await handleGetFilesContext({ filepaths: 'src/a.ts', includeRelated: false }, ctx);
    indexVersion = 2;
    await handleGetFilesContext({ filepaths: 'src/b.ts', includeRelated: false }, ctx);

    expect(scanAll).toHaveBeenCalledTimes(2);
  });

  it('does not serve a stale cache entry after clearTestAssociationScanCache()', async () => {
    const scanAll = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({ scanAll, indexVersion: 7 });

    await handleGetFilesContext({ filepaths: 'src/a.ts', includeRelated: false }, ctx);
    clearTestAssociationScanCache();
    await handleGetFilesContext({ filepaths: 'src/b.ts', includeRelated: false }, ctx);

    expect(scanAll).toHaveBeenCalledTimes(2);
  });

  it('does not cache when indexVersion is unavailable', async () => {
    const scanAll = vi.fn().mockResolvedValue([]);
    const ctx: ToolContext = {
      ...makeCtx({ scanAll, indexVersion: 1 }),
      getIndexMetadata: vi.fn(() => ({
        indexVersion: undefined as unknown as number,
        indexDate: '2026-07-01',
      })),
    };

    await handleGetFilesContext({ filepaths: 'src/a.ts', includeRelated: false }, ctx);
    await handleGetFilesContext({ filepaths: 'src/b.ts', includeRelated: false }, ctx);

    expect(scanAll).toHaveBeenCalledTimes(2);
  });
});
