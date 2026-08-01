import { describe, it, expect } from 'vitest';
import { relabelCallerReasoning } from './blast-radius-reasoning.js';

describe('relabelCallerReasoning', () => {
  it('relabels the plural "N callers" entry as "N production callers"', () => {
    expect(relabelCallerReasoning(['8 callers', '2 untested'])).toEqual([
      '8 production callers',
      '2 untested',
    ]);
  });

  it('relabels the singular "1 caller" entry as "1 production caller"', () => {
    expect(relabelCallerReasoning(['1 caller'])).toEqual(['1 production caller']);
  });

  it('leaves unrelated reasoning entries untouched', () => {
    const reasoning = ['max complexity 18', 'untested high-complexity dependent'];
    expect(relabelCallerReasoning(reasoning)).toEqual(reasoning);
  });

  it('handles an empty reasoning list', () => {
    expect(relabelCallerReasoning([])).toEqual([]);
  });
});
