import { describe, it, expect } from 'vitest';
import type { CodeChunk } from '@liendev/parser';
import { buildDependencyGraph } from '@liendev/parser';
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

  // #1005 Phase 2, AC10: a disclosed, NOT-fixed-here limitation. The JVM
  // same-package call-graph tier (dependency-graph.ts's `getCallers`) can
  // legitimately surface far more same-package callers for a popular
  // declared type than any TS/JS seed typically has -- a real fan-in
  // increase, not a bug. Once that fan-in exceeds `computeBlastRadius`'s
  // DEFAULT maxNodes (30, not overridden below -- the point is that this is
  // a realistic budget, not an artificially small one), the walk saturates
  // at hop 1 and NEVER reaches hop 2 for that seed at all, even for a caller
  // sitting right at hop 1 with its own further caller waiting one hop away.
  // This test pins that as the CURRENT, EXPECTED behavior (the existing
  // `maxNodes`/depth policy trading recall for a bounded walk), so a future
  // change doesn't silently alter this semantics without a test noticing --
  // see the #1005 Phase 2 PR body for the filed follow-up asking whether
  // this file's defaults should be revisited now that JVM recall improved.
  it('AC10 (disclosed limitation, not fixed here): a very-high-fan-in JVM type seed saturates the default maxNodes at hop 1, losing all hop-2 reach for that seed', () => {
    const target = createTestChunk({
      content: 'package a.b;\n\npublic class Target { }',
      metadata: {
        file: 'src/main/java/a/b/Target.java',
        startLine: 1,
        endLine: 3,
        type: 'class',
        symbolName: 'Target',
        symbolType: 'class',
        language: 'java',
        exports: ['Target'],
      },
    });

    // 35 same-package callers -- more than DEFAULT_MAX_NODES (30) -- each a
    // real, textual same-package reference with no import at all (the exact
    // shape the new tier exists to resolve).
    const sameCallers = Array.from({ length: 35 }, (_, i) =>
      createTestChunk({
        content: `package a.b;\n\nclass Caller${i} { void run() { Target.doSomething(); } }`,
        metadata: {
          file: `src/main/java/a/b/Caller${i}.java`,
          startLine: 1,
          endLine: 3,
          type: 'class',
          symbolName: `Caller${i}`,
          symbolType: 'class',
          language: 'java',
        },
      }),
    );

    // A real, verified hop-2 caller of Caller0 specifically -- reachable
    // only if the BFS gets past hop 1 for that particular node, which the
    // default budget (saturated by the other 34 same-package siblings at
    // hop 1) never lets it do.
    const hop2Caller = createTestChunk({
      content:
        'package x.y;\n\nimport a.b.Caller0;\n\nclass Consumer { void run() { Caller0.run(); } }',
      metadata: {
        file: 'src/main/java/x/y/Consumer.java',
        startLine: 1,
        endLine: 3,
        type: 'class',
        symbolName: 'Consumer',
        symbolType: 'class',
        language: 'java',
        importedSymbols: { 'src/main/java/a/b/Caller0': ['Caller0'] },
        callSites: [{ symbol: 'run', line: 3 }],
      },
    });

    const repoChunks = [target, ...sameCallers, hop2Caller];
    const graph = buildDependencyGraph(repoChunks);

    // Confirm the fan-in is real before blaming the budget for anything.
    expect(graph.getCallers('src/main/java/a/b/Target.java', 'Target')).toHaveLength(35);

    const report = computeBlastRadius([target], graph, repoChunks); // default maxNodes (30)

    expect(report.entries).toHaveLength(1);
    const entry = report.entries[0];
    expect(entry.truncated).toBe(true);
    expect(entry.dependents).toHaveLength(30);
    // Zero hop-2 reach: truncation halts the walk before ANY hop-1 node is
    // expanded to hop 2, regardless of which 30 of the 35 hop-1 callers
    // survived the budget.
    expect(entry.dependents.every(d => d.hops === 1)).toBe(true);
    expect(entry.dependents.find(d => d.filepath.includes('Consumer'))).toBeUndefined();
  });
});
