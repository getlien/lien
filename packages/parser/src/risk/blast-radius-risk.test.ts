import { describe, it, expect } from 'vitest';
import { computeBlastRadiusRisk } from './blast-radius-risk.js';

describe('computeBlastRadiusRisk', () => {
  it('returns low with no reasoning when nothing is at risk', () => {
    const result = computeBlastRadiusRisk({
      dependentCount: 0,
      uncoveredDependents: 0,
    });
    expect(result.level).toBe('low');
    expect(result.reasoning).toEqual([]);
  });

  it('stays low for small, fully tested blast radius', () => {
    const result = computeBlastRadiusRisk({
      dependentCount: 3,
      uncoveredDependents: 0,
      maxDependentComplexity: 4,
    });
    expect(result.level).toBe('low');
    expect(result.reasoning).toContain('3 callers');
    expect(result.reasoning).toContain('max complexity 4');
  });

  it('escalates to medium when any dependent is untested', () => {
    const result = computeBlastRadiusRisk({
      dependentCount: 3,
      uncoveredDependents: 1,
    });
    expect(result.level).toBe('medium');
    expect(result.reasoning).toContain('1 untested');
  });

  it('escalates to medium based on caller count', () => {
    const result = computeBlastRadiusRisk({
      dependentCount: 7,
      uncoveredDependents: 0,
    });
    expect(result.level).toBe('medium');
    expect(result.reasoning).toContain('7 callers');
  });

  it('escalates to high when caller count exceeds 20', () => {
    const result = computeBlastRadiusRisk({
      dependentCount: 25,
      uncoveredDependents: 0,
    });
    expect(result.level).toBe('high');
  });

  it('escalates to high when an untested dependent has high complexity', () => {
    const result = computeBlastRadiusRisk({
      dependentCount: 3,
      uncoveredDependents: 1,
      hasHighComplexityUncovered: true,
    });
    expect(result.level).toBe('high');
    // The escalation driver must be visible in reasoning; otherwise a caller
    // sees only "3 callers, 1 untested" and can't tell why it isn't medium.
    expect(result.reasoning).toContain('untested high-complexity dependent');
  });

  it('escalates to critical on very large blast radius', () => {
    const result = computeBlastRadiusRisk({
      dependentCount: 60,
      uncoveredDependents: 10,
    });
    expect(result.level).toBe('critical');
  });

  it('escalates to critical when high-complexity uncovered combines with large radius', () => {
    const result = computeBlastRadiusRisk({
      dependentCount: 25,
      uncoveredDependents: 5,
      hasHighComplexityUncovered: true,
    });
    expect(result.level).toBe('critical');
  });

  it('uses singular "caller" phrasing when dependentCount is 1', () => {
    const result = computeBlastRadiusRisk({
      dependentCount: 1,
      uncoveredDependents: 0,
    });
    expect(result.reasoning).toContain('1 caller');
    expect(result.reasoning).not.toContain('1 callers');
  });

  it('omits max complexity phrase when value is zero or missing', () => {
    const zero = computeBlastRadiusRisk({
      dependentCount: 2,
      uncoveredDependents: 0,
      maxDependentComplexity: 0,
    });
    expect(zero.reasoning.some(r => r.startsWith('max complexity'))).toBe(false);

    const missing = computeBlastRadiusRisk({
      dependentCount: 2,
      uncoveredDependents: 0,
    });
    expect(missing.reasoning.some(r => r.startsWith('max complexity'))).toBe(false);
  });
});
