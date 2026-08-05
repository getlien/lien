import { describe, it, expect } from 'vitest';
import type { CodeChunk } from '@liendev/parser';
import { computeBlastRadiusRisk, buildDependencyGraph } from '@liendev/parser';

import { getDependents } from '../src/plugins/agent/agent-tools.js';
import { computeBlastRadius } from '../src/blast-radius.js';
import { createTestChunk, silentLogger } from '../src/test-helpers.js';
import type { AgentToolContext } from '../src/plugins/agent/types.js';

/** Parsed shape of getDependents' JSON return. */
interface GetDependentsResult {
  dependentCount?: number;
  riskLevel?: string;
  riskReasoning?: string[];
  callers?: unknown[];
  error?: string;
}

function ctxWith(repoChunks: CodeChunk[]): AgentToolContext {
  return {
    repoChunks,
    repoRootDir: '/tmp/does-not-matter',
    graph: buildDependencyGraph(repoChunks),
    logger: silentLogger,
  };
}

function seedChunk(file: string, symbol: string): CodeChunk {
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
      complexity: 3,
      cognitiveComplexity: 3,
    },
  });
}

function callerChunk(
  file: string,
  symbol: string,
  target: { file: string; symbol: string; importPath: string },
  complexity: number,
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
      complexity,
      cognitiveComplexity: complexity,
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

/** 3 dependents of `seed`, all with complexity 40 and no test coverage. */
function threeUntestedHighComplexityCallers(): CodeChunk[] {
  return Array.from({ length: 3 }, (_, i) =>
    callerChunk(
      `src/caller${i}.ts`,
      `caller${i}`,
      { file: 'src/seed.ts', symbol: 'seed', importPath: './seed' },
      40,
    ),
  );
}

describe('getDependents — risk composed via computeBlastRadiusRisk (#977)', () => {
  it('matches computeBlastRadiusRisk\'s "high" verdict for 3 untested, complexity-40 dependents', () => {
    // The issue's worked counter-example: a count-only ladder returns 'low'
    // for 3 dependents (its next tier needs >= 5), while computeBlastRadiusRisk
    // — fed the very same shape — returns 'high' because an untested dependent
    // crosses the high-complexity threshold.
    const seed = seedChunk('src/seed.ts', 'seed');
    const callers = threeUntestedHighComplexityCallers();
    const repoChunks = [seed, ...callers];

    const result = JSON.parse(
      getDependents({ filepath: 'src/seed.ts', symbol: 'seed' }, ctxWith(repoChunks)),
    ) as GetDependentsResult;

    expect(result.error).toBeUndefined();
    expect(result.dependentCount).toBe(3);

    const primitiveVerdict = computeBlastRadiusRisk({
      dependentCount: 3,
      uncoveredDependents: 3,
      maxDependentComplexity: 40,
      hasHighComplexityUncovered: true,
    });

    expect(primitiveVerdict.level).toBe('high');
    expect(result.riskLevel).toBe(primitiveVerdict.level);
    expect(result.riskReasoning).toContain('untested high-complexity dependent');
  });

  it('agrees with the review-side <blast_radius> injection (computeBlastRadius) for the same fixture', () => {
    // Same PR, same seed symbol — the agent's own get_dependents tool and the
    // pre-computed blast-radius block injected into its initial message must
    // never disagree on risk (#977). depth:1 matches getCallers' direct
    // (non-transitive) lookup so the two computations walk the same edges.
    const seed = seedChunk('src/seed.ts', 'seed');
    const callers = threeUntestedHighComplexityCallers();
    const repoChunks = [seed, ...callers];
    const graph = buildDependencyGraph(repoChunks);

    const blastRadiusReport = computeBlastRadius([seed], graph, repoChunks, { depth: 1 });
    const toolResult = JSON.parse(
      getDependents({ filepath: 'src/seed.ts', symbol: 'seed' }, ctxWith(repoChunks)),
    ) as GetDependentsResult;

    expect(blastRadiusReport.entries).toHaveLength(1);
    expect(toolResult.riskLevel).toBe(blastRadiusReport.entries[0].risk.level);
  });

  it('does not escalate when the same high-complexity dependents are fully tested', () => {
    const seed = seedChunk('src/seed.ts', 'seed');
    const callers = threeUntestedHighComplexityCallers();
    const tests = callers.map((_, i) => testChunkFor(`src/caller${i}.test.ts`, `./caller${i}`));
    const repoChunks = [seed, ...callers, ...tests];

    const result = JSON.parse(
      getDependents({ filepath: 'src/seed.ts', symbol: 'seed' }, ctxWith(repoChunks)),
    ) as GetDependentsResult;

    const primitiveVerdict = computeBlastRadiusRisk({
      dependentCount: 3,
      uncoveredDependents: 0,
      maxDependentComplexity: 40,
      hasHighComplexityUncovered: false,
    });

    expect(result.riskLevel).toBe(primitiveVerdict.level);
    expect(result.riskLevel).not.toBe('high');
  });

  it('composes risk the same way for the file-level (no symbol) branch', () => {
    const seed = seedChunk('src/seed.ts', 'seed');
    const callers = Array.from({ length: 6 }, (_, i) =>
      callerChunk(
        `src/caller${i}.ts`,
        `caller${i}`,
        { file: 'src/seed.ts', symbol: 'seed', importPath: './seed' },
        2,
      ),
    );
    const repoChunks = [seed, ...callers];

    const result = JSON.parse(
      getDependents({ filepath: 'src/seed.ts' }, ctxWith(repoChunks)),
    ) as GetDependentsResult;

    const primitiveVerdict = computeBlastRadiusRisk({
      dependentCount: 6,
      uncoveredDependents: 6,
      maxDependentComplexity: 2,
      hasHighComplexityUncovered: false,
    });

    expect(result.dependentCount).toBe(6);
    expect(result.riskLevel).toBe(primitiveVerdict.level);
  });
});
