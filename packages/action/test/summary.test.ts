import { describe, it, expect } from 'vitest';

import type { ReviewFinding } from '@liendev/review';

import { countErrors, hasProviderFailure } from '../src/summary.js';

function summaryFinding(metadata?: Record<string, unknown>): ReviewFinding {
  return {
    pluginId: 'agent-review',
    filepath: '',
    line: 0,
    severity: 'error',
    category: 'summary',
    message: 'Lien Review did not run — every provider request failed (API error (402): ...).',
    metadata,
  };
}

describe('countErrors', () => {
  it('counts only error-severity findings', () => {
    const findings = [
      { severity: 'error' } as ReviewFinding,
      { severity: 'warning' } as ReviewFinding,
      { severity: 'error' } as ReviewFinding,
    ];
    expect(countErrors(findings)).toBe(2);
  });
});

describe('hasProviderFailure', () => {
  it('is true when a finding carries metadata.neverRan', () => {
    expect(hasProviderFailure([summaryFinding({ neverRan: true, incomplete: true })])).toBe(true);
  });

  it('is false for an ordinary error finding with no neverRan metadata', () => {
    expect(hasProviderFailure([summaryFinding(undefined)])).toBe(false);
  });

  it('is false for a partial-incomplete finding (neverRan absent, not just falsy)', () => {
    // The doc-truth-only / budget-exhausted incomplete notices set `incomplete`
    // but never `neverRan` — these must stay advisory, not escalate to a
    // provider-failure exit code.
    expect(hasProviderFailure([summaryFinding({ incomplete: true, stopReason: 'budget' })])).toBe(
      false,
    );
  });

  it('is false for an empty findings list', () => {
    expect(hasProviderFailure([])).toBe(false);
  });
});
