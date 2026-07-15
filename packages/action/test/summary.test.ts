import { describe, it, expect } from 'vitest';

import type { ReviewFinding } from '@liendev/review';

import { countErrors } from '../src/summary.js';

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
