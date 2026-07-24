import { describe, it, expect, vi } from 'vitest';
import type { VectorDBInterface, SearchResult } from '@liendev/core';
import { findDocReferences } from './doc-references.js';

function docChunk(file: string, content: string): SearchResult {
  return {
    content,
    metadata: { file, startLine: 1, endLine: 1, type: 'doc', language: 'markdown' },
    score: 0,
    relevance: 'not_relevant',
  };
}

function codeChunk(file: string, content: string): SearchResult {
  return {
    content,
    metadata: { file, startLine: 1, endLine: 1, type: 'function', language: 'typescript' },
    score: 0,
    relevance: 'not_relevant',
  };
}

function stubVectorDB(chunks: SearchResult[]): VectorDBInterface {
  return {
    scanAll: vi.fn().mockResolvedValue(chunks),
  } as unknown as VectorDBInterface;
}

describe('findDocReferences', () => {
  it('reports distinct doc files genuinely referencing the symbol', async () => {
    const vectorDB = stubVectorDB([
      docChunk('CLAUDE.md', 'The `createVectorDB` factory resolves worktree mode.'),
      docChunk('docs/guide.md', 'See `createVectorDB(projectRoot)` for the entry point.'),
      codeChunk('src/factory.ts', 'export async function createVectorDB() {}'),
    ]);

    const result = await findDocReferences(vectorDB, 'createVectorDB');

    expect(result).toEqual({ count: 2, paths: ['CLAUDE.md', 'docs/guide.md'] });
  });

  it('excludes non-doc chunk types even when they contain the symbol', async () => {
    const vectorDB = stubVectorDB([
      codeChunk('src/factory.ts', 'export async function createVectorDB() {}'),
    ]);

    const result = await findDocReferences(vectorDB, 'createVectorDB');

    expect(result).toEqual({ count: 0, paths: [] });
  });

  it('does not match a substring occurrence (word-boundary precision)', async () => {
    const vectorDB = stubVectorDB([
      docChunk('docs/guide.md', 'See `createVectorDBOverlay` for the worktree variant.'),
    ]);

    const result = await findDocReferences(vectorDB, 'createVectorDB');

    expect(result).toEqual({ count: 0, paths: [] });
  });

  it('suppresses a generic symbol name that also reads as ordinary prose (index/config spam case)', async () => {
    const vectorDB = stubVectorDB([
      docChunk('CLAUDE.md', 'The `index` function builds the search index.'),
      docChunk('docs/guide.md', 'See the index below for a full list of commands.'),
    ]);

    const result = await findDocReferences(vectorDB, 'index');

    expect(result).toEqual({ count: 0, paths: [] });
  });

  it('caps displayed paths at MAX_DOC_REF_PATHS while reporting the true total count', async () => {
    const vectorDB = stubVectorDB([
      docChunk('docs/a.md', '`helper()` is documented here.'),
      docChunk('docs/b.md', '`helper()` is documented here too.'),
      docChunk('docs/c.md', '`helper()` shows up here as well.'),
      docChunk('docs/d.md', '`helper()` shows up here too.'),
    ]);

    const result = await findDocReferences(vectorDB, 'helper');

    expect(result?.count).toBe(4);
    expect(result?.paths).toEqual(['docs/a.md', 'docs/b.md', 'docs/c.md']);
  });

  it('dedupes multiple matches within the same file to one path entry', async () => {
    const vectorDB = stubVectorDB([
      docChunk('CLAUDE.md', 'First mention of `helper()`.'),
      docChunk('CLAUDE.md', 'Second mention of `helper()` later in the same file.'),
    ]);

    const result = await findDocReferences(vectorDB, 'helper');

    expect(result).toEqual({ count: 1, paths: ['CLAUDE.md'] });
  });

  it('returns zero when the symbol appears nowhere in the doc corpus', async () => {
    const vectorDB = stubVectorDB([docChunk('CLAUDE.md', 'Nothing relevant here.')]);

    const result = await findDocReferences(vectorDB, 'neverMentioned');

    expect(result).toEqual({ count: 0, paths: [] });
  });

  it('fails open (returns null) when the scan itself throws', async () => {
    const vectorDB = {
      scanAll: vi.fn().mockRejectedValue(new Error('db closed')),
    } as unknown as VectorDBInterface;

    const result = await findDocReferences(vectorDB, 'anything');

    expect(result).toBeNull();
  });
});
