/**
 * Regression coverage for the CodeRabbit #768 finding: `reportUsage` fires
 * once per agent-client pass (the main review, and on doc-touching PRs the
 * doc-truth second pass), and `review-pr.ts` used to ASSIGN the latest call's
 * usage instead of accumulating it — so the run's reported spend silently
 * reflected only whichever pass reported last, dropping the other entirely.
 */
import { describe, it, expect } from 'vitest';

import { accumulateUsage, type AgentUsage } from '../src/review-pr.js';

describe('accumulateUsage', () => {
  it('sums every field across two usage snapshots', () => {
    const main: AgentUsage = {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cost: 0.01,
    };
    const docTruth: AgentUsage = {
      promptTokens: 20,
      completionTokens: 10,
      totalTokens: 30,
      cost: 0.002,
    };

    expect(accumulateUsage(main, docTruth)).toEqual({
      promptTokens: 120,
      completionTokens: 60,
      totalTokens: 180,
      cost: 0.012,
    });
  });

  it('is a no-op when accumulating onto a zero baseline (the single-pass case)', () => {
    const zero: AgentUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 };
    const only: AgentUsage = { promptTokens: 5, completionTokens: 5, totalTokens: 10, cost: 0.001 };

    expect(accumulateUsage(zero, only)).toEqual(only);
  });
});
