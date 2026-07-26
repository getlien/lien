import { describe, it, expect } from 'vitest';
import { formatStatus } from '../src/order-status.js';

// Associated with src/order-status.ts by IMPORT, not by filename — a naive
// scan of source-file names gives no lexical path to "regression-suite".
describe('formatStatus', () => {
  it('includes the order id', () => {
    expect(formatStatus({ id: 'A1', state: 'shipped', customerName: 'Dana' })).toContain('A1');
  });

  it('includes the order state', () => {
    expect(formatStatus({ id: 'A1', state: 'shipped', customerName: 'Dana' })).toContain('shipped');
  });
});
