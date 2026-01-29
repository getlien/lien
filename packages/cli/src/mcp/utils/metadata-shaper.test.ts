import { describe, it, expect } from 'vitest';
import { shapeResultMetadata, shapeResults, deduplicateResults } from './metadata-shaper.js';
import type { SearchResult } from '@liendev/core';

/** A result with every possible metadata field populated. */
function createFullResult(): SearchResult {
  return {
    content: 'function example() { return true; }',
    metadata: {
      file: 'src/example.ts',
      startLine: 1,
      endLine: 10,
      type: 'function',
      language: 'typescript',
      symbolName: 'example',
      symbolType: 'function',
      signature: 'function example(): boolean',
      parentClass: 'ExampleClass',
      parameters: ['a', 'b'],
      exports: ['example'],
      imports: ['./utils'],
      importedSymbols: { './utils': ['helper'] },
      callSites: [{ symbol: 'helper', line: 5 }],
      symbols: { functions: ['example'], classes: [], interfaces: [] },
      complexity: 3,
      cognitiveComplexity: 2,
      halsteadVolume: 100,
      halsteadDifficulty: 5,
      halsteadEffort: 500,
      halsteadBugs: 0.03,
    },
    score: 0.5,
    relevance: 'relevant',
  };
}

describe('shapeResultMetadata', () => {
  it('semantic_search: keeps core fields and exports, strips everything else', () => {
    const result = shapeResultMetadata(createFullResult(), 'semantic_search');
    const m = result.metadata;

    // Kept
    expect(m.file).toBe('src/example.ts');
    expect(m.startLine).toBe(1);
    expect(m.endLine).toBe(10);
    expect(m.language).toBe('typescript');
    expect(m.type).toBe('function');
    expect(m.symbolName).toBe('example');
    expect(m.symbolType).toBe('function');
    expect(m.signature).toBe('function example(): boolean');
    expect(m.parentClass).toBe('ExampleClass');
    expect(m.parameters).toEqual(['a', 'b']);
    expect(m.exports).toEqual(['example']);

    // Stripped — only allowed keys should be present
    const keys = Object.keys(m);
    expect(keys).not.toContain('imports');
    expect(keys).not.toContain('importedSymbols');
    expect(keys).not.toContain('callSites');
    expect(keys).not.toContain('symbols');
    expect(keys).not.toContain('complexity');
    expect(keys).not.toContain('halsteadVolume');
  });

  it('find_similar: keeps core fields, strips imports/callSites/halstead', () => {
    const result = shapeResultMetadata(createFullResult(), 'find_similar');
    const m = result.metadata;

    expect(m.exports).toEqual(['example']);
    const keys = Object.keys(m);
    expect(keys).not.toContain('imports');
    expect(keys).not.toContain('callSites');
    expect(keys).not.toContain('complexity');
    expect(keys).not.toContain('halsteadEffort');
  });

  it('get_files_context: keeps imports/importedSymbols/callSites/symbols but strips halstead', () => {
    const result = shapeResultMetadata(createFullResult(), 'get_files_context');
    const m = result.metadata;

    // Kept
    expect(m.imports).toEqual(['./utils']);
    expect(m.importedSymbols).toEqual({ './utils': ['helper'] });
    expect(m.callSites).toEqual([{ symbol: 'helper', line: 5 }]);
    expect(m.exports).toEqual(['example']);
    expect(m.symbols).toEqual({ functions: ['example'], classes: [], interfaces: [] });

    // Stripped
    const keys = Object.keys(m);
    expect(keys).not.toContain('complexity');
    expect(keys).not.toContain('halsteadVolume');
  });

  it('list_functions: keeps symbols but strips imports/callSites/halstead', () => {
    const result = shapeResultMetadata(createFullResult(), 'list_functions');
    const m = result.metadata;

    // Kept
    expect(m.symbols).toEqual({ functions: ['example'], classes: [], interfaces: [] });
    expect(m.exports).toEqual(['example']);

    // Stripped
    const keys = Object.keys(m);
    expect(keys).not.toContain('imports');
    expect(keys).not.toContain('callSites');
    expect(keys).not.toContain('complexity');
    expect(keys).not.toContain('halsteadEffort');
  });

  it('preserves content, score, and relevance', () => {
    const result = shapeResultMetadata(createFullResult(), 'semantic_search');

    expect(result.content).toBe('function example() { return true; }');
    expect(result.score).toBe(0.5);
    expect(result.relevance).toBe('relevant');
  });

  it('handles metadata with missing optional fields gracefully', () => {
    const sparse: SearchResult = {
      content: 'const x = 1;',
      metadata: {
        file: 'src/x.ts',
        startLine: 1,
        endLine: 1,
        type: 'block',
        language: 'typescript',
      },
      score: 0.8,
      relevance: 'loosely_related',
    };

    const result = shapeResultMetadata(sparse, 'semantic_search');
    expect(result.metadata.file).toBe('src/x.ts');
    expect(result.metadata.symbolName).toBeUndefined();
    expect(Object.keys(result.metadata)).not.toContain('imports');
  });
});

describe('shapeResults', () => {
  it('maps over an array of results', () => {
    const results = [createFullResult(), createFullResult()];
    const shaped = shapeResults(results, 'semantic_search');

    expect(shaped).toHaveLength(2);
    for (const r of shaped) {
      const keys = Object.keys(r.metadata);
      expect(keys).not.toContain('imports');
      expect(keys).not.toContain('halsteadEffort');
    }
  });

  it('handles empty array', () => {
    expect(shapeResults([], 'semantic_search')).toEqual([]);
  });
});

describe('deduplicateResults', () => {
  it('removes results with the same file + startLine + endLine', () => {
    const r1 = createFullResult();
    const r2 = { ...createFullResult(), content: 'duplicate content' };
    const r3 = {
      ...createFullResult(),
      metadata: { ...createFullResult().metadata, file: 'src/other.ts' },
    };

    const results = deduplicateResults([r1, r2, r3]);
    expect(results).toHaveLength(2);
    expect(results[0].content).toBe(r1.content);
    expect(results[1].metadata.file).toBe('src/other.ts');
  });

  it('keeps first occurrence when duplicates exist', () => {
    const first = { ...createFullResult(), content: 'first' };
    const second = { ...createFullResult(), content: 'second' };

    const results = deduplicateResults([first, second]);
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('first');
  });

  it('distinguishes results with different line ranges', () => {
    const r1 = createFullResult();
    const r2 = {
      ...createFullResult(),
      metadata: { ...createFullResult().metadata, startLine: 20, endLine: 30 },
    };

    const results = deduplicateResults([r1, r2]);
    expect(results).toHaveLength(2);
  });

  it('handles empty array', () => {
    expect(deduplicateResults([])).toEqual([]);
  });

  it('keeps results from different repos with same file path and line range', () => {
    const r1 = {
      ...createFullResult(),
      metadata: { ...createFullResult().metadata, repoId: 'repo-a' },
    };
    const r2 = {
      ...createFullResult(),
      metadata: { ...createFullResult().metadata, repoId: 'repo-b' },
    };

    const results = deduplicateResults([r1, r2]);
    expect(results).toHaveLength(2);
  });

  it('deduplicates results within the same repo', () => {
    const r1 = {
      ...createFullResult(),
      metadata: { ...createFullResult().metadata, repoId: 'repo-a' },
    };
    const r2 = {
      ...createFullResult(),
      metadata: { ...createFullResult().metadata, repoId: 'repo-a' },
      content: 'duplicate',
    };

    const results = deduplicateResults([r1, r2]);
    expect(results).toHaveLength(1);
  });
});
