import { describe, it, expect } from 'vitest';
import type { CodeChunk } from '@liendev/parser';
import { buildDependencyGraph } from '../src/dependency-graph.js';
import { computeBlastRadius } from '../src/blast-radius.js';
import { createTestChunk } from '../src/test-helpers.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function exportChunk(file: string, symbol: string, complexity = 4): CodeChunk {
  return createTestChunk({
    metadata: {
      file,
      startLine: 1,
      endLine: 10,
      type: 'function',
      symbolName: symbol,
      symbolType: 'function',
      language: 'typescript',
      exports: [symbol],
      complexity,
      cognitiveComplexity: complexity,
    },
  });
}

function callerChunk(
  file: string,
  symbol: string,
  target: { file: string; symbol: string; importPath: string },
  opts: { complexity?: number } = {},
): CodeChunk {
  return createTestChunk({
    metadata: {
      file,
      startLine: 1,
      endLine: 10,
      type: 'function',
      symbolName: symbol,
      symbolType: 'function',
      language: 'typescript',
      exports: [symbol],
      importedSymbols: { [target.importPath]: [target.symbol] },
      callSites: [{ symbol: target.symbol, line: 5 }],
      complexity: opts.complexity,
      cognitiveComplexity: opts.complexity,
    },
  });
}

function testChunkFor(testFile: string, importedSrc: string): CodeChunk {
  return createTestChunk({
    content: `import { x } from '${importedSrc}';\ntest("x", () => {});`,
    metadata: {
      file: testFile,
      startLine: 1,
      endLine: 5,
      type: 'block',
      language: 'typescript',
      imports: [importedSrc],
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeBlastRadius', () => {
  it('returns an empty report when no seed candidates are changed', () => {
    const repoChunks: CodeChunk[] = [];
    const graph = buildDependencyGraph(repoChunks);

    const report = computeBlastRadius([], graph, repoChunks);

    expect(report.entries).toEqual([]);
    expect(report.totalDistinctDependents).toBe(0);
    expect(report.globalRisk.level).toBe('low');
    expect(report.truncated).toBe(false);
  });

  it('skips non-exported non-top-level symbols (like methods) as seeds', () => {
    const methodChunk = createTestChunk({
      metadata: {
        file: 'src/order.ts',
        startLine: 1,
        endLine: 5,
        type: 'function',
        symbolName: 'privateHelper',
        symbolType: 'method',
        parentClass: 'Order',
        language: 'typescript',
      },
    });
    const graph = buildDependencyGraph([methodChunk]);
    const report = computeBlastRadius([methodChunk], graph, [methodChunk]);
    expect(report.entries).toEqual([]);
  });

  it('finds transitive dependents, labels hops, overlays test coverage', () => {
    const seed = exportChunk('src/seed.ts', 'seed');
    const b = callerChunk('src/b.ts', 'b', {
      file: 'src/seed.ts',
      symbol: 'seed',
      importPath: './seed',
    });
    const c = callerChunk('src/c.ts', 'c', {
      file: 'src/b.ts',
      symbol: 'b',
      importPath: './b',
    });
    const bTest = testChunkFor('src/b.test.ts', './b'); // b is covered by a test
    const repoChunks = [seed, b, c, bTest];
    const graph = buildDependencyGraph(repoChunks);

    const report = computeBlastRadius([seed], graph, repoChunks, { depth: 2 });

    expect(report.entries).toHaveLength(1);
    const entry = report.entries[0];
    expect(entry.seed.symbolName).toBe('seed');
    expect(entry.dependents).toHaveLength(2);

    const bDep = entry.dependents.find(d => d.symbolName === 'b')!;
    const cDep = entry.dependents.find(d => d.symbolName === 'c')!;
    expect(bDep.hops).toBe(1);
    expect(bDep.hasTestCoverage).toBe(true);
    expect(cDep.hops).toBe(2);
    expect(cDep.hasTestCoverage).toBe(false);

    expect(report.totalDistinctDependents).toBe(2);
    // b is covered but c is not — global risk should reflect that.
    expect(['medium', 'high', 'critical']).toContain(report.globalRisk.level);
  });

  it('picks cognitiveComplexity over cyclomatic when overlaying complexity', () => {
    const seed = exportChunk('src/seed.ts', 'seed');
    const caller = callerChunk(
      'src/caller.ts',
      'caller',
      { file: 'src/seed.ts', symbol: 'seed', importPath: './seed' },
      { complexity: 12 },
    );
    // Force cognitive to a different value than the default (setting cognitive via helper's complexity option).
    caller.metadata.cognitiveComplexity = 9;
    caller.metadata.complexity = 12;

    const repoChunks = [seed, caller];
    const graph = buildDependencyGraph(repoChunks);
    const report = computeBlastRadius([seed], graph, repoChunks);

    const dep = report.entries[0].dependents[0];
    // Cognitive preferred
    expect(dep.complexity).toBe(9);
  });

  it('sorts entries by risk level then by dependent count', () => {
    // Two seeds:
    //   - "cold" with 1 tested dependent → low
    //   - "hot" with 3 untested dependents → medium
    const cold = exportChunk('src/cold.ts', 'cold');
    const coldCaller = callerChunk('src/usesCold.ts', 'usesCold', {
      file: 'src/cold.ts',
      symbol: 'cold',
      importPath: './cold',
    });
    const coldCallerTest = testChunkFor('src/usesCold.test.ts', './usesCold');

    const hot = exportChunk('src/hot.ts', 'hot');
    const hotCallers = Array.from({ length: 3 }, (_, i) =>
      callerChunk(`src/usesHot${i}.ts`, `usesHot${i}`, {
        file: 'src/hot.ts',
        symbol: 'hot',
        importPath: './hot',
      }),
    );

    const repoChunks = [cold, coldCaller, coldCallerTest, hot, ...hotCallers];
    const graph = buildDependencyGraph(repoChunks);
    const report = computeBlastRadius([cold, hot], graph, repoChunks);

    expect(report.entries).toHaveLength(2);
    expect(report.entries[0].seed.symbolName).toBe('hot');
    expect(report.entries[1].seed.symbolName).toBe('cold');
  });

  it('clips seeds to maxSeeds, ranking exported + higher complexity first', () => {
    const chunks = Array.from(
      { length: 5 },
      (_, i) => exportChunk(`src/s${i}.ts`, `s${i}`, i), // increasing complexity with index
    );
    const graph = buildDependencyGraph(chunks);
    const report = computeBlastRadius(chunks, graph, chunks, { maxSeeds: 2 });

    expect(report.entries).toHaveLength(2);
    // Highest complexity wins (4 and 3).
    expect(report.entries.map(e => e.seed.symbolName).sort()).toEqual(['s3', 's4']);
  });

  it('propagates per-entry truncation into the report', () => {
    const seed = exportChunk('src/seed.ts', 'seed');
    const callers = Array.from({ length: 5 }, (_, i) =>
      callerChunk(`src/c${i}.ts`, `c${i}`, {
        file: 'src/seed.ts',
        symbol: 'seed',
        importPath: './seed',
      }),
    );
    const repoChunks = [seed, ...callers];
    const graph = buildDependencyGraph(repoChunks);
    const report = computeBlastRadius([seed], graph, repoChunks, { maxNodes: 2 });

    expect(report.entries[0].truncated).toBe(true);
    expect(report.truncated).toBe(true);
    expect(report.entries[0].dependents).toHaveLength(2);
  });
});
