/**
 * Tests for delta.ts - complexity delta calculation
 */

import { describe, it, expect } from 'vitest';
import {
  calculateDeltas,
  calculateDeltaSummary,
  formatDelta,
  formatSeverityEmoji,
} from '@liendev/review';
import type { ComplexityReport, ComplexityViolation } from '@liendev/review';

function createViolation(
  filepath: string,
  symbolName: string,
  complexity: number,
  threshold = 15,
): ComplexityViolation {
  return {
    filepath,
    symbolName,
    symbolType: 'function',
    complexity,
    threshold,
    startLine: 1,
    endLine: 10,
    severity: complexity >= threshold * 2 ? 'error' : 'warning',
    language: 'typescript',
    message: `Complexity ${complexity} exceeds threshold ${threshold}`,
  };
}

function createReport(violations: ComplexityViolation[]): ComplexityReport {
  const files: ComplexityReport['files'] = {};

  for (const v of violations) {
    if (!files[v.filepath]) {
      files[v.filepath] = {
        violations: [],
        dependents: [],
        testAssociations: [],
        riskLevel: 'low',
      };
    }
    files[v.filepath].violations.push(v);
  }

  return {
    summary: {
      filesAnalyzed: Object.keys(files).length,
      totalViolations: violations.length,
      bySeverity: {
        error: violations.filter(v => v.severity === 'error').length,
        warning: violations.filter(v => v.severity === 'warning').length,
      },
      avgComplexity:
        violations.length > 0
          ? violations.reduce((sum, v) => sum + v.complexity, 0) / violations.length
          : 0,
      maxComplexity: violations.length > 0 ? Math.max(...violations.map(v => v.complexity)) : 0,
    },
    files,
  };
}

describe('calculateDeltas', () => {
  it('calculates positive delta when complexity increases', () => {
    const baseReport = createReport([createViolation('src/file.ts', 'func', 12)]);
    const headReport = createReport([createViolation('src/file.ts', 'func', 18)]);

    const deltas = calculateDeltas(baseReport, headReport, ['src/file.ts']);

    expect(deltas).toHaveLength(1);
    expect(deltas[0].delta).toBe(6); // 18 - 12
    expect(deltas[0].baseComplexity).toBe(12);
    expect(deltas[0].headComplexity).toBe(18);
  });

  it('calculates negative delta when complexity decreases', () => {
    const baseReport = createReport([createViolation('src/file.ts', 'func', 20)]);
    const headReport = createReport([createViolation('src/file.ts', 'func', 14)]);

    const deltas = calculateDeltas(baseReport, headReport, ['src/file.ts']);

    expect(deltas).toHaveLength(1);
    expect(deltas[0].delta).toBe(-6); // 14 - 20
    expect(deltas[0].severity).toBe('improved');
  });

  it('marks new functions with null baseComplexity', () => {
    const baseReport = createReport([]);
    const headReport = createReport([createViolation('src/file.ts', 'newFunc', 15)]);

    const deltas = calculateDeltas(baseReport, headReport, ['src/file.ts']);

    expect(deltas).toHaveLength(1);
    expect(deltas[0].baseComplexity).toBeNull();
    expect(deltas[0].headComplexity).toBe(15);
    expect(deltas[0].delta).toBe(15);
    expect(deltas[0].severity).toBe('new');
  });

  it('marks deleted functions with null headComplexity', () => {
    const baseReport = createReport([createViolation('src/file.ts', 'oldFunc', 15)]);
    const headReport = createReport([]);

    const deltas = calculateDeltas(baseReport, headReport, ['src/file.ts']);

    expect(deltas).toHaveLength(1);
    expect(deltas[0].baseComplexity).toBe(15);
    expect(deltas[0].headComplexity).toBeNull();
    expect(deltas[0].delta).toBe(-15);
    expect(deltas[0].severity).toBe('deleted');
  });

  it('handles null baseReport', () => {
    const headReport = createReport([createViolation('src/file.ts', 'func', 15)]);

    const deltas = calculateDeltas(null, headReport, ['src/file.ts']);

    expect(deltas).toHaveLength(1);
    expect(deltas[0].baseComplexity).toBeNull();
    expect(deltas[0].severity).toBe('new');
  });

  it('handles multiple files and functions', () => {
    const baseReport = createReport([
      createViolation('src/a.ts', 'funcA', 12),
      createViolation('src/b.ts', 'funcB', 15),
    ]);
    const headReport = createReport([
      createViolation('src/a.ts', 'funcA', 18), // got worse
      createViolation('src/b.ts', 'funcB', 11), // improved
      createViolation('src/c.ts', 'funcC', 14), // new
    ]);

    const deltas = calculateDeltas(baseReport, headReport, ['src/a.ts', 'src/b.ts', 'src/c.ts']);

    expect(deltas).toHaveLength(3);

    const deltaA = deltas.find(d => d.symbolName === 'funcA');
    expect(deltaA?.delta).toBe(6);

    const deltaB = deltas.find(d => d.symbolName === 'funcB');
    expect(deltaB?.delta).toBe(-4);
    expect(deltaB?.severity).toBe('improved');

    const deltaC = deltas.find(d => d.symbolName === 'funcC');
    expect(deltaC?.severity).toBe('new');
  });

  it('only considers files in changedFiles list', () => {
    const baseReport = createReport([
      createViolation('src/changed.ts', 'func', 12),
      createViolation('src/unchanged.ts', 'func', 20),
    ]);
    const headReport = createReport([
      createViolation('src/changed.ts', 'func', 18),
      createViolation('src/unchanged.ts', 'func', 20),
    ]);

    const deltas = calculateDeltas(baseReport, headReport, ['src/changed.ts']);

    expect(deltas).toHaveLength(1);
    expect(deltas[0].filepath).toBe('src/changed.ts');
  });

  it('handles functions with same name in different files', () => {
    const baseReport = createReport([
      createViolation('src/a.ts', 'process', 12),
      createViolation('src/b.ts', 'process', 15),
    ]);
    const headReport = createReport([
      createViolation('src/a.ts', 'process', 18),
      createViolation('src/b.ts', 'process', 11),
    ]);

    const deltas = calculateDeltas(baseReport, headReport, ['src/a.ts', 'src/b.ts']);

    expect(deltas).toHaveLength(2);

    const deltaA = deltas.find(d => d.filepath === 'src/a.ts');
    expect(deltaA?.delta).toBe(6);
    expect(deltaA?.symbolName).toBe('process');

    const deltaB = deltas.find(d => d.filepath === 'src/b.ts');
    expect(deltaB?.delta).toBe(-4);
    expect(deltaB?.symbolName).toBe('process');
    expect(deltaB?.severity).toBe('improved');
  });
});

describe('calculateDeltaSummary', () => {
  it('calculates correct summary stats', () => {
    const deltas = [
      {
        delta: 6,
        severity: 'warning' as const,
        filepath: '',
        symbolName: '',
        symbolType: '',
        startLine: 0,
        metricType: '',
        baseComplexity: 15,
        headComplexity: 21,
        threshold: 15,
      },
      {
        delta: -4,
        severity: 'improved' as const,
        filepath: '',
        symbolName: '',
        symbolType: '',
        startLine: 0,
        metricType: '',
        baseComplexity: 19,
        headComplexity: 15,
        threshold: 15,
      },
      {
        delta: 20,
        severity: 'new' as const,
        filepath: '',
        symbolName: '',
        symbolType: '',
        startLine: 0,
        metricType: '',
        baseComplexity: null,
        headComplexity: 20,
        threshold: 15,
      },
      {
        delta: -17,
        severity: 'deleted' as const,
        filepath: '',
        symbolName: '',
        symbolType: '',
        startLine: 0,
        metricType: '',
        baseComplexity: 17,
        headComplexity: null,
        threshold: 15,
      },
    ];

    const summary = calculateDeltaSummary(deltas);

    expect(summary.totalDelta).toBe(6 - 4 + 15 - 12); // 5
    expect(summary.improved).toBe(1);
    expect(summary.degraded).toBe(1);
    expect(summary.newFunctions).toBe(1);
    expect(summary.deletedFunctions).toBe(1);
  });

  it('handles empty deltas', () => {
    const summary = calculateDeltaSummary([]);

    expect(summary.totalDelta).toBe(0);
    expect(summary.improved).toBe(0);
    expect(summary.degraded).toBe(0);
  });
});

describe('formatDelta', () => {
  it('formats positive deltas with plus and up arrow', () => {
    expect(formatDelta(5)).toBe('+5 ⬆️');
  });

  it('formats negative deltas with down arrow', () => {
    expect(formatDelta(-3)).toBe('-3 ⬇️');
  });

  it('formats zero delta', () => {
    expect(formatDelta(0)).toBe('±0');
  });
});

describe('formatSeverityEmoji', () => {
  it('returns correct emojis', () => {
    expect(formatSeverityEmoji('error')).toBe('🔴');
    expect(formatSeverityEmoji('warning')).toBe('🟡');
    expect(formatSeverityEmoji('improved')).toBe('🟢');
    expect(formatSeverityEmoji('new')).toBe('🆕');
    expect(formatSeverityEmoji('deleted')).toBe('🗑️');
  });
});
