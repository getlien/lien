import { describe, it, expect, vi } from 'vitest';
import { searchFileChunks } from './get-files-context.js';
import type { SearchResult } from '@liendev/core';

describe('searchFileChunks', () => {
  const mockLog = vi.fn();
  const mockEmbeddings = { embed: vi.fn() };

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
      embeddings: mockEmbeddings as any,
      log: mockLog,
      workspaceRoot: '/project',
    };

    const results = await searchFileChunks(['src/foo.ts', 'src/bar.ts'], ctx);

    expect(mockVectorDB.scanWithFilter).toHaveBeenCalledWith({
      file: ['src/foo.ts', 'src/bar.ts'],
      limit: 200,
    });
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
      embeddings: mockEmbeddings as any,
      log: mockLog,
      workspaceRoot: '/project',
    };

    const results = await searchFileChunks(['src/missing.ts'], ctx);

    expect(results).toHaveLength(1);
    expect(results[0]).toHaveLength(0);
  });

  it('should not call embeddings.embed', async () => {
    const mockVectorDB = {
      scanWithFilter: vi.fn().mockResolvedValue([]),
    };

    const ctx = {
      vectorDB: mockVectorDB as any,
      embeddings: mockEmbeddings as any,
      log: mockLog,
      workspaceRoot: '/project',
    };

    await searchFileChunks(['src/foo.ts'], ctx);

    expect(mockEmbeddings.embed).not.toHaveBeenCalled();
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
      embeddings: mockEmbeddings as any,
      log: mockLog,
      workspaceRoot: '/project',
    };

    const results = await searchFileChunks(['src/foo.ts'], ctx);

    expect(results[0]).toHaveLength(3);
  });
});
