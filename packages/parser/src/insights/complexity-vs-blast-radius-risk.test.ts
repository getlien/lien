import { describe, it, expect } from 'vitest';
import { analyzeComplexityFromChunks } from './chunk-complexity.js';
import { findDependents } from '../dependency-analyzer.js';
import { computeBlastRadiusRisk } from '../risk/blast-radius-risk.js';
import type { ChunkMetadata, CodeChunk } from '../types.js';

/**
 * PINS a deliberate, documented invariant (CLI-4/REVIEW-6, #1017): Lien
 * computes two genuinely different "risk" concepts —
 *
 * - **Complexity risk** (`get_complexity`/`lien complexity`,
 *   `analyzeComplexityFromChunks` -> `FileComplexityData.riskLevel`,
 *   serialized externally as `complexityRiskLevel`): the file's OWN
 *   complexity severity, boosted (never downgraded) by dependent count/
 *   complexity. No test-coverage term anywhere in the formula.
 * - **Blast-radius risk** (`get_dependents`/`lien annotate`/`lien
 *   api-delta`, `computeBlastRadiusRisk` -> `riskLevel`): dependent breadth
 *   plus untested-dependent count, with a complexity FLOOR instead of a
 *   boost.
 *
 * Both fixtures below reproduce the exact shapes from the two bug reports
 * that surfaced this (a `complexity-delta.ts`-shaped low/medium case, and a
 * `gnarly.ts`-shaped high/low case) using the REAL production code paths —
 * `analyzeComplexityFromChunks` (what `get_complexity` calls) and
 * `findDependents` + `computeBlastRadiusRisk` (what `get_dependents`/`lien
 * annotate`/`lien api-delta` call) — fed the identical chunk universe.
 *
 * See docs/architecture/blast-radius-nudge.md's "Two risk concepts" section
 * for the full writeup. If a future change makes either formula start
 * agreeing with the other on these fixtures, THIS TEST FAILS — that is the
 * point: the two concepts converging silently is exactly the failure mode
 * being guarded against, so any change that makes them agree here must be a
 * conscious, disclosed decision (and this file, and the doc section above,
 * re-read and updated), never an incidental side effect of touching one
 * formula.
 */

/** Build a ChunkMetadata with sensible function defaults, override as needed. */
function meta(overrides: Partial<ChunkMetadata> & { file: string }): ChunkMetadata {
  return {
    startLine: 1,
    endLine: 10,
    type: 'function',
    language: 'typescript',
    symbolType: 'function',
    symbolName: 'fn',
    imports: [],
    ...overrides,
  };
}

function chunk(overrides: Partial<ChunkMetadata> & { file: string }): CodeChunk {
  return { content: '// stub', metadata: meta(overrides) };
}

const log = (): void => undefined;
const ROOT = '/repo';

describe('complexity risk vs blast-radius risk — documented divergence', () => {
  // Reproduction A shape: a low-complexity file with 2 production
  // dependents, one of which has no test coverage of its own.
  it('diverges LOW (complexity risk) vs MEDIUM (blast-radius risk) for the same file, same moment', () => {
    const target = chunk({ file: 'src/target.ts', complexity: 2, symbolName: 'target' });
    const dep1 = chunk({
      file: 'src/dep1.ts',
      complexity: 3,
      symbolName: 'dep1',
      imports: ['src/target.ts'],
    });
    const dep2 = chunk({
      file: 'src/dep2.ts',
      complexity: 3,
      symbolName: 'dep2',
      imports: ['src/target.ts'],
    });
    // Gives dep1 (but not dep2) a test importer, so uncoveredProductionDependents == 1.
    const dep1Test = chunk({
      file: 'src/dep1.test.ts',
      complexity: 1,
      symbolName: 'testsDep1',
      imports: ['src/dep1.ts'],
    });
    const allChunks = [target, dep1, dep2, dep1Test];

    // --- Complexity risk: what get_complexity/lien complexity reports ---
    const complexityReport = analyzeComplexityFromChunks(allChunks, ['src/target.ts']);
    const complexityRiskLevel = complexityReport.files['src/target.ts'].riskLevel;
    expect(complexityRiskLevel).toBe('low');

    // --- Blast-radius risk: what get_dependents/lien annotate/lien api-delta report ---
    const analysis = findDependents(allChunks, 'src/target.ts', log, ROOT);
    expect(analysis.productionDependentCount).toBe(2);
    expect(analysis.uncoveredProductionDependents).toBe(1);
    const blastRadiusRisk = computeBlastRadiusRisk({
      dependentCount: analysis.productionDependentCount,
      uncoveredDependents: analysis.uncoveredProductionDependents,
      maxDependentComplexity: analysis.complexityMetrics.maxComplexity,
      complexityRiskBoost: analysis.complexityMetrics.complexityRiskBoost,
    }).level;
    expect(blastRadiusRisk).toBe('medium');

    // The documented invariant: these disagree, by design.
    expect(complexityRiskLevel).not.toBe(blastRadiusRisk);
  });

  // Reproduction B shape: a high-severity-violation file whose only
  // dependent is its own test file (no production callers at all).
  it('diverges HIGH (complexity risk) vs LOW (blast-radius risk) for the same file, same moment', () => {
    const target = chunk({
      file: 'src/gnarly.ts',
      complexity: 35, // >= 2x the default cyclomatic threshold (15) -> an 'error' violation
      symbolName: 'gnarly',
    });
    const targetTest = chunk({
      file: 'src/gnarly.test.ts',
      complexity: 2,
      symbolName: 'testsGnarly',
      imports: ['src/gnarly.ts'],
    });
    const allChunks = [target, targetTest];

    // --- Complexity risk ---
    const complexityReport = analyzeComplexityFromChunks(allChunks, ['src/gnarly.ts']);
    const fileData = complexityReport.files['src/gnarly.ts'];
    expect(fileData.violations.some(v => v.severity === 'error')).toBe(true);
    const complexityRiskLevel = fileData.riskLevel;
    expect(complexityRiskLevel).toBe('high');

    // --- Blast-radius risk: the sole dependent is a test file, so
    // productionDependentCount is 0 -- the file has no real callers at all. ---
    const analysis = findDependents(allChunks, 'src/gnarly.ts', log, ROOT);
    expect(analysis.productionDependentCount).toBe(0);
    const blastRadiusRisk = computeBlastRadiusRisk({
      dependentCount: analysis.productionDependentCount,
      uncoveredDependents: analysis.uncoveredProductionDependents,
      maxDependentComplexity: analysis.complexityMetrics.maxComplexity,
      complexityRiskBoost: analysis.complexityMetrics.complexityRiskBoost,
    }).level;
    expect(blastRadiusRisk).toBe('low');

    // The documented invariant: these disagree, by design -- in the
    // OPPOSITE direction from the fixture above.
    expect(complexityRiskLevel).not.toBe(blastRadiusRisk);
  });
});
