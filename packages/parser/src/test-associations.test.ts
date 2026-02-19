import { describe, it, expect } from 'vitest';
import { findTestAssociationsFromChunks } from './test-associations.js';
import type { CodeChunk } from './types.js';

function makeChunk(file: string, imports: string[] = []): CodeChunk {
  return {
    content: '',
    metadata: {
      file,
      startLine: 1,
      endLine: 10,
      type: 'function',
      imports,
    },
  };
}

describe('findTestAssociationsFromChunks', () => {
  it('finds test files that import the target', () => {
    const chunks: CodeChunk[] = [
      makeChunk('src/auth.ts'),
      makeChunk('src/__tests__/auth.test.ts', ['../auth']),
      makeChunk('src/utils.ts'),
    ];

    const result = findTestAssociationsFromChunks(['src/auth.ts'], chunks);

    expect(result.get('src/auth.ts')).toEqual(['src/__tests__/auth.test.ts']);
  });

  it('returns empty map for files with no test associations', () => {
    const chunks: CodeChunk[] = [makeChunk('src/auth.ts'), makeChunk('src/utils.ts')];

    const result = findTestAssociationsFromChunks(['src/auth.ts'], chunks);

    expect(result.has('src/auth.ts')).toBe(false);
  });

  it('finds multiple test files for one source', () => {
    const chunks: CodeChunk[] = [
      makeChunk('src/auth.ts'),
      makeChunk('src/__tests__/auth.test.ts', ['../auth']),
      makeChunk('src/__tests__/auth.spec.ts', ['../auth']),
    ];

    const result = findTestAssociationsFromChunks(['src/auth.ts'], chunks);

    expect(result.get('src/auth.ts')).toHaveLength(2);
    expect(result.get('src/auth.ts')).toContain('src/__tests__/auth.test.ts');
    expect(result.get('src/auth.ts')).toContain('src/__tests__/auth.spec.ts');
  });

  it('handles multiple source files', () => {
    const chunks: CodeChunk[] = [
      makeChunk('src/auth.ts'),
      makeChunk('src/user.ts'),
      makeChunk('src/__tests__/auth.test.ts', ['../auth']),
      makeChunk('test/user.test.ts', ['../src/user']),
    ];

    const result = findTestAssociationsFromChunks(['src/auth.ts', 'src/user.ts'], chunks);

    expect(result.get('src/auth.ts')).toEqual(['src/__tests__/auth.test.ts']);
    expect(result.get('src/user.ts')).toEqual(['test/user.test.ts']);
  });

  it('ignores non-test files even if they import the target', () => {
    const chunks: CodeChunk[] = [
      makeChunk('src/auth.ts'),
      makeChunk('src/login.ts', ['./auth']), // Not a test file
      makeChunk('src/__tests__/auth.test.ts', ['../auth']),
    ];

    const result = findTestAssociationsFromChunks(['src/auth.ts'], chunks);

    expect(result.get('src/auth.ts')).toEqual(['src/__tests__/auth.test.ts']);
  });

  it('deduplicates test files across multiple chunks', () => {
    const chunks: CodeChunk[] = [
      makeChunk('src/auth.ts'),
      // Same test file appears in two chunks (e.g., two functions)
      makeChunk('src/__tests__/auth.test.ts', ['../auth']),
      makeChunk('src/__tests__/auth.test.ts', ['../auth', '../utils']),
    ];

    const result = findTestAssociationsFromChunks(['src/auth.ts'], chunks);

    expect(result.get('src/auth.ts')).toEqual(['src/__tests__/auth.test.ts']);
  });
});
